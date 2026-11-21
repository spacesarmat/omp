import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createSyncSocket } from '../src/syncSocket.mjs';

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

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

async function start(options: Record<string, unknown> = {}) {
  const listeners = new Set<(accountId: string, changes: unknown[]) => void>();
  const records: Array<Record<string, unknown>> = [];
  const clients = new Set<WebSocket>();
  const publish = (accountId: string, changes: Array<Record<string, unknown>>) => {
    records.push(...changes);
    for (const listener of listeners) listener(accountId, changes);
  };
  const hub = createSyncSocket({
    authorize: async (token: string, deviceId: string) => {
      if (token !== 'ok') throw Object.assign(new Error('bad_token'), { code: 'bad_token' });
      return { accountId: deviceId.startsWith('other-') ? 'account-b' : 'account-a' };
    },
    seen: async () => {},
    pull: async (accountId: string, since: number) => records.filter((record) => record.revision as number > since).slice(0, 500),
    mutate: async (accountId: string, deviceId: string, incoming: Array<Record<string, unknown>>) => {
      const revision = records.length + 1;
      const change = { ...incoming[0], deviceId, revision };
      publish(accountId, [change]);
      return [{ recordId: change.id, mutationId: change.mutationId, revision }];
    },
    onChanges: (listener: (accountId: string, changes: unknown[]) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now: () => 1000,
    authTimeoutMs: 50,
    heartbeatMs: 1000,
    ...options,
  });
  const server = createServer();
  server.on('upgrade', hub.handleUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test port');
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/v2/sync/ws`);
    clients.add(ws);
    const queue: Array<Record<string, unknown>> = [];
    const waiting: Array<(value: Record<string, unknown>) => void> = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
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
      send(message: unknown) {
        ws.send(typeof message === 'string' ? message : JSON.stringify(message));
      },
      next(timeout = 1000): Promise<Record<string, unknown>> {
        if (queue.length) return Promise.resolve(queue.shift()!);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('message timeout')), timeout);
          waiting.push((value) => {
            clearTimeout(timer);
            resolve(value);
          });
        });
      },
      closed(): Promise<{ code: number; reason: string }> {
        return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
      },
      async auth(deviceId = 'device-a') {
        this.send({ type: 'auth', token: 'ok', deviceId });
        expect(await this.next()).toEqual({ type: 'ready', serverTime: 1000 });
      },
    };
  }
  return { connect, publish, records };
}

describe('sync websocket protocol', () => {
  it('authenticates, resumes, pings and acknowledges mutations', async () => {
    const { connect } = await start();
    const client = await connect();
    await client.auth();
    client.send({ type: 'resume', since: 0 });
    expect(await client.next()).toEqual({ type: 'changes', records: [], nextRevision: 0, serverTime: 1000 });
    client.send({ type: 'ping' });
    expect(await client.next()).toEqual({ type: 'pong', serverTime: 1000 });
    client.send({ type: 'mutations', records: [row] });
    const changed = await client.next();
    expect(changed.type).toBe('changes');
    expect(changed.records).toEqual([{ ...row, revision: 1 }]);
    expect(changed.nextRevision).toBe(1);
    expect(await client.next()).toEqual({
      type: 'ack',
      ack: [{ recordId: row.id, mutationId: row.mutationId, revision: 1 }],
      serverTime: 1000,
    });
  });

  it('closes invalid and unauthenticated connections without data', async () => {
    const { connect } = await start({ authTimeoutMs: 30 });
    const invalid = await connect();
    const invalidClosed = invalid.closed();
    invalid.send({ type: 'auth', token: 'bad', deviceId: 'device-a' });
    expect(await invalidClosed).toEqual({ code: 1008, reason: 'bad_token' });
    const idle = await connect();
    expect(await idle.closed()).toEqual({ code: 1008, reason: 'auth_timeout' });
  });

  it('buffers live changes until a pending resume finishes', async () => {
    const gate = deferred();
    const historical = { ...row, revision: 1 };
    const { connect, publish } = await start({
      pull: async () => gate.promise,
    });
    const client = await connect();
    await client.auth();
    client.send({ type: 'resume', since: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    publish('account-a', [{ ...row, id: 'progress:abc:2', mutationId: 'mutation-2', revision: 2 }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.resolve([historical]);
    expect((await client.next()).records).toEqual([historical]);
    const live = await client.next();
    expect(live.type).toBe('changes');
    expect(live.records).toEqual([{ ...row, id: 'progress:abc:2', mutationId: 'mutation-2', revision: 2 }]);
    expect(live.nextRevision).toBe(2);
  });

  it('reports malformed messages, expired mutations and oversized batches', async () => {
    const { connect } = await start({
      mutate: async () => { throw Object.assign(new Error('expired'), { code: 'mutation_expired' }); },
    });
    const client = await connect();
    await client.auth();
    client.send({ type: 'unknown' });
    expect(await client.next()).toEqual({ type: 'error', code: 'bad_message' });
    client.send('{bad json');
    expect(await client.next()).toEqual({ type: 'error', code: 'bad_message' });
    client.send({ type: 'mutations', records: [row] });
    expect(await client.next()).toEqual({ type: 'error', code: 'mutation_expired' });
    client.send({ type: 'mutations', records: Array.from({ length: 201 }, () => ({ mutationId: 'm' })) });
    expect(await client.next()).toEqual({ type: 'error', code: 'too_many' });
  });

  it('rejects incoming messages above 8 KiB', async () => {
    const { connect } = await start();
    const client = await connect();
    await client.auth();
    const closed = client.closed();
    client.send({ type: 'ping', padding: 'x'.repeat(8200) });
    expect((await closed).code).toBe(1009);
  });

  it('enforces per-device and per-account connection limits', async () => {
    const deviceHub = await start();
    for (let i = 0; i < 5; i++) {
      const client = await deviceHub.connect();
      await client.auth();
    }
    const extraDevice = await deviceHub.connect();
    const deviceClosed = extraDevice.closed();
    extraDevice.send({ type: 'auth', token: 'ok', deviceId: 'device-a' });
    expect(await deviceClosed).toEqual({ code: 1008, reason: 'too_many_devices' });
    const accountHub = await start();
    for (let i = 0; i < 20; i++) {
      const client = await accountHub.connect();
      await client.auth(`device-${i}`);
    }
    const extraAccount = await accountHub.connect();
    const accountClosed = extraAccount.closed();
    extraAccount.send({ type: 'auth', token: 'ok', deviceId: 'device-20' });
    expect(await accountClosed).toEqual({ code: 1008, reason: 'too_many_accounts' });
  });

  it('disconnects a slow client for reconnect and resume', async () => {
    let slow = false;
    const { connect, publish } = await start({ bufferedAmount: (ws: WebSocket) => slow ? 1_048_577 : ws.bufferedAmount });
    const client = await connect();
    await client.auth();
    slow = true;
    const closed = client.closed();
    publish('account-a', [{ ...row, revision: 1 }]);
    expect(await closed).toEqual({ code: 1013, reason: 'backpressure' });
  });

  it('terminates a client that does not answer heartbeat pings', async () => {
    const { connect } = await start({ heartbeatMs: 20 });
    const client = await connect();
    await client.auth();
    const socket = (client.ws as unknown as { _socket: { write: (...args: unknown[]) => boolean } })._socket;
    const write = socket.write.bind(socket);
    socket.write = (chunk: unknown, ...args: unknown[]) => {
      if (Buffer.isBuffer(chunk) && (chunk[0] & 0x0f) === 10) return true;
      return write(chunk, ...args);
    };
    expect((await client.closed()).code).toBe(1006);
  });

  it('sends protocol heartbeat pings', async () => {
    const { connect } = await start({ heartbeatMs: 20 });
    const client = await connect();
    await client.auth();
    const ping = new Promise<void>((resolve) => client.ws.once('ping', () => resolve()));
    await ping;
  });
});
