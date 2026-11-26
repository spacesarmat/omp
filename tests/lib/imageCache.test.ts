import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearImageCache,
  imageCacheStats,
  imageSrc,
  loadImage,
  prefetchImages,
  resetImageCache,
  setImageCacheBudget,
} from '../../src/lib/imageCache';

// jsdom has no object URLs: the cache would refuse to work at all
const created: string[] = [];
const revoked: string[] = [];
let counter = 0;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function stubObjectUrls(): void {
  URL.createObjectURL = ((blob: Blob) => {
    const url = 'blob:cache/' + ++counter;
    created.push(url);
    void blob;
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;
}

function picture(bytes: number) {
  return {
    ok: true,
    blob: () => Promise.resolve(new Blob([new Uint8Array(bytes)])),
  };
}

const fetcher = vi.fn();

beforeEach(() => {
  stubObjectUrls();
  created.length = 0;
  revoked.length = 0;
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  resetImageCache();
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.unstubAllGlobals();
});

describe('imageSrc', () => {
  it('is the plain URL until the bytes are cached', async () => {
    fetcher.mockResolvedValue(picture(10));
    expect(imageSrc('https://img.test/a.jpg')).toBe('https://img.test/a.jpg');
    const held = await loadImage('https://img.test/a.jpg');
    expect(held).not.toBe('https://img.test/a.jpg');
    expect(imageSrc('https://img.test/a.jpg')).toBe(held);
  });
});

describe('loadImage', () => {
  it('asks the network once and serves the copy after', async () => {
    fetcher.mockResolvedValue(picture(10));
    const first = await loadImage('https://img.test/a.jpg');
    const second = await loadImage('https://img.test/a.jpg');
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(imageCacheStats().items).toBe(1);
    expect(imageCacheStats().bytes).toBe(10);
  });

  it('shares one request between tiles that ask at the same time', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetcher.mockReturnValue(new Promise((res) => { release = res; }));
    const a = loadImage('https://img.test/same.jpg');
    const b = loadImage('https://img.test/same.jpg');
    release(picture(4));
    expect(await a).toBe(await b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the plain URL when the host refuses a cross-origin read', async () => {
    fetcher.mockRejectedValue(new TypeError('no CORS'));
    expect(await loadImage('https://blocked.test/a.jpg')).toBe('https://blocked.test/a.jpg');
    expect(imageCacheStats().blocked).toEqual(['blocked.test']);
    // the whole host is skipped now, so the next poster does not wait for a request that cannot work
    await loadImage('https://blocked.test/b.jpg');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not blacklist a host over one broken poster', async () => {
    fetcher.mockResolvedValue({ ok: false, status: 404 });
    expect(await loadImage('https://img.test/gone.jpg')).toBe('https://img.test/gone.jpg');
    expect(imageCacheStats().blocked).toEqual([]);
    fetcher.mockResolvedValue(picture(4));
    // the next poster of the same host still gets its copy
    expect(await loadImage('https://img.test/good.jpg')).not.toBe('https://img.test/good.jpg');
    // and the broken one is not asked again on every remount
    await loadImage('https://img.test/gone.jpg');
    expect(fetcher.mock.calls.filter((c) => c[0] === 'https://img.test/gone.jpg').length).toBe(1);
  });

  it('asks a refused host again after the cooldown', async () => {
    vi.useFakeTimers();
    fetcher.mockRejectedValue(new TypeError('no CORS'));
    await loadImage('https://down.test/a.jpg');
    await loadImage('https://down.test/b.jpg');
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6 * 60 * 1000);
    fetcher.mockResolvedValue(picture(2));
    expect(await loadImage('https://down.test/c.jpg')).not.toBe('https://down.test/c.jpg');
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not touch fetch for data and local addresses', async () => {
    expect(await loadImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(await loadImage('assets/icon.png')).toBe('assets/icon.png');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('drops the oldest picture when the room runs out', async () => {
    setImageCacheBudget(10);
    fetcher.mockResolvedValue(picture(8));
    const first = await loadImage('https://img.test/a.jpg');
    await loadImage('https://img.test/b.jpg');
    const stats = imageCacheStats();
    expect(stats.items).toBe(1);
    expect(stats.bytes).toBeLessThanOrEqual(10);
    expect(revoked).toContain(first);
    // the picture that stayed is the newer one
    expect(imageSrc('https://img.test/a.jpg')).toBe('https://img.test/a.jpg');
    expect(imageSrc('https://img.test/b.jpg')).not.toBe('https://img.test/b.jpg');
  });

  it('leaves a picture bigger than the whole room out of the cache', async () => {
    setImageCacheBudget(10);
    fetcher.mockResolvedValue(picture(50));
    expect(await loadImage('https://img.test/huge.jpg')).toBe('https://img.test/huge.jpg');
    expect(imageCacheStats().items).toBe(0);
    expect(imageCacheStats().bytes).toBe(0);
    expect(created).toEqual([]);
  });

  it('forgets everything on clear', async () => {
    fetcher.mockResolvedValue(picture(3));
    const held = await loadImage('https://img.test/a.jpg');
    clearImageCache();
    expect(revoked).toContain(held);
    expect(imageCacheStats().items).toBe(0);
    await loadImage('https://img.test/a.jpg');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('prefetchImages', () => {
  it('keeps two requests in flight and skips what is already cached', async () => {
    let inFlight = 0;
    let peak = 0;
    fetcher.mockImplementation(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return Promise.resolve(picture(1)).then((r) => {
        inFlight--;
        return r;
      });
    });
    prefetchImages(['https://img.test/1.jpg', 'https://img.test/2.jpg', 'https://img.test/3.jpg', 'https://img.test/4.jpg']);
    await new Promise((res) => setTimeout(res, 0));
    expect(peak).toBeLessThanOrEqual(2);

    await loadImage('https://img.test/done.jpg');
    prefetchImages(['https://img.test/done.jpg', '', 'https://img.test/new.jpg']);
    await new Promise((res) => setTimeout(res, 0));
    expect(fetcher.mock.calls.filter((c) => c[0] === 'https://img.test/done.jpg').length).toBe(1);
  });

  it('shares the two workers between several calls', async () => {
    let inFlight = 0;
    let peak = 0;
    fetcher.mockImplementation(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((res) => setTimeout(() => {
        inFlight--;
        res(picture(1));
      }, 5));
    });
    // two focus changes before the first answer lands: the backlog grows, the workers do not
    prefetchImages(['https://img.test/a1.jpg', 'https://img.test/a2.jpg', 'https://img.test/a3.jpg']);
    prefetchImages(['https://img.test/b1.jpg', 'https://img.test/b2.jpg', 'https://img.test/b3.jpg']);
    await new Promise((res) => setTimeout(res, 60));
    expect(peak).toBeLessThanOrEqual(2);
    expect(imageCacheStats().items).toBe(6);
  });

  it('gives up a stalled request instead of holding both workers', async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation((u: string) => (String(u).indexOf('stall.') >= 0 ? new Promise(() => undefined) : Promise.resolve(picture(2))));
    prefetchImages(['https://stall.test/a.jpg', 'https://stall.test/b.jpg']);
    prefetchImages(['https://img.test/live.jpg']);
    await vi.advanceTimersByTimeAsync(1000);
    // both workers are stuck on the pair that never answers
    expect(imageSrc('https://img.test/live.jpg')).toBe('https://img.test/live.jpg');
    // after the stall window the worker is free and the healthy host is served again
    await vi.advanceTimersByTimeAsync(16000);
    expect(imageSrc('https://img.test/live.jpg')).not.toBe('https://img.test/live.jpg');
    vi.useRealTimers();
  });
});

describe('without object URLs', () => {
  it('leaves the addresses alone instead of failing', async () => {
    URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL;
    fetcher.mockResolvedValue(picture(1));
    expect(await loadImage('https://img.test/a.jpg')).toBe('https://img.test/a.jpg');
    expect(fetcher).not.toHaveBeenCalled();
    expect(imageCacheStats().items).toBe(0);
  });
});
