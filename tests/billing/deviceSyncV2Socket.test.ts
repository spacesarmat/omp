import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isV2SocketReady, runV2, stopV2Socket } from '../../src/billing/deviceSyncV2Client';
import { saveBillingSession } from '../../src/billing/session';
import { putDeviceRecords, resetDeviceDb } from '../../src/store/deviceDb';
import { resetDeviceV2Db } from '../../src/store/deviceV2Db';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  message(data: unknown) { if (this.onmessage) this.onmessage({ data: JSON.stringify(data) }); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
}

const first = { id: 'progress:a:1', kind: 'progress', key: 'a:1', body: { time: 1 }, updatedAt: 100, deviceId: 'device', deleted: false };

beforeEach(async () => {
  localStorage.clear();
  resetDeviceDb();
  FakeSocket.instances = [];
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
  vi.stubGlobal('WebSocket', FakeSocket);
  resetDeviceV2Db();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('omp-sync-v2');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  resetDeviceV2Db();
});

afterEach(() => {
  stopV2Socket();
  vi.unstubAllGlobals();
  saveBillingSession(null);
});

describe('V2 socket transport integration', () => {
  it('uses HTTP for initial resume and WebSocket for the next local mutation', async () => {
    const fetched = vi.fn((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({
          ok: true, records: [], nextRevision: 1,
          ack: body.records.map((row: any, index: number) => ({ recordId: row.id, mutationId: row.mutationId, revision: index + 1 })),
        }),
      });
    });
    vi.stubGlobal('fetch', fetched);
    putDeviceRecords([first]);
    expect(await runV2('acc-1', 0, () => true)).toBe('ok');
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.open();
    await vi.waitFor(() => expect(socket.sent.some((message) => message.type === 'auth')).toBe(true));
    socket.message({ type: 'ready' });
    await vi.waitFor(() => expect(socket.sent.some((message) => message.type === 'resume')).toBe(true));
    socket.message({ type: 'changes', records: [], nextRevision: 1 });
    await vi.waitFor(() => expect(isV2SocketReady()).toBe(true));

    const second = { ...first, id: 'progress:a:2', updatedAt: 101 };
    putDeviceRecords([second]);
    const syncing = runV2('acc-1', 0, () => true);
    await vi.waitFor(() => expect(socket.sent.some((message) => message.type === 'mutations')).toBe(true));
    const sent = socket.sent.find((message) => message.type === 'mutations');
    expect(sent.records.map((row: any) => row.id)).toEqual([second.id]);
    socket.message({ type: 'ack', ack: [{ recordId: second.id, mutationId: sent.records[0].mutationId, revision: 2 }] });
    expect(await syncing).toBe('ok');
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
