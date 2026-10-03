import { describe, it, expect } from 'vitest';
import { parseMark, skipStatus, stepMark, holdStep, clampMarks, HOLD_GAP_MS, FAST_STEP_MS, markText, marksValid, MARK_MAX } from '../../src/lib/skipMarks';

describe('parseMark', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseMark('45')).toBe(45);
    expect(parseMark('0:45')).toBe(45);
    expect(parseMark(' 2:15 ')).toBe(135);
    expect(parseMark('1:02:03')).toBe(3723);
  });
  it('rejects the rest', () => {
    for (const bad of ['', 'abc', '1:75', '1:2:99', '1:', ':30', '-5', '1.5', '1:2:3:4']) expect(parseMark(bad)).toBeNull();
  });
});

describe('skipStatus', () => {
  it('chapters, no manual marks', () => expect(skipStatus(true, { i: false, c: false })).toBe('по главам файла'));
  it('chapters plus the manual marks', () => {
    expect(skipStatus(true, { i: false, c: false, mi: [45, 135] })).toBe('по главам файла · вручную: заставка 0:45–2:15');
    expect(skipStatus(true, { i: false, c: false, mc: 90 })).toBe('по главам файла · вручную: титры: последние 1:30');
  });
  it('manual marks', () => {
    expect(skipStatus(false, { i: false, c: false, mi: [45, 135] })).toBe('в файле нет глав · заставка 0:45–2:15');
    expect(skipStatus(false, { i: false, c: false, mc: 90 })).toBe('в файле нет глав · титры: последние 1:30');
    expect(skipStatus(false, { i: false, c: false, mi: [45, 135], mc: 90 })).toBe('в файле нет глав · заставка 0:45–2:15 · титры: последние 1:30');
  });
  it('nothing set', () => expect(skipStatus(false, { i: true, c: true })).toBe('не заданы'));
});

describe('stepMark', () => {
  const m = { mi: [45, 135] as [number, number], mc: 90 };
  it('steps one row, keeps the others', () => {
    expect(stepMark(m, 'from', 1, 5)).toEqual({ mi: [50, 135], mc: 90 });
    expect(stepMark(m, 'to', -1, 30)).toEqual({ mi: [45, 105], mc: 90 });
    expect(stepMark(m, 'last', 1, 30)).toEqual({ mi: [45, 135], mc: 120 });
  });
  it('never crosses the bounds', () => {
    expect(stepMark({ mi: [3, 10], mc: 2 }, 'from', -1, 30).mi).toEqual([0, 10]);
    expect(stepMark({ mi: [3, 10], mc: 2 }, 'from', 1, 30).mi).toEqual([9, 10]);
    expect(stepMark({ mi: [3, 10], mc: 2 }, 'to', -1, 30).mi).toEqual([3, 4]);
    expect(stepMark({ mi: [3, MARK_MAX - 1], mc: 2 }, 'to', 1, 30).mi).toEqual([3, MARK_MAX]);
    expect(stepMark({ mi: null, mc: 2 }, 'last', -1, 30).mc).toBe(1);
    expect(stepMark({ mi: null, mc: MARK_MAX }, 'last', 1, 30).mc).toBe(MARK_MAX);
  });
  it('a mark that is not set starts from a default on the first press', () => {
    expect(stepMark({ mi: null, mc: null }, 'from', 1, 5)).toEqual({ mi: [5, 90], mc: null });
    expect(stepMark({ mi: null, mc: null }, 'to', 1, 30)).toEqual({ mi: [0, 120], mc: null });
    expect(stepMark({ mi: null, mc: null }, 'last', -1, 5)).toEqual({ mi: null, mc: 85 });
  });
  it('every step gives valid marks', () => {
    let cur = { mi: null, mc: null } as ReturnType<typeof stepMark>;
    const rows = ['from', 'to', 'last'] as const;
    for (let i = 0; i < 400; i++) {
      cur = stepMark(cur, rows[i % 3], i % 7 < 3 ? -1 : 1, i % 5 === 0 ? 30 : 5);
      expect(marksValid(cur)).toBe(true);
    }
  });
});

describe('marksValid / markText', () => {
  it('rejects an intro that ends before it starts and a zero length', () => {
    expect(marksValid({ mi: [10, 10], mc: null })).toBe(false);
    expect(marksValid({ mi: [-1, 10], mc: null })).toBe(false);
    expect(marksValid({ mi: null, mc: 0 })).toBe(false);
    expect(marksValid({ mi: [0, 5], mc: 1 })).toBe(true);
    expect(marksValid({ mi: null, mc: null })).toBe(true);
  });
  it('shows a dash for unset marks', () => {
    expect(markText({ mi: null, mc: null }, 'from')).toBe('—');
    expect(markText({ mi: [45, 135], mc: 90 }, 'to')).toBe('2:15');
    expect(markText({ mi: [45, 135], mc: 90 }, 'last')).toBe('1:30');
  });
});

describe('holdStep', () => {
  const fresh = () => ({ dir: 0, at: -1e9, fastAt: -1e9 });
  it('a single press is 5 s, a slow double press is 2 x 5 s', () => {
    const t = fresh();
    expect(holdStep(t, 1, false, 1000)).toBe(5);
    expect(holdStep(t, 1, false, 1000 + HOLD_GAP_MS + 100)).toBe(5);
  });
  it('auto-repeat is held at once', () => {
    expect(holdStep(fresh(), 1, true, 1000)).toBe(30);
  });
  it('a quick double tap stays 2 x 5 s', () => {
    const t = fresh();
    expect(holdStep(t, 1, false, 1000)).toBe(5);
    expect(holdStep(t, 1, false, 1120)).toBe(5);
  });
  it('a third quick same-direction press counts as held (remotes without repeat), another direction does not', () => {
    const t = fresh();
    expect(holdStep(t, 1, false, 1000)).toBe(5);
    expect(holdStep(t, 1, false, 1100)).toBe(5);
    expect(holdStep(t, 1, false, 1200)).toBe(30);
    expect(holdStep(t, -1, false, 1250)).toBe(5);
  });
  it('fast steps are limited to one per FAST_STEP_MS while the key is held', () => {
    const t = fresh();
    let sum = 0;
    for (let ms = 0; ms <= 1000; ms += 50) sum += holdStep(t, 1, true, 10000 + ms);
    expect(sum).toBe(30 * Math.floor(1000 / FAST_STEP_MS + 1));
    expect(holdStep(t, 1, true, 11000 + 10)).toBe(0);
  });
});

describe('clampMarks', () => {
  it('brings marks over the limit into bounds and keeps valid ones', () => {
    expect(clampMarks({ mi: [45, 135], mc: 90 })).toEqual({ mi: [45, 135], mc: 90 });
    expect(clampMarks({ mi: [MARK_MAX + 5, MARK_MAX + 50], mc: MARK_MAX * 2 })).toEqual({ mi: [MARK_MAX - 1, MARK_MAX], mc: MARK_MAX });
    expect(clampMarks({ mi: null, mc: null })).toEqual({ mi: null, mc: null });
  });
});
