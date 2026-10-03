import { describe, it, expect } from 'vitest';
import { parseMark, skipStatus, stepMark, markStep, markText, marksValid, MARK_MAX } from '../../src/lib/skipMarks';

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
  it('the step is 5 s, 30 s while held', () => {
    expect(markStep(false)).toBe(5);
    expect(markStep(true)).toBe(30);
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
