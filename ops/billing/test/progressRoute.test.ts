import { describe, expect, it } from 'vitest';
import { createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

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

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.json === undefined ? '' : JSON.stringify(opts.json);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': opts.json === undefined ? '' : 'application/json',
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
  return { status: res.status, data };
}

async function tokenFor(app: (req: unknown, res: unknown) => Promise<void>, file: Awaited<ReturnType<typeof testStore>>, accountId: string, deviceId: string) {
  const now = Date.now();
  const created = createSubscription(await readState(file), { accountId, now, days: 30 });
  await writeState(file, created.state);
  const slot = deviceCode(await readState(file), created.result.subscriptionId, now);
  await writeState(file, slot.state);
  const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId, tokens: 'pair' } });
  expect(activated.status).toBe(200);
  return activated.data.accessToken as string;
}

describe('GET and POST /v1/progress', () => {
  it('stores a position for the account and shows it as another device', async () => {
    const file = await testStore();
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
    });
    const denied = await call(app, 'POST', '/v1/progress', { json: { titleKey: 'show', episodeKey: 's01e02', positionSec: 90 } });
    expect(denied.status).toBe(401);

    const tokenA = await tokenFor(app, file, 'acc-progress', DEV_A);
    const headersA = { authorization: 'Bearer ' + tokenA, 'x-device-id': DEV_A };
    const bad = await call(app, 'POST', '/v1/progress', { json: { titleKey: '', episodeKey: 's01e02', positionSec: 0 }, headers: headersA });
    expect(bad.status).toBe(400);

    const saved = await call(app, 'POST', '/v1/progress', {
      json: { titleKey: 'show', episodeKey: 's01e02', positionSec: 95, durationSec: 2400, title: 'Show', label: 'S01E02' },
      headers: headersA,
    });
    expect(saved.status).toBe(200);

    const own = await call(app, 'GET', '/v1/progress?titleKey=show&episodeKey=s01e02', { headers: headersA });
    expect(own.status).toBe(200);
    expect(own.data.positionSec).toBe(95);
    expect(own.data.otherDevice).toBe(false);
    expect(own.data.deviceId).toBeUndefined();

    const tokenB = await tokenFor(app, file, 'acc-progress', DEV_B);
    const other = await call(app, 'GET', '/v1/progress?titleKey=show&episodeKey=s01e02', {
      headers: { authorization: 'Bearer ' + tokenB, 'x-device-id': DEV_B },
    });
    expect(other.status).toBe(200);
    expect(other.data.positionSec).toBe(95);
    expect(other.data.otherDevice).toBe(true);

    const tokenC = await tokenFor(app, file, 'acc-other', DEV_C);
    const hidden = await call(app, 'GET', '/v1/progress?titleKey=show&episodeKey=s01e02', {
      headers: { authorization: 'Bearer ' + tokenC, 'x-device-id': DEV_C },
    });
    expect(hidden.status).toBe(404);
  });
});
