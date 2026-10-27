import { afterEach, describe, expect, it } from 'vitest';
import { BOT_POLL_ERROR_LOG_EVERY_MS, noteBotPollOk, resetBotPollState } from '../src/botPoll.mjs';
import { ensureTelegramAccount } from '../src/logic.mjs';
import { healthPayload, pollBot, refreshMissingProfiles, telegramCall, TG_POLL_TIMEOUT_MS, TG_SEND_TIMEOUT_MS } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { writeState, testStore } from './pg';

const NOW = Date.parse('2026-10-19T10:00:00Z');
const TOKEN = 'timeout-test-token';

/** Never settles and ignores the abort signal: the worst a stuck connection can do. */
const hang = () => new Promise<never>(() => {});

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

async function dbFile(withAccount = false) {
  const file = await testStore();
  let state = emptyState();
  state.settings.botToken = TOKEN;
  state.settings.adminNotify = false;
  if (withAccount) state = ensureTelegramAccount(state, '42', NOW).state;
  await writeState(file, state);
  return file;
}

afterEach(() => resetBotPollState());

describe('Telegram timeouts', () => {
  it('uses 40 s for getUpdates and 15 s for sendMessage / getChat', () => {
    expect(TG_POLL_TIMEOUT_MS).toBe(40000);
    expect(TG_SEND_TIMEOUT_MS).toBe(15000);
  });

  it('telegramCall ends a fetch that never resolves and ignores the signal', async () => {
    let signal: AbortSignal | undefined;
    const started = Date.now();
    await expect(
      telegramCall(
        (_url: string, init: { signal: AbortSignal }) => {
          signal = init.signal;
          return hang();
        },
        'https://api.telegram.org/botX/getMe',
        {},
        50,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signal && signal.aborted).toBe(true);
  });

  it('telegramCall returns status and JSON, and {} for a non-JSON body', async () => {
    const ok = await telegramCall(async () => ({ status: 200, ok: true, json: async () => ({ ok: true, result: [] }) }), 'u', {}, 1000);
    expect(ok.res.status).toBe(200);
    expect(ok.data).toEqual({ ok: true, result: [] });
    const bad = await telegramCall(async () => ({ status: 502, ok: false, json: async () => { throw new Error('html'); } }), 'u', {}, 1000);
    expect(bad.data).toEqual({});
  });

  it('a hanging getUpdates does not stall the poll loop; the failure is logged once a minute without the token', async () => {
    const file = await dbFile();
    const log = captureStderr();
    let slept = 0;
    try {
      const started = Date.now();
      await pollBot(file, () => hang(), { maxLoops: 1, pollTimeoutMs: 50, sleep: async () => { slept += 1; }, now: () => NOW });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(slept).toBe(1);
      expect(log.lines.join('')).toBe('telegram getUpdates failed: timeout\n');
      // Inside the minute: quiet, but counted.
      await pollBot(file, () => hang(), { maxLoops: 2, pollTimeoutMs: 20, sleep: async () => {}, now: () => NOW + 1000 });
      expect(log.lines).toHaveLength(1);
      // A minute later: one line with the number of quiet failures.
      const httpFail = async () => ({ status: 502, ok: false, json: async () => ({ ok: false, error_code: 502 }) });
      await pollBot(file, httpFail, { maxLoops: 1, sleep: async () => {}, now: () => NOW + BOT_POLL_ERROR_LOG_EVERY_MS });
      expect(log.lines).toHaveLength(2);
      expect(log.lines[1]).toBe('telegram getUpdates failed: http 502 code 502 (+2 more since the last line)\n');
      expect(log.lines.join('')).not.toContain(TOKEN);
      expect(log.lines.join('')).not.toContain('api.telegram.org');
    } finally {
      log.restore();
    }
  });

  it('a network error is logged as network, never with its message', async () => {
    const file = await dbFile();
    const log = captureStderr();
    try {
      await pollBot(
        file,
        async (url: string) => {
          throw new Error('connect ECONNREFUSED ' + url);
        },
        { maxLoops: 1, sleep: async () => {}, now: () => NOW },
      );
      expect(log.lines.join('')).toBe('telegram getUpdates failed: network\n');
    } finally {
      log.restore();
    }
  });

  it('a hanging sendMessage times out and polling goes on', async () => {
    const file = await dbFile();
    let polls = 0;
    const fetchImpl = (url: string) => {
      if (url.indexOf('getUpdates') >= 0) {
        polls += 1;
        const result = polls === 1 ? [{ update_id: 1, message: { chat: { id: 42 }, text: '/start', from: { username: 'u' } } }] : [];
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, result }) });
      }
      return hang();
    };
    const started = Date.now();
    await pollBot(file, fetchImpl, { maxLoops: 2, sendTimeoutMs: 30, sleep: async () => {}, now: () => NOW });
    expect(polls).toBe(2);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('refreshMissingProfiles gives up on a hanging getChat', async () => {
    const file = await dbFile(true);
    const started = Date.now();
    await refreshMissingProfiles(file, TOKEN, () => hang(), { timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('/health bot fields', () => {
  it('reports botPollOkAgoSec from the last good getUpdates, null before the first one', () => {
    expect(healthPayload(NOW)).toEqual({ ok: true, botPollEnabled: true, botPollOkAgoSec: null });
    noteBotPollOk(NOW - 42_500);
    expect(healthPayload(NOW)).toEqual({ ok: true, botPollEnabled: true, botPollOkAgoSec: 42 });
    expect(JSON.stringify(healthPayload(NOW))).not.toContain('token');
    // «Мониторинг» freshness for the external watchdog
    expect(healthPayload(NOW, { monitor: { scheduled: true, lastRunAt: NOW - 600_000, intervalMin: 15 } })).toMatchObject({
      monitorScheduled: true,
      monitorAgoSec: 600,
      monitorIntervalMin: 15,
    });
    expect(healthPayload(NOW, { monitor: { scheduled: false, lastRunAt: 0, intervalMin: 15 } })).toMatchObject({ monitorScheduled: false, monitorAgoSec: null });
  });
});
