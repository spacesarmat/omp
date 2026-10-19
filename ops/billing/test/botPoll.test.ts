import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { botPollStatusText } from '../admin/src/lib/botPoll';
import { listStamp } from '../admin/src/lib/time';
import {
  BOT_POLL_ALERT_EVERY_MS,
  BOT_POLL_CONFLICT_RECENT_MS,
  BOT_POLL_LOG_EVERY_MS,
  botPollEnabled,
  botPollSnapshot,
  conflictAlertText,
  isGetUpdatesConflict,
  noteGetUpdatesConflict,
  resetBotPollState,
} from '../src/botPoll.mjs';
import { createApp, pollBot } from '../src/server.mjs';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';
import { updateState, writeState, testStore } from './pg';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const TOKEN = 'poll-test-token';
const CONFLICT = {
  ok: false,
  error_code: 409,
  description: 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
};

function captureStderr() {
  const lines: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    lines,
    restore() {
      process.stderr.write = orig;
    },
  };
}

async function dbFile() {
  const file = await testStore();
  const state = emptyState();
  state.settings.botToken = TOKEN;
  state.settings.adminTelegramIds = '99';
  state.settings.adminNotify = true;
  await writeState(file, state);
  return file;
}

type Call = { url: string; body: string };

function jsonResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

afterEach(() => {
  delete process.env.BILLING_BOT_POLL;
  resetBotPollState();
});

describe('BILLING_BOT_POLL', () => {
  it('polls unless the flag is explicitly off', () => {
    expect(botPollEnabled({})).toBe(true);
    expect(botPollEnabled({ BILLING_BOT_POLL: '' })).toBe(true);
    expect(botPollEnabled({ BILLING_BOT_POLL: '1' })).toBe(true);
    expect(botPollEnabled({ BILLING_BOT_POLL: 'on' })).toBe(true);
    expect(botPollEnabled({ BILLING_BOT_POLL: '0' })).toBe(false);
    expect(botPollEnabled({ BILLING_BOT_POLL: 'false' })).toBe(false);
    expect(botPollEnabled({ BILLING_BOT_POLL: 'off' })).toBe(false);
    expect(botPollEnabled({ BILLING_BOT_POLL: 'no' })).toBe(false);
    expect(botPollEnabled({ BILLING_BOT_POLL: 'maybe' })).toBe(true);
  });

  it('does not call getUpdates when polling is off', async () => {
    process.env.BILLING_BOT_POLL = '0';
    const file = await dbFile();
    let called = 0;
    const log = captureStderr();
    try {
      await pollBot(
        file,
        async () => {
          called += 1;
          return jsonResponse(200, { ok: true, result: [] });
        },
        { maxLoops: 3, sleep: async () => {} },
      );
      expect(called).toBe(0);
      expect(log.lines.join('')).toContain('BILLING_BOT_POLL=0');
      expect(log.lines.join('')).not.toContain(TOKEN);
      expect(botPollSnapshot(NOW).enabled).toBe(false);
    } finally {
      log.restore();
    }
  });
});

