import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runV2, setV2SyncContext } from '../../src/billing/deviceSyncV2Client';
import { saveBillingSession } from '../../src/billing/session';
import { putDeviceRecords, resetDeviceDb, unsentRecords } from '../../src/store/deviceDb';
import { readV2Meta, readV2Outbox, resetDeviceV2Db } from '../../src/store/deviceV2Db';
import type { SyncRecord } from '../../src/store/syncMerge';

const row: SyncRecord = { id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 40 }, updatedAt: 100, deviceId: 'device-a', deleted: false };
const owner = () => true;

function answer(data: unknown, status = 200) {
  return { status, json: () => Promise.resolve(data) };
}

async function clean() {
  resetDeviceV2Db();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('omp-sync-v2');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  resetDeviceV2Db();
}

beforeEach(async () => {
  localStorage.clear();
  resetDeviceDb();
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
  await clean();
});
afterEach(() => {
  setV2SyncContext(null);
  vi.unstubAllGlobals();
  saveBillingSession(null);
});

describe('HTTP sync V2', () => {
  it('retries a lost response with the same mutation id and updates legacy ack bookkeeping', async () => {
    putDeviceRecords([row]);
    const ids: string[] = [];
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      ids.push(body.records[0].mutationId);
      calls++;
      if (calls === 1) return Promise.reject(new Error('offline'));
      return Promise.resolve(answer({ ok: true, records: [], nextRevision: 1, ack: [{ recordId: row.id, mutationId: ids[1], revision: 1 }] }));
    }));
    expect(await runV2('acc-1', 0, owner)).toBe('offline');
    expect(await readV2Outbox('acc-1')).toHaveLength(1);
    expect(await runV2('acc-1', 0, owner)).toBe('ok');
    expect(ids[0]).toBe(ids[1]);
    expect(await readV2Outbox('acc-1')).toEqual([]);
    expect(unsentRecords(0)).toEqual([]);
  });

  it('quarantines a missing ack without blocking the accepted record', async () => {
    putDeviceRecords([row, { ...row, id: 'progress:abc:2' }]);
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return Promise.resolve(answer({
        ok: true, records: [], nextRevision: 1,
        ack: [{ recordId: body.records[0].id, mutationId: body.records[0].mutationId, revision: 1 }],
      }));
    }));
    expect(await runV2('acc-1', 0, owner)).toBe('error');
    const pending = await readV2Outbox('acc-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].blocked).toBe('not_accepted');
  });

  it('resumes all 500-record pages and persists revision', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      if (calls === 1) {
        const records = Array.from({ length: 500 }, (_, i) => ({ ...row, id: 'row:' + i, revision: i + 1 }));
        return Promise.resolve(answer({ ok: true, records, nextRevision: 500, ack: [] }));
      }
      return Promise.resolve(answer({ ok: true, records: [], nextRevision: 500, ack: [] }));
    }));
    expect(await runV2('acc-1', 0, owner)).toBe('ok');
    expect(calls).toBe(2);
    expect(await readV2Meta('acc-1')).toMatchObject({ revision: 500 });
  });

  it('does not ack or advance cursor when the account changes in flight', async () => {
    putDeviceRecords([row]);
    let release!: (value: unknown) => void;
    let allowed = true;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve; })));
    const running = runV2('acc-1', 0, () => allowed);
    await new Promise((resolve) => setTimeout(resolve, 20));
    allowed = false;
    release(answer({ ok: true, records: [], nextRevision: 1, ack: [{ recordId: row.id, mutationId: 'wrong', revision: 1 }] }));
    expect(await running).toBe('error');
    expect(await readV2Outbox('acc-1')).toHaveLength(1);
    expect(await readV2Meta('acc-1')).toMatchObject({ revision: 0 });
  });

  it('returns explicit V1 fallback only for an old server response', async () => {
    putDeviceRecords([row]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer({}, 404))));
    expect(await runV2('acc-1', 0, owner)).toBe('v1');
    expect(await readV2Outbox('acc-1')).toHaveLength(1);
  });

  it('drops expired mutations without re-enqueue and retries the rolled-back remainder', async () => {
    putDeviceRecords([row, { ...row, id: 'progress:abc:2' }]);
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sizes.push(body.records.length);
      if (body.records.length === 2) return Promise.resolve(answer({ error: 'mutation_expired' }, 409));
      if (body.records[0].id === row.id) {
        return Promise.resolve(answer({ ok: true, records: [], nextRevision: 1, ack: [{ recordId: row.id, mutationId: body.records[0].mutationId, revision: 1 }] }));
      }
      return Promise.resolve(answer({ error: 'mutation_expired' }, 409));
    }));
    expect(await runV2('acc-1', 0, owner)).toBe('error');
    expect(sizes).toEqual([2, 1, 1]);
    expect(await readV2Outbox('acc-1')).toEqual([]);
    expect(unsentRecords(0)).toEqual([]);
  });
});


describe('HTTP V2 large batches and stale pages', () => {
  it('splits a 413 batch and accepts the smaller records', async () => {
    putDeviceRecords([
      { ...row, body: { text: 'a'.repeat(140000) } },
      { ...row, id: 'progress:abc:2', body: { text: 'b'.repeat(140000) } },
    ]);
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sizes.push(body.records.length);
      if (body.records.length > 1) return Promise.resolve(answer({}, 413));
      return Promise.resolve(answer({
        ok: true, records: [], nextRevision: 1,
        ack: [{ recordId: body.records[0].id, mutationId: body.records[0].mutationId, revision: 1 }],
      }));
    }));
    expect(await runV2('acc-1', 0, owner)).toBe('ok');
    expect(sizes).toEqual([2, 1, 1]);
    expect(await readV2Outbox('acc-1')).toEqual([]);
  });

  it('quarantines a single record that still exceeds the HTTP limit', async () => {
    putDeviceRecords([{ ...row, body: { text: 'x'.repeat(300000) } }]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer({}, 413))));
    expect(await runV2('acc-1', 0, owner)).toBe('error');
    expect((await readV2Outbox('acc-1'))[0].blocked).toBe('too_large');
  });

  it('does not apply a page when its owner is already stale', async () => {
    const { acceptV2Page } = await import('../../src/billing/deviceSyncV2Client');
    const incoming = { ...row, id: 'progress:other:1', updatedAt: 200, deviceId: 'other' };
    await acceptV2Page('acc-1', { ok: true, records: [incoming], nextRevision: 9, ack: [] }, [], () => false);
    const { deviceRecords } = await import('../../src/store/deviceDb');
    expect(deviceRecords().some((item) => item.id === incoming.id)).toBe(false);
    expect(await readV2Meta('acc-1')).toMatchObject({ revision: 0 });
  });
});
