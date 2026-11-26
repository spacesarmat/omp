import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LazyImg } from '../src/ui/LazyImg';
import { resetImageCache } from '../../src/lib/imageCache';

// jsdom gives URL.createObjectURL from Node: without the stub the cache would never be exercised here
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let counter = 0;
const fetcher = vi.fn();
let el: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  URL.createObjectURL = (((() => 'blob:cache/' + ++counter) as unknown) as typeof URL.createObjectURL);
  URL.revokeObjectURL = (((() => undefined) as unknown) as typeof URL.revokeObjectURL);
  resetImageCache();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  el = document.createElement('div');
  document.body.appendChild(el);
});

afterEach(() => {
  act(() => render(null, el));
  el.remove();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** jsdom has no IntersectionObserver, so a tile is near the viewport from the first frame. */
function mount(src: string) {
  act(() => render(<LazyImg src={src} />, el));
  // the effect runs after paint, which fake timers hold
  act(() => {
    vi.advanceTimersByTime(30);
  });
}

const img = () => el.querySelector('img')!.getAttribute('src');

/** The fetch chain and the repaint it triggers: microtasks, then a frame of fake timers. */
async function settle(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 25; i++) await Promise.resolve();
    if (ms) vi.advanceTimersByTime(ms);
    for (let i = 0; i < 25; i++) await Promise.resolve();
  });
}

describe('LazyImg', () => {
  it('waits for the cache and then keeps the cached copy', async () => {
    fetcher.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(2)])) });
    mount('https://img.test/a.jpg');
    expect(img()).toBeNull();
    await settle();
    const held = img();
    expect(held && held.indexOf('blob:cache/') === 0).toBe(true);
    // the fallback timer must not put the plain URL back and reload the picture
    await settle(6000);
    expect(img()).toBe(held);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shows the plain URL when the request hangs', async () => {
    fetcher.mockReturnValue(new Promise(() => undefined));
    mount('https://img.test/b.jpg');
    await settle(4000);
    expect(img()).toBeNull();
    await settle(2000);
    expect(img()).toBe('https://img.test/b.jpg');
  });

  it('serves a poster at once when the host cannot be read', async () => {
    fetcher.mockRejectedValue(new TypeError('no CORS'));
    mount('https://blocked.test/c.jpg');
    await settle();
    mount('https://blocked.test/d.jpg');
    expect(img()).toBe('https://blocked.test/d.jpg');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