describe('getUpdates 409', () => {
  it('recognises only the other-poller conflict', () => {
    expect(isGetUpdatesConflict({ status: 409 }, CONFLICT)).toBe(true);
    expect(isGetUpdatesConflict({ status: 200 }, CONFLICT)).toBe(true);
    expect(
      isGetUpdatesConflict(
        { status: 409 },
        { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" },
      ),
    ).toBe(false);
    expect(isGetUpdatesConflict({ status: 500 }, { ok: false, description: CONFLICT.description })).toBe(false);
  });

  it('logs at most once a minute and alerts admins at most once an hour', () => {
    const settings = { adminNotify: true, adminTelegramIds: '99' };
    const first = noteGetUpdatesConflict(settings, NOW);
    expect(first.log).toBe(true);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].text).toBe(conflictAlertText());
    expect(first.messages[0].chatId).toBe('99');
    expect(first.messages[0].text).not.toContain(TOKEN);

    const soon = noteGetUpdatesConflict(settings, NOW + 1000);
    expect(soon.log).toBe(false);
    expect(soon.messages).toEqual([]);

    const logged = noteGetUpdatesConflict(settings, NOW + BOT_POLL_LOG_EVERY_MS);
    expect(logged.log).toBe(true);
    expect(logged.messages).toEqual([]);

    const later = noteGetUpdatesConflict(settings, NOW + BOT_POLL_ALERT_EVERY_MS + BOT_POLL_LOG_EVERY_MS);
    expect(later.log).toBe(true);
    expect(later.messages).toHaveLength(1);

    const snap = botPollSnapshot(NOW + BOT_POLL_ALERT_EVERY_MS + BOT_POLL_LOG_EVERY_MS);
    expect(snap.conflictAt).toBe(NOW + BOT_POLL_ALERT_EVERY_MS + BOT_POLL_LOG_EVERY_MS);
    expect(snap.conflictRecent).toBe(true);
    expect(botPollSnapshot(snap.conflictAt + BOT_POLL_CONFLICT_RECENT_MS + 1).conflictRecent).toBe(false);
  });

  it('does not alert when admin notices are off, then alerts once they are on', () => {
    const quiet = noteGetUpdatesConflict({ adminNotify: false, adminTelegramIds: '99' }, NOW);
    expect(quiet.log).toBe(true);
    expect(quiet.messages).toEqual([]);
    const loud = noteGetUpdatesConflict({ adminNotify: true, adminTelegramIds: '99' }, NOW + 1000);
    expect(loud.log).toBe(false);
    expect(loud.messages).toHaveLength(1);
    const again = noteGetUpdatesConflict({ adminNotify: true, adminTelegramIds: '99' }, NOW + 2000);
    expect(again.messages).toEqual([]);
  });

  it('pollBot logs the conflict, alerts once, and records a successful getUpdates', async () => {
    const file = await dbFile();
    const calls: Call[] = [];
    const log = captureStderr();
    const fetchImpl = async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      if (String(url).indexOf('getUpdates') >= 0) return jsonResponse(409, CONFLICT);
      return jsonResponse(200, { ok: true, result: { message_id: 7 } });
    };
    let slept = 0;
    try {
      await pollBot(file, fetchImpl, { maxLoops: 1, sleep: async () => { slept += 1; }, now: () => NOW });
      expect(slept).toBe(1);
      const text = log.lines.join('');
      expect(text).toContain('terminated by other getUpdates request');
      expect(text).not.toContain(TOKEN);
      const sends = calls.filter((c) => c.url.indexOf('sendMessage') >= 0);
      expect(sends).toHaveLength(1);
      expect(sends[0].body).toContain('getUpdates 409');
      expect(sends[0].body).not.toContain(TOKEN);
      expect(botPollSnapshot(NOW).conflictRecent).toBe(true);
      expect(botPollSnapshot(NOW).lastOkAt).toBe(0);

      calls.length = 0;
      log.lines.length = 0;
      await pollBot(file, fetchImpl, { maxLoops: 1, sleep: async () => { slept += 1; }, now: () => NOW + 1000 });
      expect(log.lines.join('')).toBe('');
      expect(calls.filter((c) => c.url.indexOf('sendMessage') >= 0)).toHaveLength(0);

      const okFetch = async (url: string) => {
        if (String(url).indexOf('getUpdates') >= 0) return jsonResponse(200, { ok: true, result: [] });
        return jsonResponse(200, { ok: true, result: { message_id: 1 } });
      };
      slept = 0;
      await pollBot(file, okFetch, { maxLoops: 1, sleep: async () => { slept += 1; }, now: () => NOW + 2000 });
      expect(slept).toBe(0);
      expect(botPollSnapshot(NOW + 2000).lastOkAt).toBe(NOW + 2000);
      expect(botPollSnapshot(NOW + 2000).enabled).toBe(true);
    } finally {
      log.restore();
    }
  });

  it('does not treat a webhook 409 as another poller', async () => {
    const file = await dbFile();
    const log = captureStderr();
    let slept = 0;
    try {
      await pollBot(
        file,
        async () =>
          jsonResponse(409, {
            ok: false,
            error_code: 409,
            description: "Conflict: can't use getUpdates method while webhook is active",
          }),
        { maxLoops: 1, sleep: async () => { slept += 1; }, now: () => NOW },
      );
      expect(slept).toBe(1);
      expect(log.lines.join('')).not.toContain('another instance');
      expect(botPollSnapshot(NOW).conflictAt).toBe(0);
    } finally {
      log.restore();
    }
  });
});

