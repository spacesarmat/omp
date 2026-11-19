import { describe, expect, it, beforeEach } from 'vitest';
import { migrateRemembered, recordsForEdit, recordsFromTorrent } from '../../src/store/migrateRemembered';
import { deviceMigrated, deviceRecords, noteSyncAccount, onDeviceWrite, putDeviceRecords, resetDeviceDb, setSyncCursor, syncCursor } from '../../src/store/deviceDb';

const DATA = JSON.stringify({
  omp: {
    v: 1,
    h: [{ f: 1, t: 40, d: 100, at: 50, src: 'phone' }],
    s: { i: true, c: false },
    w: false,
    nm: true,
    rt: 'Show S01 1080p',
    a: { at: 40, l: 'studio' },
  },
});

beforeEach(() => resetDeviceDb());

describe('migrateRemembered', () => {
  it('copies journal, skip, voice, title and flags once', () => {
    const first = migrateRemembered([{ hash: 'AbC', title: 'Show', data: DATA }], { 'abc:1': { time: 12, duration: 100, updated: 80 } }, true);
    expect(first).toBe(true);
    expect(deviceMigrated()).toBe(true);
    const ids = deviceRecords().map((r) => r.id).sort();
    expect(ids).toContain('journal:abc:1:phone');
    expect(ids).toContain('skip:abc');
    expect(ids).toContain('audio:abc');
    expect(ids).toContain('watch:abc');
    expect(ids).toContain('title:abc');
    expect(ids).toContain('progress:abc:1');
    const again = migrateRemembered([{ hash: 'abc', title: 'Other', data: DATA }], {}, true);
    expect(again).toBe(false);
    expect(deviceRecords().filter((r) => r.id === 'title:abc')[0].body.title).toBe('Show');
  });

  it('does not replace a newer local row and does not mark migrated without a server list', () => {
    putDeviceRecords([{ id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 90, duration: 100 }, updatedAt: 200, deviceId: 'phone' }]);
    migrateRemembered(null, { 'abc:1': { time: 12, duration: 100, updated: 80 } }, false);
    expect(deviceMigrated()).toBe(false);
    expect(deviceRecords().filter((r) => r.id === 'progress:abc:1')[0].body.time).toBe(90);
  });

  it('a later edit of skip settings gets a newer time than the import', () => {
    const first = recordsFromTorrent({ hash: 'abc', title: 'Show', data: DATA }, 10);
    const second = recordsFromTorrent({ hash: 'abc', title: 'Show', data: DATA }, 20);
    expect(first.filter((r) => r.id === 'skip:abc')[0].updatedAt).toBe(10);
    expect(second.filter((r) => r.id === 'skip:abc')[0].updatedAt).toBe(20);
  });

  it('switching account clears the sync cursor and keeps local rows', () => {
    putDeviceRecords([{ id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 9 }, updatedAt: 50, deviceId: 'local' }]);
    setSyncCursor(7);
    noteSyncAccount('account-a');
    expect(syncCursor()).toBe(7);
    noteSyncAccount('account-b');
    expect(syncCursor()).toBe(0);
    expect(deviceRecords().filter((r) => r.id === 'progress:abc:1')[0].body.time).toBe(9);
  });

  it('turning monitoring back on tombstones only that flag', () => {
    putDeviceRecords(recordsFromTorrent({ hash: 'abc', title: 'Show', data: DATA }, 10));
    const plain = JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 40, d: 100, at: 50, src: 'phone' }] } });
    const watched = recordsForEdit({ hash: 'abc', title: 'Show', data: plain }, 30);
    expect(watched.filter((r) => r.id === 'watch:abc').length).toBe(0);
    expect(watched.filter((r) => r.id === 'skip:abc').length).toBe(0);
    const edited = recordsForEdit({ hash: 'abc', title: 'Show', data: plain }, 30, ['watch']);
    const watch = edited.filter((r) => r.id === 'watch:abc')[0];
    expect(watch.deleted).toBe(true);
    expect(watch.updatedAt).toBe(30);
    expect(edited.filter((r) => r.id === 'skip:abc').length).toBe(0);
    expect(edited.filter((r) => r.id === 'journal:abc:1:phone')[0].deleted).toBe(false);
  });

  it('sync bookkeeping does not schedule another upload', () => {
    let n = 0;
    onDeviceWrite(() => { n++; });
    noteSyncAccount('account-a');
    setSyncCursor(4);
    putDeviceRecords([{ id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 3 }, updatedAt: 9, deviceId: 'local' }], true);
    expect(n).toBe(0);
    putDeviceRecords([{ id: 'progress:abc:2', kind: 'progress', key: 'abc:2', body: { time: 4 }, updatedAt: 11, deviceId: 'local' }]);
    expect(n).toBe(1);
    onDeviceWrite(() => undefined);
  });
});
