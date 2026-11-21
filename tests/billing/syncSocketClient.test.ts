import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkSocketMutations, createSyncSocketClient, reconnectDelay, type SyncSocketClient } from '../../src/billing/syncSocketClient';
import type { OutboxRow } from '../../src/store/deviceV2Db';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  message(data: unknown) { if (this.onmessage) this.onmessage({ data: JSON.stringify(data) }); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code }); }
}

const mutation: OutboxRow = {
  mutationId: 'device:1', accountId: 'acc', createdAt: 1,
  row: { id: 'progress:a:1', kind: 'progress', key: 'a:1', body: { time: 1 }, updatedAt: 1, deviceId: 'device', deleted: false, mutationId: 'device:1' },
};

let clients: SyncSocketClient[] = [];
let outbox: OutboxRow[];
let revision: number;
let token: string;
let fallback: ReturnType<typeof vi.fn<() => Promise<string>>>;

function make(options: Record<string, unknown> = {}): SyncSocketClient {
  const client = createSyncSocketClient({
    owner: 'acc', deviceId: 'device', token: () => token, isOwner: () => true,
    readMeta: async () => ({ revision }),
    readOutbox: async () => outbox.filter((row) => !row.blocked),
    accept: async (answer: any, sent: OutboxRow[]) => {
      const ids = new Set((answer.ack || []).map((ack: any) => ack.mutationId));
      outbox = outbox.filter((row) => !ids.has(row.mutationId));
      revision = Math.max(revision, Number(answer.nextRevision) || 0);
      return { blocked: sent.filter((row) => !ids.has(row.mutationId)).length, revision };
    },
    fallback: () => fallback(),
    socketFactory: (url: string) => new FakeSocket(url),
    ackTimeoutMs: 150,
    ...options,
  });
  clients.push(client);
  return client;
}

async function handshake(socket: FakeSocket, since = 0): Promise<void> {
  socket.open();
  await vi.waitFor(() => expect(socket.sent.some((message) => message.type === 'auth')).toBe(true));
  socket.message({ type: 'ready' });
  await vi.waitFor(() => expect(socket.sent.some((message) => message.type === 'resume')).toBe(true));
  expect(socket.url).not.toContain(token);
  expect(socket.sent.find((message) => message.type === 'auth').token).toBe(token);
  expect(socket.sent.find((message) => message.type === 'resume').since).toBe(since);
  socket.message({ type: 'changes', records: [], nextRevision: since });
}

beforeEach(() => {
  FakeSocket.instances = [];
  outbox = [];
  revision = 0;
  token = 'token-one';
  fallback = vi.fn(async () => 'ok');
});

afterEach(() => {
  for (const client of clients) client.stop();
  clients = [];
  vi.useRealTimers();
  vi.clearAllTimers();
});

describe('sync websocket client', () => {
  it('authenticates in a message and resumes before reporting ready', async () => {
    const client = make();
    const syncing = client.sync();
    await handshake(FakeSocket.instances[0]);
    expect(await syncing).toBe('ok');
    expect(FakeSocket.instances[0].url.endsWith('/v2/sync/ws')).toBe(true);
  });

  it('uses bounded exponential reconnect delays and resumes after a disconnect', async () => {
    expect(reconnectDelay(0, 0)).toBe(1000);
    expect(reconnectDelay(1, 0.5)).toBe(2000);
    expect(reconnectDelay(8, 1)).toBe(30000);
    const client = make({ reconnectMinMs: 10, reconnectMaxMs: 40, random: () => 0.5 });
    const first = client.sync();
    await handshake(FakeSocket.instances[0]);
    await first;
    revision = 7;
    FakeSocket.instances[0].close();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    const second = client.sync();
    await handshake(FakeSocket.instances[1], 7);
    expect(await second).toBe('ok');
  });

  it('closes the old connection when the access token rotates', async () => {
    const client = make();
    const first = client.sync();
    await handshake(FakeSocket.instances[0]);
    await first;
    token = 'token-two';
    const second = client.sync();
    await vi.waitFor(() => expect(FakeSocket.instances[0].readyState).toBe(3));
    await handshake(FakeSocket.instances[1]);
    expect(await second).toBe('ok');
    expect(FakeSocket.instances[1].sent.find((message) => message.type === 'auth').token).toBe('token-two');
  });

  it('bounds mutation chunks by count and serialized UTF-8 bytes', () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      ...mutation,
      mutationId: 'device:' + index,
      row: { mutationId: 'device:' + index } as any,
    }));
    const chunks = chunkSocketMutations(rows);
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[1]).toHaveLength(5);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(JSON.stringify(chunk.map((row) => row.row))).length).toBeLessThanOrEqual(7500);
    }
    const large = chunkSocketMutations(Array.from({ length: 100 }, (_, index) => ({
      ...mutation,
      mutationId: 'large:' + index,
      row: { ...mutation.row, id: 'large:' + index, mutationId: 'large:' + index, body: { text: 'x'.repeat(200) } },
    })));
    expect(large.length).toBeGreaterThan(1);
  });

  it('waits for ack timeout before HTTP fallback and clears the WS flight', async () => {
    outbox = [mutation];
    const client = make();
    const syncing = client.sync();
    await handshake(FakeSocket.instances[0]);
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.some((message) => message.type === 'mutations')).toBe(true));
    expect(client.hasInFlight(mutation.mutationId)).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
    expect(await syncing).toBe('ok');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(client.hasInFlight(mutation.mutationId)).toBe(false);
  });
});


describe('sync websocket recovery edges', () => {
  it('falls back when the socket closes before ready', async () => {
    const client = make();
    const syncing = client.sync();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.close();
    const result = await Promise.race([syncing, new Promise((resolve) => setTimeout(() => resolve('timeout'), 250))]);
    expect(result).toBe('ok');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('quarantines one mutation that cannot fit the byte limit', async () => {
    const block = vi.fn(async () => undefined);
    outbox = [{ ...mutation, row: { ...mutation.row, body: { text: 'x'.repeat(8000) } } }];
    const client = make({ block });
    const syncing = client.sync();
    await handshake(FakeSocket.instances[0]);
    expect(await syncing).toBe('error');
    expect(block).toHaveBeenCalledWith(mutation.mutationId, 'too_large');
    expect(fallback).not.toHaveBeenCalled();
  });
});


describe('sync websocket connection failure', () => {
  it('falls back when the connection never opens', async () => {
    const client = make();
    const syncing = client.sync();
    const result = await Promise.race([syncing, new Promise((resolve) => setTimeout(() => resolve('timeout'), 300))]);
    expect(result).toBe('ok');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('contains a synchronous WebSocket constructor failure', () => {
    const client = make({ socketFactory: () => { throw new Error('unsupported'); } });
    expect(() => client.start()).not.toThrow();
  });
});
