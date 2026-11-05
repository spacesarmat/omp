import { afterEach, describe, expect, it } from 'vitest';
import { activate, createSubscription, deviceCode, ensureTelegramAccount, issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { bindDhtStats, resetDhtStats } from '../src/dhtStats.mjs';
import { readState, testStore, writeState } from './pg';

const TOKEN = 'cd'.repeat(16);
const HASH = 'ab'.repeat(20);
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);

afterEach(() => {
  resetDhtStats();
  bindDhtStats(null);
});

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
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

async function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = {};
  }
  return { status: res.status, data, headers: res.headers, body: res.body };
}

function net() {
  return async (url: string) => {
    if (String(url).indexOf('/v1/peers') >= 0) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ peers: 1, source: 'dht', approx: true }) };
    }
    return { status: 200, headers: { get: () => null }, text: async () => '{}', json: async () => ({ ok: true }) };
  };
}

async function setup(env: Record<string, string>) {
  const file = await testStore();
  const now = Date.now();
  const opened = ensureTelegramAccount(emptyState(), '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV_A, now });
  act.state.settings.baseDevices = 5;
  await writeState(file, act.state);
  const app = createApp(file, net(), {
    env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN, ...env },
    monitor: { health: () => null },
  });
  return { file, app, subscriptionId: created.result.subscriptionId };
}

async function pair(t: Awaited<ReturnType<typeof setup>>, deviceId: string) {
  const slot = deviceCode(await readState(t.file), t.subscriptionId, Date.now());
  await writeState(t.file, slot.state);
  const out = await call(t.app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId, tokens: 'pair' } });
  expect(out.status).toBe(200);
  return out.data.accessToken as string;
}

function peers(app: (req: unknown, res: unknown) => Promise<void>, token: string, deviceId: string) {
  return call(app, 'GET', '/v1/dht-peers?infohash=' + HASH, {
    headers: { authorization: 'Bearer ' + token, 'x-device-id': deviceId },
  });
}

async function saveLimit(t: Awaited<ReturnType<typeof setup>>, value: string) {
  const now = Date.now();
  const issued = await t.file.update((cur: unknown) => issueCliAdminLogin(cur as never, { now }));
  const token = (issued as { token: string }).token;
  const once = await call(t.app, 'GET', '/admin/login/once?token=' + encodeURIComponent(token));
  const m = /omp_admin=([^;]+)/.exec(String(once.headers['set-cookie'] || ''));
  expect(m).toBeTruthy();
  const cookie = 'omp_admin=' + m![1];
  const home = await call(t.app, 'GET', '/admin/api/home', { headers: { cookie } });
  const csrf = home.data.csrf as string;
  await call(t.app, 'POST', '/admin/settings', { headers: { cookie }, body: { csrf, dhtPerMinute: value } });
}

describe('DHT per-minute limit', () => {
  it('defaults to 30 per minute and blocks the 31st call', async () => {
    const t = await setup({});
    const token = await pair(t, DEV_B);
    for (let i = 0; i < 30; i++) {
      const res = await peers(t.app, token, DEV_B);
      expect(res.status).toBe(200);
    }
    const blocked = await peers(t.app, token, DEV_B);
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toBe('rate');
  });

  it('uses BILLING_DHT_DEVICE_MAX only until the setting is saved, then the saved number wins', async () => {
    const t = await setup({ BILLING_DHT_DEVICE_MAX: '2', BILLING_DHT_WINDOW_SEC: '600' });
    const first = await pair(t, DEV_B);
    expect((await peers(t.app, first, DEV_B)).status).toBe(200);
    expect((await peers(t.app, first, DEV_B)).status).toBe(200);
    expect((await peers(t.app, first, DEV_B)).status).toBe(429);

    await saveLimit(t, '30');
    expect((await readState(t.file)).settings.dhtPerMinute).toBe(30);
    const second = await pair(t, 'c'.repeat(32));
    expect((await peers(t.app, second, 'c'.repeat(32))).status).toBe(200);
    expect((await peers(t.app, second, 'c'.repeat(32))).status).toBe(200);
    expect((await peers(t.app, second, 'c'.repeat(32))).status).toBe(200);

    await saveLimit(t, 'nope');
    expect((await readState(t.file)).settings.dhtPerMinute).toBe(30);

    await saveLimit(t, '0');
    expect((await readState(t.file)).settings.dhtPerMinute).toBe(0);
    const third = await pair(t, 'd'.repeat(32));
    for (let i = 0; i < 5; i++) expect((await peers(t.app, third, 'd'.repeat(32))).status).toBe(200);
  });
});
