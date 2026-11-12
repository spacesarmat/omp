import { describe, expect, it, afterEach } from 'vitest';
import { confirmAdminPanelLogin, issueCliAdminLogin, startAdminPanelLogin } from '../src/logic.mjs';
import { botCopyRepoFor, createBotCopyRepo, resetCopyCache } from '../src/botCopyStore.mjs';
import { pollBot } from '../src/server.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { testStore, updateState, writeState } from './pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: Buffer.alloc(0),
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''));
    },
  };
}

async function call(app: Any, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(opts.headers || {}) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Any = null;
  try {
    data = JSON.parse(res.body.toString('utf8'));
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, data };
}

const sent: { url: string; body: string }[] = [];
const fetchImpl = async (url: string, init?: { body?: string }) => {
  sent.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9 } }), text: async () => '', headers: {} };
};

async function cliAdmin(store: Any, app: Any) {
  const link = await updateState(store, (s: Any) => issueCliAdminLogin(s, { now: Date.now() }));
  const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
  const cookie = String(once.headers['set-cookie'] || '').split(';')[0];
  const home = await call(app, 'GET', '/admin/api/home', { headers: { cookie } });
  return { cookie, csrf: home.data.csrf as string };
}

async function telegramAdmin(store: Any, app: Any, telegramId: string) {
  const started = await updateState(store, (s: Any) => startAdminPanelLogin(s, { now: Date.now() }));
  await updateState(store, (s: Any) => confirmAdminPanelLogin(s, { token: started.token, telegramId, now: Date.now() }));
  const status = await call(app, 'GET', '/admin/login/telegram/status?token=' + encodeURIComponent(started.token));
  const cookie = String(status.headers['set-cookie'] || '').split(';')[0];
  const home = await call(app, 'GET', '/admin/api/home', { headers: { cookie } });
  return { cookie, csrf: home.data.csrf as string };
}

afterEach(() => {
  resetCopyCache();
  sent.length = 0;
});

describe('bot copy store', () => {
  it('keeps history, restores a version, and reset falls back to the in-code text', async () => {
    const store = await testStore();
    const repo = createBotCopyRepo(store, { checkMs: 0 });
    const other = createBotCopyRepo(store, { checkMs: 0 });
    const first = await repo.save(
      { id: 'promo.bad', state: '', lang: '', body: 'Нет такого кода', buttons: null, mediaKind: '', mediaUrl: '' },
      '777',
      1000,
    );
    expect(first.ok).toBe(true);
    await repo.save(
      { id: 'promo.bad', state: 'active', lang: 'en', body: 'Unknown code', buttons: null, mediaKind: '', mediaUrl: '' },
      '777',
      2000,
    );
    const applied = await other.apply({ id: 'promo.bad', state: 'active', lang: 'en', vars: {} }, { text: 'из кода' });
    expect(applied.used).toBe('template');
    expect(applied.text).toBe('Unknown code');
    const fallback = await other.apply({ id: 'promo.bad', state: 'expired', lang: '', vars: {} }, { text: 'из кода' });
    expect(fallback.text).toBe('Нет такого кода');
    const history = await repo.history('promo.bad', '', '');
    expect(history[0].author).toBe('777');
    expect(history[0].at).toBe(1000);
    expect(history[0].action).toBe('save');
    await repo.save(
      { id: 'promo.bad', state: '', lang: '', body: 'Второй текст', buttons: null, mediaKind: '', mediaUrl: '' },
      '778',
      3000,
    );
    const again = await repo.history('promo.bad', '', '');
    const older = again.find((row) => row.body === 'Нет такого кода');
    expect(older).toBeTruthy();
    const restored = await repo.restore('promo.bad', older!.id, '778', 4000);
    expect(restored.ok).toBe(true);
    expect((await repo.lookup('promo.bad', '', ''))!.body).toBe('Нет такого кода');
    const cleared = await repo.reset('promo.bad', '', '', '778', 5000);
    expect(cleared.cleared).toBe(true);
    expect(await repo.lookup('promo.bad', '', '')).toBeNull();
    const code = await repo.apply({ id: 'promo.bad', state: '', lang: '', vars: {} }, { text: 'из кода', parseMode: 'Markdown' });
    expect(code.used).toBe('code');
    expect(code.text).toBe('из кода');
    expect(code.parseMode).toBe('Markdown');
  });

  it('rejects an unknown variable and does not store it', async () => {
    const store = await testStore();
    const repo = createBotCopyRepo(store, { checkMs: 0 });
    const bad = await repo.save({ id: 'promo.bad', body: 'Привет {nope}', buttons: null, mediaKind: '', mediaUrl: '' }, '1', 1);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('{nope}');
    expect(await repo.lookup('promo.bad', '', '')).toBeNull();
  });
});

