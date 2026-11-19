import { afterEach, describe, expect, it, vi } from 'vitest';
import { yandexClip } from '../src/ads/yandexNative';

function box(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('yandex clip', () => {
  it('keeps the catalog between the sticky header and the bottom nav', () => {
    document.body.innerHTML = '<div class="m-lib-sticky"><div class="m-tabs"></div></div><nav class="m-nav"></nav>';
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('m-lib-sticky')) return box(0, 120);
      if (this.classList.contains('m-tabs')) return box(40, 80);
      if (this.classList.contains('m-nav')) return box(640, 700);
      return box(0, 0);
    });
    const clip = yandexClip();
    expect(clip.blocked).toBe(false);
    expect(clip.top).toBe(120);
    expect(clip.bottom).toBe(640);
    expect(clip.bottom).toBeGreaterThan(clip.top);
  });

  it('blocks the whole strip while a sheet is open', () => {
    document.body.innerHTML = '<div class="m-sheet-host"></div>';
    expect(yandexClip().blocked).toBe(true);
  });
});
