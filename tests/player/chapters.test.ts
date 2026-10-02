import { describe, it, expect } from 'vitest';
import { introChapter, chapterList, skipSegments } from '../../src/player/chapters';
import type { FfprobeResult } from '../../src/api/types';

const probe = (titles: [number, number, string][]): FfprobeResult => ({
  streams: [],
  chapters: titles.map(([s, e, title]) => ({ start_time: String(s), end_time: String(e), tags: { title } })),
});

describe('introChapter', () => {
  it('finds intro-like chapters', () => {
    const p = probe([[0, 90, 'Intro'], [90, 1500, 'Episode']]);
    expect(introChapter(p, 10)).toEqual({ start: 0, end: 90 });
    expect(introChapter(p, 89.5)).toBeNull();
    expect(introChapter(p, 100)).toBeNull();
  });
  it('matches titles in several languages and ignores look-alikes', () => {
    expect(introChapter(probe([[5, 60, 'Opening']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'OP']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Заставка']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Вступление']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Copyright']]), 6)).toBeNull();
    expect(introChapter(probe([[5, 60, 'Chapter 1']]), 6)).toBeNull();
    expect(introChapter(probe([[5, 8, 'Intro']]), 6)).toBeNull();
  });
  it('handles missing data', () => {
    expect(introChapter(null, 1)).toBeNull();
    expect(introChapter({ streams: [] }, 1)).toBeNull();
  });
});

describe('chapterList', () => {
  it('classifies intro and credits, sorts, drops broken chapters', () => {
    const p = probe([[1500, 1590, 'Ending'], [0, 90, 'Intro'], [90, 1500, 'Episode'], [5, 5, 'x'], [10, 4, 'y']]);
    expect(chapterList(p)).toEqual([
      { start: 0, end: 90, title: 'Intro', kind: 'intro' },
      { start: 90, end: 1500, title: 'Episode', kind: null },
      { start: 1500, end: 1590, title: 'Ending', kind: 'credits' },
    ]);
    p.chapters!.push({ start_time: 'abc', end_time: '5' } as any);
    expect(chapterList(p)).toHaveLength(3);
  });
  it('credits titles in several languages, whole words only', () => {
    const kind = (title: string) => chapterList(probe([[100, 200, title]]))[0].kind;
    ['Credits', 'End Credits', 'ED', 'Outro', 'Титры', 'Эндинг', 'Ending 1', '04 - credits'].forEach((t) => expect(kind(t)).toBe('credits'));
    ['Edge', 'Predator', 'Credit card', 'Chapter 2'].forEach((t) => expect(kind(t)).toBeNull());
    expect(chapterList(probe([[100, 104, 'Credits']]))[0].kind).toBeNull();
  });
  it('handles missing data', () => {
    expect(chapterList(null)).toEqual([]);
    expect(chapterList({ streams: [] })).toEqual([]);
  });
});

describe('skipSegments', () => {
  const p = probe([[0, 90, 'Intro'], [90, 1300, 'Episode'], [1300, 1400, 'Credits']]);
  it('uses chapters', () => {
    expect(skipSegments(p, null, 1400)).toEqual({ intro: { start: 0, end: 90 }, credits: { start: 1300 } });
  });
  it('chapters win over manual marks', () => {
    expect(skipSegments(p, { i: false, c: false, mi: [10, 20], mc: 30 }, 1400)).toEqual({ intro: { start: 0, end: 90 }, credits: { start: 1300 } });
  });
  it('falls back to manual marks; credits = duration - mc only when duration > mc', () => {
    const plain = probe([[0, 1400, 'Episode']]);
    const prefs = { i: true, c: true, mi: [45, 135] as [number, number], mc: 90 };
    expect(skipSegments(plain, prefs, 1400)).toEqual({ intro: { start: 45, end: 135 }, credits: { start: 1310 } });
    expect(skipSegments(null, prefs, 1400)).toEqual({ intro: { start: 45, end: 135 }, credits: { start: 1310 } });
    expect(skipSegments(null, prefs, 90)).toEqual({ intro: { start: 45, end: 135 } });
    expect(skipSegments(null, prefs, 0)).toEqual({ intro: { start: 45, end: 135 } });
  });
  it('each kind falls back independently', () => {
    const onlyIntro = probe([[0, 90, 'Intro']]);
    expect(skipSegments(onlyIntro, { i: false, c: false, mi: [5, 6], mc: 60 }, 600)).toEqual({ intro: { start: 0, end: 90 }, credits: { start: 540 } });
  });
  it('nothing known: empty', () => {
    expect(skipSegments(null, null, 600)).toEqual({});
    expect(skipSegments(null, { i: true, c: true }, 600)).toEqual({});
  });
});
