import { describe, expect, it, beforeEach } from 'vitest';
import { migrateRemembered } from '../../src/store/migrateRemembered';
import { deviceMigrated, deviceRecords, putDeviceRecords, resetDeviceDb } from '../../src/store/deviceDb';

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
});
