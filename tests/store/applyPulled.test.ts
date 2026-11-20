import { beforeEach, describe, expect, it } from 'vitest';
import { applyPulled, reapplyDeviceRecords } from '../../src/store/applyPulled';
import { torrents, refreshTorrents } from '../../src/store/library';
import { watchesNewEpisodes } from '../../src/lib/journal';
import { getLocalProgress, reloadProgress, saveProgress } from '../../src/store/progress';
import { putDeviceRecords, resetDeviceDb } from '../../src/store/deviceDb';

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  reloadProgress();
  torrents.value = [];
});

describe('applyPulled', () => {
  it('puts a pulled progress row and a monitoring flag where the screens read them', () => {
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    applyPulled([
      { id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 40, duration: 100 }, updatedAt: 20, deviceId: 'other' },
      { id: 'watch:abc', kind: 'watch', key: 'abc', body: { newEpisodes: false }, updatedAt: 20, deviceId: 'other' },
    ]);
    expect(getLocalProgress('abc', 1)!.time).toBe(40);
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
  });

  it('applies a flag that arrived before the torrent list', () => {
    const row = { id: 'watch:abc', kind: 'watch', key: 'abc', body: { newEpisodes: false }, updatedAt: 20, deviceId: 'other' };
    putDeviceRecords([row]);
    torrents.value = [];
    applyPulled([row]);
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
  });

  it('reapplies persisted records after a cold start', () => {
    putDeviceRecords([{ id: 'watch:abc', kind: 'watch', key: 'abc', body: { newEpisodes: false }, updatedAt: 20, deviceId: 'other' }]);
    torrents.value = [];
    reapplyDeviceRecords();
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
  });

  it('rebuilds synced changes after a library refresh', async () => {
    putDeviceRecords([{ id: 'watch:abc', kind: 'watch', key: 'abc', body: { newEpisodes: false }, updatedAt: 20, deviceId: 'other' }]);
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    reapplyDeviceRecords();
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
    await refreshTorrents({ list: () => Promise.resolve([{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never]) });
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
  });

  it('preserves the open flag when replaying progress after restart', () => {
    saveProgress('abc', 1, 95, 100, true);
    reapplyDeviceRecords();
    expect(getLocalProgress('abc', 1)!.open).toBe(true);
  });

  it('keeps a newer local journal entry over a queued older one', () => {
    const old = { id: 'journal:abc:1:phone', kind: 'journal', key: 'abc', body: { f: 1, t: 10, d: 100, at: 20, src: 'phone' }, updatedAt: 20, deviceId: 'other' };
    putDeviceRecords([old]);
    torrents.value = [];
    applyPulled([old]);
    putDeviceRecords([{ id: old.id, kind: 'journal', key: 'abc', body: { f: 1, t: 80, d: 100, at: 100, src: 'phone' }, updatedAt: 100, deviceId: 'local' }]);
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    expect(torrents.value[0].data).toContain('"t":80');
    expect(torrents.value[0].data).not.toContain('"t":10');
  });

  it('keeps a queued row when storage has no copy', () => {
    torrents.value = [];
    applyPulled([
      { id: 'watch:abc', kind: 'watch', key: 'abc', body: { newEpisodes: false }, updatedAt: 30, deviceId: 'other' },
    ]);
    torrents.value = [{ hash: 'abc', title: 'Old', data: '{"omp":{"v":1,"h":[]}}' } as never];
    expect(watchesNewEpisodes(torrents.value[0].data)).toBe(false);
  });

  it('keeps a newer local position when an older delete arrives', () => {
    const hash = 'a'.repeat(40);
    saveProgress(hash, 1, 40, 100);
    applyPulled([{
      id: 'progress:' + hash + ':1',
      kind: 'progress',
      key: hash + ':1',
      body: {},
      updatedAt: 1,
      deviceId: 'other',
      deleted: true,
    }]);
    expect(getLocalProgress(hash, 1)).not.toBeNull();
  });
});
