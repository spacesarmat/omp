import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllImages, imageCacheStats, imageStoreStats, loadImage, resetImageCache } from '../../src/lib/imageCache';

// The point of the device store is the restart: the memory cache is gone, the pictures are not. These cases keep
// object URLs and IndexedDB together, which the memory-only suite (tests/lib/imageCache.test.ts) does not have.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let counter = 0;
const fetcher = vi.fn();

beforeEach(() => {
  URL.createObjectURL = (((() => 'blob:cache/' + ++counter) as unknown) as typeof URL.createObjectURL);
  URL.revokeObjectURL = (((() => undefined) as unknown) as typeof URL.revokeObjectURL);
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(7)])) }));
  resetImageCache();
});

afterEach(async () => {
  await clearAllImages();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.unstubAllGlobals();
});

describe('the two levels of the poster cache', () => {
  it('a downloaded picture is kept for the next run', async () => {
    await loadImage('https://img/keep.jpg');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await imageStoreStats()).items).toBe(1);
  });

  it('after the memory cache is gone the device answers and nothing is downloaded', async () => {
    await loadImage('https://img/keep2.jpg');
    await new Promise((r) => setTimeout(r, 1200));
    fetcher.mockClear();
    // the app restarts: the memory cache is empty, the store is not
    resetImageCache();
    const shown = await loadImage('https://img/keep2.jpg');
    expect(shown.indexOf('blob:cache/') === 0).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(imageCacheStats().disk).toBe(1);
  });

  it('clearing empties both levels', async () => {
    await loadImage('https://img/both.jpg');
    await new Promise((r) => setTimeout(r, 1200));
    expect(imageCacheStats().items).toBe(1);
    expect((await imageStoreStats()).items).toBe(1);
    await clearAllImages();
    expect(imageCacheStats().items).toBe(0);
    expect((await imageStoreStats()).items).toBe(0);
  });
});
