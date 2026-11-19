import { describe, expect, it } from 'vitest';
import { mergeRecords, sinceRecords, type SyncRecord } from '../../src/store/syncMerge';

function rec(id: string, updatedAt: number, deviceId: string, deleted?: boolean): SyncRecord {
  return { id, kind: 'progress', key: id, body: { time: updatedAt }, updatedAt, deviceId, deleted: !!deleted };
}

describe('mergeRecords', () => {
  it('keeps the newer write and a newer tombstone', () => {
    const local = [rec('a', 10, 'phone')];
    const remote = [rec('a', 20, 'tv', true), rec('b', 5, 'tv')];
    const merged = mergeRecords(local, remote);
    const a = merged.filter((r) => r.id === 'a')[0];
    expect(a.deleted).toBe(true);
    expect(a.updatedAt).toBe(20);
    expect(merged.filter((r) => r.id === 'b')[0].deviceId).toBe('tv');
  });

  it('breaks a tie by device id and does not drop the older row', () => {
    const merged = mergeRecords([rec('a', 10, 'b')], [rec('a', 10, 'a')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].deviceId).toBe('b');
  });

  it('sinceRecords returns only rows after the cursor', () => {
    expect(sinceRecords([rec('a', 10, 'p'), rec('b', 30, 'p')], 10).map((r) => r.id)).toEqual(['b']);
  });
});
