import { describe, it, expect } from 'vitest';
import { segmentsMessage, sanitizeNativeMark } from '../../src/player/nativeSkip';
import type { FfprobeResult } from '../../src/api/types';

function probe(chapters: { start: string; end: string; title: string }[]): FfprobeResult {
  return {
    streams: [],
    chapters: chapters.map((c) => ({ start_time: c.start, end_time: c.end, tags: { title: c.title } })),
  } as unknown as FfprobeResult;
}

describe('segmentsMessage', () => {
  it('chapters, the intro and credits chapters, flags', () => {
    const p = probe([
      { start: '60.5', end: '150', title: 'Opening' },
      { start: '0', end: '60.5', title: 'Cold open' },
      { start: '150', end: '1300', title: 'Part' },
      { start: '1300', end: '1400', title: 'Ending' },
    ]);
    expect(segmentsMessage(p, { i: true, c: true, mi: [1, 2], mc: 30 }, 1400, 2, 7, null)).toEqual({
      type: 'segments', index: 2, session: 7,
      chapters: [{ start: 0, title: 'Cold open' }, { start: 60.5, title: 'Opening' }, { start: 150, title: 'Part' }, { start: 1300, title: 'Ending' }],
      intro: { start: 60.5, end: 150 }, credits: { start: 1300 },
      autoIntro: true, autoCredits: true, mi: [1, 2], mc: 30,
    });
  });

  it('manual marks without chapters; the credits mark needs the duration', () => {
    const prefs = { i: false, c: false, mi: [45, 135] as [number, number], mc: 90 };
    expect(segmentsMessage(null, prefs, 0, 0, 1, 40)).toEqual({
      type: 'segments', index: 0, session: 1, chapters: [], intro: { start: 45, end: 135 },
      autoIntro: false, autoCredits: false, mi: [45, 135], mc: 90, pending: 40,
    });
    expect(segmentsMessage(null, prefs, 1000, 0, 1, null).credits).toEqual({ start: 910 });
  });

  it('nothing to skip without ffprobe, chapters or prefs', () => {
    expect(segmentsMessage(null, null, 1000, 0, 1, null)).toEqual({
      type: 'segments', index: 0, session: 1, chapters: [], autoIntro: false, autoCredits: false,
    });
    expect(segmentsMessage(probe([{ start: '10', end: '14', title: 'Intro' }]), null, 0, 0, 1, null).intro).toBeUndefined();
  });
});

describe('sanitizeNativeMark', () => {
  it('accepts the three kinds', () => {
    expect(sanitizeNativeMark({ index: 1, kind: 'intro-start', now: 45.2, duration: 1000, session: 3 })).toEqual({ index: 1, kind: 'intro-start', now: 45.2, duration: 1000 });
    expect(sanitizeNativeMark({ index: 0, kind: 'credits', now: 0, duration: 'x' })).toEqual({ index: 0, kind: 'credits', now: 0, duration: 0 });
  });
  it('rejects malformed events', () => {
    expect(sanitizeNativeMark(null)).toBeNull();
    expect(sanitizeNativeMark({ index: -1, kind: 'credits', now: 1 })).toBeNull();
    expect(sanitizeNativeMark({ index: 0, kind: 'other', now: 1 })).toBeNull();
    expect(sanitizeNativeMark({ index: 0, kind: 'credits', now: -1 })).toBeNull();
  });
});
