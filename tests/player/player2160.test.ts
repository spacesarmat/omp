import { describe, it, expect, beforeEach, vi } from 'vitest';
import { segmentsText, sanitizeP2160, saveP2160Result, play2160 } from '../../src/player/player2160';
import { getLocalProgress, isWatched, reloadProgress } from '../../src/store/progress';
import type { PlayItem } from '../../src/player/types';

const H = 'c'.repeat(40);
const queue: PlayItem[] = [
  { url: 'http://h:1/stream/e1.mkv?link=' + H + '&index=1&play', title: 'S01E01.mkv', hash: H, fileIndex: 1 },
  { url: 'http://h:1/stream/e2.mkv?link=' + H + '&index=2&play', title: 'S01E02.mkv', hash: H, fileIndex: 2 },
];

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
});

describe('segmentsText', () => {
  it('intro and credits', () => {
    expect(segmentsText({ i: true, c: true, mi: [30, 95], mc: 120 }, 2700)).toBe('intro:30000-95000;credits:2580000-');
  });
  it('no prefs / nothing set', () => {
    expect(segmentsText(null, 2700)).toBe('');
    expect(segmentsText({ i: true, c: true }, 2700)).toBe('');
  });
  it('credits need a known duration', () => {
    expect(segmentsText({ i: true, c: true, mi: [30, 95], mc: 120 }, 0)).toBe('intro:30000-95000');
    expect(segmentsText({ i: false, c: true, mc: 120 }, 0)).toBe('');
  });
});

describe('sanitizeP2160', () => {
  it('keeps typed fields only', () => {
    expect(sanitizeP2160({ returned: true, positionMs: 5000, durationMs: 'x', ended: true, url: 'u' }))
      .toEqual({ returned: true, positionMs: 5000, ended: true, url: 'u' });
    expect(sanitizeP2160({ returned: false, positionMs: 5 })).toEqual({ returned: false });
    expect(sanitizeP2160(null)).toEqual({ returned: false });
  });
});

describe('saveP2160Result', () => {
  it('saves the item the user stopped at', () => {
    saveP2160Result(null, queue, 0, { returned: true, positionMs: 600000, durationMs: 1200000, url: queue[1].url }, 0);
    expect(getLocalProgress(H, 2)!.time).toBe(600);
    expect(getLocalProgress(H, 1)).toBeNull();
  });
  it('ended marks watched', () => {
    saveP2160Result(null, queue, 0, { returned: true, ended: true, durationMs: 1200000, url: queue[1].url }, 0);
    expect(isWatched(H, 2)).toBe(true);
  });
  it('unknown url falls back to the start item', () => {
    saveP2160Result(null, queue, 0, { returned: true, positionMs: 300000, durationMs: 1000000, url: 'http://x/y' }, 0);
    expect(getLocalProgress(H, 1)!.time).toBe(300);
  });
  it('returned:false saves nothing', () => {
    saveP2160Result(null, queue, 0, { returned: false }, 0);
    expect(getLocalProgress(H, 1)).toBeNull();
  });
});

describe('play2160', () => {
  it('opens with items, start, position and segments; saves the result; busy guard', async () => {
    let done: (v: unknown) => void = () => undefined;
    const open2160 = vi.fn((_o: any) => new Promise((r) => { done = r; }));
    const plugin: any = { open2160 };
    const p = play2160(plugin, null, queue, 1, 5, { i: true, c: true, mi: [1, 2] }, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(open2160).toHaveBeenCalledTimes(1);
    const o = open2160.mock.calls[0][0];
    expect(o.items.length).toBe(2);
    expect(o.items[1].url).toBe(queue[1].url);
    expect(o.start).toBe(1);
    expect(o.fromStart).toBe(true);
    expect(o.positionMs).toBe(0);
    expect(o.segments).toBe('intro:1000-2000');
    await play2160(plugin, null, queue, 1, 5, null, 0); // busy: nothing
    expect(open2160).toHaveBeenCalledTimes(1);
    done({ returned: true, positionMs: 100000, durationMs: 900000, url: queue[1].url });
    await p;
    expect(getLocalProgress(H, 2)!.time).toBe(100);
  });
});