describe('admin poll status', () => {
  it('describes the last success and a recent conflict without a token', () => {
    expect(botPollStatusText(null)).toContain('нет данных');
    expect(botPollStatusText({ enabled: false, lastOkAt: NOW, conflictAt: NOW })).toContain('BILLING_BOT_POLL=0');
    const quiet = botPollStatusText({ enabled: true, lastOkAt: 0, conflictAt: 0, conflictRecent: false });
    expect(quiet).toContain('ещё не было');
    expect(quiet).toContain('не фиксировался');
    const hit = botPollStatusText({ enabled: true, lastOkAt: NOW, conflictAt: NOW - 1000, conflictRecent: true });
    expect(hit).toContain('getUpdates ' + listStamp(NOW));
    expect(hit).toContain('недавно');
    expect(hit).toContain(listStamp(NOW - 1000));
    expect(hit).not.toContain(TOKEN);
    const old = botPollStatusText({ enabled: true, lastOkAt: NOW, conflictAt: NOW - 1000, conflictRecent: false });
    expect(old).toContain('Последний конфликт 409');
  });

  it('serves bot poll status on the services API', async () => {
    const file = await dbFile();
    const at = Date.now();
    noteGetUpdatesConflict({ adminNotify: false, adminTelegramIds: '99' }, at);
    const app = createApp(file, async () => jsonResponse(200, { ok: true }));
    const link = await updateState(file, (s) => issueCliAdminLogin(s, { now: Date.now() }));
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
    const cookie = String(once.headers['set-cookie'] || '');
    const services = await call(app, 'GET', '/admin/api/services', { cookie });
    const poll = services.data && (services.data.botPoll as { enabled: boolean; conflictAt: number; conflictRecent: boolean; lastOkAt: number });
    expect(services.status).toBe(200);
    expect(poll.enabled).toBe(true);
    expect(poll.conflictAt).toBe(at);
    expect(poll.conflictRecent).toBe(true);
    expect(poll.lastOkAt).toBe(0);
    expect(JSON.stringify(services.data)).not.toContain(TOKEN);
    expect(JSON.stringify(services.data)).not.toContain(link.token);
  });
});

