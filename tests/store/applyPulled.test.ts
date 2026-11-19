import { beforeEach, describe, expect, it } from 'vitest';
import { applyPulled } from '../../src/store/applyPulled';
import { torrents } from '../../src/store/library';
import { watchesNewEpisodes } from '../../src/lib/journal';
import { getLocalProgress, reloadProgress, saveProgress } from '../../src/store/progress';
import { resetDeviceDb } from '../../src/store/deviceDb';

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