describe('bot copy admin API', () => {
  it('requires a session and csrf, blocks a reader, and sends a preview to the admin', async () => {
    const store = await testStore();
    const state = emptyState();
    state.settings.botToken = 'bot-token-test';
    state.settings.adminTelegramIds = '777';
    state.settings.adminReaders = '555';
    await writeState(store, state);
    const app = createApp(store, fetchImpl, { env: {} });

    expect((await call(app, 'GET', '/admin/api/bot-replies')).status).toBe(401);

    const admin = await cliAdmin(store, app);
    const list = await call(app, 'GET', '/admin/api/bot-replies', { headers: { cookie: admin.cookie } });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.data.templates)).toContain('cabinet.home');
    expect(JSON.stringify(list.data)).not.toContain('bot-token-test');

    const noCsrf = await call(app, 'POST', '/admin/api/bot-replies/save', {
      headers: { cookie: admin.cookie },
      body: { id: 'promo.bad', body: 'Новый текст' },
    });
    expect(noCsrf.status).toBe(403);

    const saved = await call(app, 'POST', '/admin/api/bot-replies/save', {
      headers: { cookie: admin.cookie },
      body: { csrf: admin.csrf, id: 'promo.bad', state: '', lang: '', body: 'Код <b>не</b> найден', buttons: null, mediaKind: '', mediaUrl: '' },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.ok).toBe(true);

    const one = await call(app, 'GET', '/admin/api/bot-replies?id=promo.bad', { headers: { cookie: admin.cookie } });
    expect(one.data.variant.customized).toBe(true);
    expect(one.data.variant.body).toContain('<b>не</b>');
    expect(one.data.history.length).toBeGreaterThan(0);

    const reader = await telegramAdmin(store, app, '555');
    const denied = await call(app, 'POST', '/admin/api/bot-replies/save', {
      headers: { cookie: reader.cookie },
      body: { csrf: reader.csrf, id: 'promo.bad', body: 'Чужой текст', buttons: null, mediaKind: '', mediaUrl: '' },
    });
    expect(denied.status).toBe(403);

    const owner = await telegramAdmin(store, app, '777');
    sent.length = 0;
    const preview = await call(app, 'POST', '/admin/api/bot-replies/send', {
      headers: { cookie: owner.cookie },
      body: {
        csrf: owner.csrf,
        id: 'cabinet.home',
        state: '',
        lang: '',
        body: 'Привет, {name} {status}',
        buttons: [[{ text: 'Сайт', kind: 'url', value: 'https://omp-player.online' }]],
        mediaKind: 'photo',
        mediaUrl: 'https://omp-player.online/a.jpg',
      },
    });
    expect(preview.status).toBe(200);
    expect(preview.data.ok).toBe(true);
    expect(sent.some((row) => row.url.indexOf('sendPhoto') >= 0 && row.body.indexOf('777') >= 0 && row.body.indexOf('Анна') >= 0)).toBe(true);
    expect(JSON.stringify(preview.data)).not.toContain('bot-token-test');
  });

  it('a saved cabinet template replaces the live greeting and leaves it alone before that', async () => {
    const store = await testStore();
    const state = emptyState();
    state.settings.botToken = 'bot-token-test';
    await writeState(store, state);
    const repo = botCopyRepoFor(store);
    const calls: { url: string; body: string }[] = [];
    let polls = 0;
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        text: '/start',
        chat: { id: 42, type: 'private' },
        from: { id: 42, first_name: 'Ann', language_code: 'ru' },
      },
    };
    const net = async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
      if (String(url).indexOf('getUpdates') >= 0) {
        polls += 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, result: polls === 1 ? [update] : [] }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 3 } }), text: async () => '' };
    };
    await pollBot(store, net, { maxLoops: 1, sleep: async () => {}, now: () => Date.now() });
    const before = calls.find((row) => row.url.indexOf('sendMessage') >= 0);
    expect(before && before.body.indexOf('Личный кабинет') >= 0).toBe(true);
    expect(before && before.body.indexOf('HELLO') >= 0).toBe(false);

    await repo.save(
      { id: 'cabinet.home', state: '', lang: 'ru', body: 'HELLO {name} {status}', buttons: null, mediaKind: '', mediaUrl: '' },
      '777',
      Date.now(),
    );
    calls.length = 0;
    polls = 0;
    await pollBot(store, net, { maxLoops: 1, sleep: async () => {}, now: () => Date.now() });
    const after = calls.find((row) => row.url.indexOf('sendMessage') >= 0);
    expect(after && after.body.indexOf('HELLO') >= 0).toBe(true);
    expect(after && after.body.indexOf('Ann') >= 0).toBe(true);
  });
});
