import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CachedImg } from '../../src/ui/CachedImg';
import { loadImage, resetImageCache } from '../../src/lib/imageCache';

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let counter = 0;

beforeEach(() => {
  URL.createObjectURL = (((() => 'blob:cache/' + ++counter) as unknown) as typeof URL.createObjectURL);
  URL.revokeObjectURL = (((() => undefined) as unknown) as typeof URL.revokeObjectURL);
  resetImageCache();
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.unstubAllGlobals();
});

const fetcher = vi.fn();
const ok = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(2)])) });

let hostEl: HTMLElement;
beforeEach(() => {
  hostEl = document.createElement('div');
  document.body.appendChild(hostEl);
});
afterEach(() => {
  act(() => render(null, hostEl));
  hostEl.remove();
});

/** Effects run after paint, so a frame has to pass before the swap is visible. */
async function settle() {
  await act(async () => {
    await new Promise((res) => setTimeout(res, 40));
  });
}

describe('CachedImg', () => {
  it('shows the picture at once and switches to the cached copy', async () => {
    vi.stubGlobal('fetch', fetcher.mockImplementation(ok));
    act(() => render(<CachedImg src="https://img.test/a.jpg" w={154} />, hostEl));
    const img = hostEl.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('154');
    await settle();
    expect(img.getAttribute('src')).toBe('blob:cache/' + counter);
  });

  it('starts from the cache when the bytes are already there', async () => {
    vi.stubGlobal('fetch', fetcher.mockImplementation(ok));
    const held = await loadImage('https://img.test/b.jpg');
    fetcher.mockClear();
    act(() => render(<CachedImg src="https://img.test/b.jpg" />, hostEl));
    expect(hostEl.querySelector('img')!.getAttribute('src')).toBe(held);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the plain URL when the host cannot be read', async () => {
    vi.stubGlobal('fetch', fetcher.mockImplementation(() => Promise.reject(new TypeError('no CORS'))));
    act(() => render(<CachedImg src="https://blocked.test/c.jpg" />, hostEl));
    await settle();
    expect(hostEl.querySelector('img')!.getAttribute('src')).toBe('https://blocked.test/c.jpg');
  });
});
