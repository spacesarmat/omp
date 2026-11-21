import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.mjs';
import { createSubscription, deviceCode } from '../src/logic.mjs';
import { readState, testStore, writeState } from './pg';

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_OTHER = 'c'.repeat(32);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(status: number) { this.status = status; },
    setHeader() {},
    end(buf?: Buffer | string) { this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || ''); },
  };
}

async function call(app: (req: unknown, res: unknown) => Promise<void>, path: string, json: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const req = {
    method,
    url: path,
    headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(json)); },
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, data: JSON.parse(res.body) as Record<string, any> };
}

async function tokenFor(app: (req: unknown, res: unknown) => Promise<void>, file: Awaited<ReturnType<typeof testStore>>, accountId: string, deviceId: string) {
  const now = Date.now();
  const created = createSubscription(await readState(file), { accountId, now, days: 30 });
  await writeState(file, created.state);
  const slot = deviceCode(await readState(file), created.result.subscriptionId, now);
  await writeState(file, slot.state);
  const activated = await call(app, '/v1/activate', { code: slot.code, deviceId, tokens: 'pair' });
  expect(activated.status).toBe(200);
  return activated.data.accessToken as string;
}

async function setup(options: { readOnly?: boolean } = {}) {
  const file = await testStore();
  let app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
    env: {},
    monitor: { health: () => null },
  });
  const tokenA = await tokenFor(app, file, 'acc-ws', DEV_A);
  const tokenB = await tokenFor(app, file, 'acc-ws', DEV_B);
  const tokenOther = await tokenFor(app, file, 'acc-other', DEV_OTHER);
  if (options.readOnly) {
    app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
      readOnly: true,
    });
  }
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => (app as any).syncUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const sockets = new Set<WebSocket>();
  cleanups.push(async () => {
    for (const socket of sockets) socket.terminate();
    if ((app as any).syncClose) (app as any).syncClose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/v2/sync/ws`);
    sockets.add(ws);
    const queue: Record<string, any>[] = [];
    const waiting: Array<(value: Record<string, any>) => void> = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiter = waiting.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return {
      ws,
      send(message: unknown) { ws.send(JSON.stringify(message)); },
      next(): Promise<Record<string, any>> {
        if (queue.length) return Promise.resolve(queue.shift()!);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('message timeout')), 1500);
          waiting.push((value) => { clearTimeout(timer); resolve(value); });
        });
      },
      closed(): Promise<{ code: number; reason: string }> {
        return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
      },
      async auth(token: string) {
        this.send({ type: 'auth', token, deviceId: token === tokenA ? DEV_A : token === tokenB ? DEV_B : DEV_OTHER });
        const ready = await this.next();
        expect(ready.type).toBe('ready');
      },
    };
  }
  return { app, connect, tokenA, tokenB, tokenOther };
}

const row = {
  id: 'progress:abc:1',
  kind: 'progress',
  key: 'abc:1',
  body: { time: 40 },
  updatedAt: 100,
  deviceId: 'device-a',
  deleted: false,
  mutationId: 'mutation-1',
};

describe('billing sync websocket', () => {
  it('broadcasts HTTP and WS writes only to its account and resumes after reconnect', async () => {
    const { app, connect, tokenA, tokenB, tokenOther } = await setup();
    const a = await connect();
    const b = await connect();
    const other = await connect();
    await a.auth(tokenA);
    await b.auth(tokenB);
    await other.auth(tokenOther);
    for (const client of [a, b, other]) {
      client.send({ type: 'resume', since: 0 });
      expect((await client.next()).records).toEqual([]);
    }
    const headersA = { authorization: 'Bearer ' + tokenA, 'x-device-id': DEV_A };
    const legacy = { ...row, mutationId: undefined };
    expect((await call(app, '/v1/sync', { since: 0, records: [legacy] }, headersA)).status).toBe(200);
    expect((await a.next()).records[0]).toMatchObject({ id: row.id, revision: 1, body: { time: 40 } });
    expect((await b.next()).records[0]).toMatchObject({ id: row.id, revision: 1, body: { time: 40 } });
    other.send({ type: 'mutations', records: [{ ...row, id: 'progress:other', mutationId: 'other-mutation' }] });
    expect((await other.next()).records[0]).toMatchObject({ id: 'progress:other', revision: 1 });
    expect((await other.next()).type).toBe('ack');
    const second = { ...row, id: 'progress:abc:2', key: 'abc:2', body: { time: 80 }, updatedAt: 200, mutationId: 'ws-mutation' };
    b.send({ type: 'mutations', records: [second] });
    expect((await b.next()).records[0]).toMatchObject({ id: second.id, revision: 2, body: { time: 80 } });
    expect((await b.next()).ack).toEqual([{ recordId: second.id, mutationId: second.mutationId, revision: 2 }]);
    expect((await a.next()).records[0]).toMatchObject({ id: second.id, revision: 2, body: { time: 80 } });
    const pulled = await call(app, '/v2/sync', { since: 0, records: [] }, headersA);
    expect(pulled.data.records).toHaveLength(2);
    a.ws.terminate();
    const reconnected = await connect();
    await reconnected.auth(tokenA);
    reconnected.send({ type: 'resume', since: 1 });
    const resumed = await reconnected.next();
    expect(resumed.records).toHaveLength(1);
    expect(resumed.records[0]).toMatchObject({ id: second.id, revision: 2, body: { time: 80 } });
    b.send({ type: 'mutations', records: [{ ...second, body: { time: 999 } }] });
    expect((await b.next()).ack).toEqual([{ recordId: second.id, mutationId: second.mutationId, revision: 2 }]);
    expect((await call(app, '/v2/sync', { since: 2, records: [] }, headersA)).data.records).toEqual([]);
  });

  it('closes a bad token without ready or account data', async () => {
    const { connect } = await setup();
    const client = await connect();
    const closed = client.closed();
    client.send({ type: 'auth', token: 'bad', deviceId: DEV_A });
    expect(await closed).toEqual({ code: 1008, reason: 'bad_token' });
  });

  it('updates, lists and clears authorized HTTP presence', async () => {
    const { app, tokenA, tokenB, tokenOther } = await setup();
    const headersA = { authorization: 'Bearer ' + tokenA, 'x-device-id': DEV_A };
    const value = {
      state: 'playing', sessionId: 'session-http', sessionSeq: 2, hash: 'a'.repeat(40), fileId: 1,
      title: 'Show', episode: 'S01E01', positionSec: 10, durationSec: 100, deviceName: 'LG', platform: 'lg',
      deviceId: DEV_B,
    };
    const saved = await call(app, '/v2/sync/presence', { presence: value }, headersA);
    expect(saved.status).toBe(200);
    expect(saved.data.presences[0]).toMatchObject({ ...value, deviceId: DEV_A });
    const otherDevice = await call(app, '/v2/sync/presence', {}, { authorization: 'Bearer ' + tokenB, 'x-device-id': DEV_B }, 'GET');
    expect(otherDevice.data.presences).toHaveLength(1);
    const otherAccount = await call(app, '/v2/sync/presence', {}, { authorization: 'Bearer ' + tokenOther, 'x-device-id': DEV_OTHER }, 'GET');
    expect(otherAccount.data.presences).toEqual([]);
    expect((await call(app, '/v2/sync/presence', { presence: { ...value, sessionSeq: 1, title: 'Old' } }, headersA)).data.presences[0].title).toBe('Show');
    expect((await call(app, '/v2/sync/presence', { presence: { ...value, hash: 'bad' } }, headersA)).status).toBe(400);
    expect((await call(app, '/v2/sync/presence', { presence: value }, { ...headersA, authorization: 'Bearer bad' })).status).toBe(401);
    expect((await call(app, '/v2/sync/presence', { presence: null }, headersA)).data.presences).toEqual([]);
  });

  it('refuses WebSocket upgrade in read-only mode', async () => {
    const { app, connect, tokenA } = await setup({ readOnly: true });
    await expect(connect()).rejects.toThrow('503');
    const headers = { authorization: 'Bearer ' + tokenA, 'x-device-id': DEV_A };
    expect((await call(app, '/v2/sync/presence', {}, headers, 'GET')).status).toBe(200);
    expect((await call(app, '/v2/sync/presence', { presence: null }, headers)).status).toBe(503);
  });
});