describe('bot poll docs', () => {
  it('documents BILLING_BOT_POLL for the VPS and the NAS copy', () => {
    const vpsCompose = readFileSync('ops/vps/docker-compose.yml', 'utf8');
    const vpsEnv = readFileSync('ops/vps/.env.example', 'utf8');
    const vpsReadme = readFileSync('ops/vps/README.md', 'utf8');
    const dockerfile = readFileSync('ops/vps/Dockerfile', 'utf8');
    expect(vpsCompose).toContain('BILLING_BOT_POLL: ${BILLING_BOT_POLL:-1}');
    expect(vpsEnv).toContain('BILLING_BOT_POLL=1');
    expect(vpsReadme).toContain('BILLING_BOT_POLL=0');
    expect(vpsReadme).toContain('terminated by other getUpdates request');
    expect(dockerfile).toContain('ENV BILLING_BOT_POLL=1');
    expect(readFileSync('ops/billing/docker-compose.yml', 'utf8')).toContain('BILLING_BOT_POLL: "0"');
    expect(readFileSync('ops/billing/casaos-docker-compose.yml', 'utf8')).toContain('BILLING_BOT_POLL: "0"');
    expect(readFileSync('ops/billing/env.tunnel.example', 'utf8')).toContain('BILLING_BOT_POLL=0');
    expect(readFileSync('ops/billing/README.md', 'utf8')).toContain('BILLING_BOT_POLL');
    const html = readFileSync('ops/billing/public/index.html', 'utf8');
    const match = html.match(/\/admin\/assets\/(index-[^"]+\.js)/);
    expect(match).toBeTruthy();
    const js = readFileSync('ops/billing/public/assets/' + (match ? match[1] : ''), 'utf8');
    expect(js).toContain('Опрос бота');
    expect(js).toContain('BILLING_BOT_POLL=0');
    expect(js).toContain('getUpdates');
  });
});

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { cookie?: string } = {},
) {
  const req = {
    method,
    url: path,
    headers: { cookie: opts.cookie || '', accept: 'application/json' },
    async *[Symbol.asyncIterator]() {
      /* empty */
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, data };
}

describe('pollBot: update types and the channel pin notice', () => {
  it('asks Telegram for messages, buttons and channel posts on every poll', async () => {
    const file = await dbFile();
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(String(url));
      return jsonResponse(200, { ok: true, result: [] });
    };
    await pollBot(file, fetchImpl, { maxLoops: 1, sleep: async () => {}, now: () => NOW });
    const poll = urls.find((u) => u.indexOf('/getUpdates') >= 0)!;
    expect(decodeURIComponent(poll.split('allowed_updates=')[1])).toBe('["message","callback_query","channel_post"]');
  });

  it('deletes the «pinned a message» post of the OMP channel and nothing else', async () => {
    const file = await dbFile();
    const calls: Call[] = [];
    let polled = false;
    const fetchImpl = async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      if (String(url).indexOf('/getUpdates') >= 0) {
        if (polled) return jsonResponse(200, { ok: true, result: [] });
        polled = true;
        return jsonResponse(200, {
          ok: true,
          result: [
            { update_id: 1, channel_post: { message_id: 88, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, pinned_message: { message_id: 87 } } },
            { update_id: 2, channel_post: { message_id: 89, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, text: 'релиз' } },
            { update_id: 3, channel_post: { message_id: 90, chat: { id: -2000, type: 'channel', username: 'other' }, pinned_message: { message_id: 1 } } },
          ],
        });
      }
      return jsonResponse(200, { ok: true, result: true });
    };
    await pollBot(file, fetchImpl, { maxLoops: 2, sleep: async () => {}, now: () => NOW, channel: '@ompplyaer' });
    const deletes = calls.filter((c) => c.url.indexOf('/deleteMessage') >= 0);
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(deletes[0].body)).toEqual({ chat_id: -1009, message_id: 88 });
    // the next poll confirms all three updates
    expect(calls.filter((c) => c.url.indexOf('/getUpdates') >= 0)[1].url).toContain('offset=4');
  });

  it('logs a token-free line when Telegram refuses the delete', async () => {
    const file = await dbFile();
    const log = captureStderr();
    const fetchImpl = async (url: string) => {
      if (String(url).indexOf('/getUpdates') >= 0) {
        return jsonResponse(200, {
          ok: true,
          result: [{ update_id: 1, channel_post: { message_id: 88, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, pinned_message: { message_id: 87 } } }],
        });
      }
      if (String(url).indexOf('/deleteMessage') >= 0) return jsonResponse(400, { ok: false, description: 'Bad Request: message can not be deleted' });
      return jsonResponse(200, { ok: true, result: true });
    };
    try {
      await pollBot(file, fetchImpl, { maxLoops: 1, sleep: async () => {}, now: () => NOW, channel: '@ompplyaer' });
      const text = log.lines.join('');
      expect(text).toContain('could not delete the channel pin notice 88');
      expect(text).not.toContain(TOKEN);
    } finally {
      log.restore();
    }
  });

  it('an empty channel setting deletes nothing', async () => {
    const file = await dbFile();
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      if (String(url).indexOf('/getUpdates') >= 0) {
        return jsonResponse(200, {
          ok: true,
          result: [{ update_id: 1, channel_post: { message_id: 88, chat: { id: -1009, type: 'channel', username: 'ompplyaer' }, pinned_message: { message_id: 87 } } }],
        });
      }
      return jsonResponse(200, { ok: true, result: true });
    };
    await pollBot(file, fetchImpl, { maxLoops: 1, sleep: async () => {}, now: () => NOW, channel: '' });
    expect(calls.filter((u) => u.indexOf('/deleteMessage') >= 0)).toHaveLength(0);
  });
});
