import { describe, it, expect } from 'vitest';
import { introChapter, chapterList, skipSegments, chapterIndexAt, chapterTarget, inIntro, introSkipTarget, applyMark, SKIP_TOAST_MS, PREV_CHAPTER_WINDOW } from '../../src/player/chapters';
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

describe('chapter navigation', () => {
  const list = [
    { start: 0, end: 90, title: 'Пролог', kind: null },
    { start: 90, end: 200, title: 'Заставка', kind: 'intro' as const },
    { start: 200, end: 1000, title: 'Серия', kind: null },
  ];
  it('indexAt: the last chapter that started, -1 before the first', () => {
    expect(chapterIndexAt(list, 0)).toBe(0);
    expect(chapterIndexAt(list, 150)).toBe(1);
    expect(chapterIndexAt(list, 5000)).toBe(2);
    expect(chapterIndexAt([{ start: 10, end: 20, title: '', kind: null }], 3)).toBe(-1);
  });
  it('CH+: next chapter start, nothing after the last', () => {
    expect(chapterTarget(list, 10, 1)).toBe(90);
    expect(chapterTarget(list, 250, 1)).toBeNull();
    expect(chapterTarget([], 10, 1)).toBeNull();
  });
  it('CH−: previous chapter in the first 3 s, otherwise the start of the current one', () => {
    expect(chapterTarget(list, 91, -1)).toBe(0);
    expect(chapterTarget(list, 93, -1)).toBe(90);
    expect(chapterTarget(list, 150, -1)).toBe(90);
    expect(chapterTarget(list, 1, -1)).toBe(0);
  });
  it('shared timing constants', () => {
    expect(SKIP_TOAST_MS).toBe(5000);
    expect(PREV_CHAPTER_WINDOW).toBe(3);
  });
  it('inIntro / introSkipTarget', () => {
    expect(inIntro({ start: 10, end: 100 }, 10)).toBe(true);
    expect(inIntro({ start: 10, end: 100 }, 99.5)).toBe(false);
    expect(inIntro(undefined, 5)).toBe(false);
    expect(introSkipTarget({ start: 10, end: 100 }, 2000)).toBe(100);
    expect(introSkipTarget({ start: 10, end: 5000 }, 2000)).toBe(1999);
  });
});

describe('applyMark', () => {
  const fmt = (s: number) => Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  it('intro start alone waits for the end, then writes both', () => {
    const a = applyMark('intro-start', 45.2, 2900, null, null, fmt);
    expect(a.patch).toBeUndefined();
    expect(a.pending).toBe(45);
    expect(a.text).toBe('Отмечено: начало заставки 0:45');
    const b = applyMark('intro-end', 135.4, 2900, null, a.pending, fmt);
    expect(b.patch).toEqual({ mi: [45, 135] });
    expect(b.pending).toBeNull();
  });
  it('intro start with an existing later end writes right away', () => {
    const r = applyMark('intro-start', 45, 2900, { mi: [30, 120] }, null, fmt);
    expect(r.patch).toEqual({ mi: [45, 120] });
    expect(r.text).toBe('Отмечено: заставка с 0:45');
  });
  it('intro end uses the saved start; before the start is an error', () => {
    expect(applyMark('intro-end', 120, 2900, { mi: [45, 100] }, null, fmt).patch).toEqual({ mi: [45, 120] });
    const bad = applyMark('intro-end', 30, 2900, { mi: [45, 100] }, null, fmt);
    expect(bad.patch).toBeUndefined();
    expect(bad.error).toBe(true);
    expect(applyMark('intro-end', 30, 2900, null, null, fmt).error).toBe(true);
  });
  it('credits: the last N whole seconds of the file', () => {
    const r = applyMark('credits', 2800.4, 2900.2, null, null, fmt);
    expect(r.patch).toEqual({ mc: 100 });
    expect(r.text).toBe('Отмечено: титры с 46:40');
    expect(applyMark('credits', 2900, 2900, null, null, fmt).error).toBe(true);
    expect(applyMark('credits', 10, 0, null, null, fmt).error).toBe(true);
  });
});
