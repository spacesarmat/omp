import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ackV2,
  blockV2Mutation,
  enqueueUnsent,
  hydrateV2Projection,
  mergeV2Pulled,
  putV2Local,
  readV2Meta,
  readV2Outbox,
  readV2Records,
  resetDeviceV2Db,
  writeV2Meta,
} from '../../src/store/deviceV2Db';
import type { SyncRecord } from '../../src/store/syncMerge';

const row: SyncRecord = {
  id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 40 }, updatedAt: 100, deviceId: 'device-a', deleted: false,
};

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
  await clean();
});

describe('device V2 IndexedDB', () => {
  it('commits local records with stable mutations and acks only the exact edit', async () => {
    const first = await putV2Local([row], 'account-a');
    expect(first).toHaveLength(1);
    expect(first[0].mutationId).toMatch(/:1$/);
    expect(first[0].row.mutationId).toBe(first[0].mutationId);
    const second = await putV2Local([{ ...row, body: { time: 80 }, updatedAt: 200 }], 'account-a');
    expect(second[0].mutationId).toMatch(/:2$/);
    await ackV2([{ mutationId: first[0].mutationId, recordId: row.id, revision: 1 }], [row]);
    const pending = await readV2Outbox('account-a');
    expect(pending.map((item) => item.mutationId)).toEqual([second[0].mutationId]);
    expect((await readV2Records())[0].body).toEqual({ time: 80 });
  });

  it('recovers a restart without duplicating unsent mutations', async () => {
    const first = await putV2Local([row], 'account-a');
    resetDeviceV2Db();
    await enqueueUnsent([row], 'account-a');
    expect(await readV2Outbox('account-a')).toHaveLength(1);
    const next = await putV2Local([{ ...row, id: 'progress:abc:2', updatedAt: 200 }], 'account-a');
    expect(next[0].mutationId).not.toBe(first[0].mutationId);
    expect(Number(next[0].mutationId.split(':').pop())).toBeGreaterThan(1);
  });

  it('isolates account outboxes and persists per-account revision', async () => {
    await putV2Local([row], 'account-a');
    await putV2Local([{ ...row, id: 'other-account' }], 'account-b');
    expect(await readV2Outbox('account-a')).toHaveLength(1);
    expect(await readV2Outbox('account-b')).toHaveLength(1);
    await writeV2Meta('account-a', { revision: 12 });
    expect(await readV2Meta('account-a')).toMatchObject({ revision: 12 });
    expect(await readV2Meta('account-b')).toMatchObject({ revision: 0 });
  });

  it('merges pulled rows and never overwrites a newer current Bag on re-enable', async () => {
    await mergeV2Pulled([{ ...row, body: { time: 80 }, updatedAt: 200 }]);
    expect((await readV2Records())[0].body).toEqual({ time: 80 });
    const current = { ...row, body: { time: 120 }, updatedAt: 300 };
    const merged = await hydrateV2Projection([current]);
    expect(merged.find((item) => item.id === row.id)).toEqual(current);
  });

  it('quarantines a rejected mutation and replaces it on a new local edit', async () => {
    const first = await putV2Local([row], 'account-a');
    await blockV2Mutation(first[0].mutationId, 'not_accepted');
    expect((await readV2Outbox('account-a'))[0]).toMatchObject({ blocked: 'not_accepted' });
    const replacement = await putV2Local([{ ...row, updatedAt: 200 }], 'account-a');
    const pending = await readV2Outbox('account-a');
    expect(pending).toHaveLength(1);
    expect(pending[0].mutationId).toBe(replacement[0].mutationId);
    expect(pending[0].blocked).toBeUndefined();
  });
});


describe('device V2 same-timestamp edits', () => {
  it('keeps a different body as a separate unsent mutation', async () => {
    await enqueueUnsent([row], 'account-a');
    await enqueueUnsent([{ ...row, body: { time: 41 } }], 'account-a');
    const outbox = await readV2Outbox('account-a');
    expect(outbox).toHaveLength(2);
    expect(outbox[1].row.body).toEqual({ time: 41 });
  });
});
