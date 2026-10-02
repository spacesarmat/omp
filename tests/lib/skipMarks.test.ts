import { describe, it, expect } from 'vitest';
import { parseMark, skipStatus } from '../../src/lib/skipMarks';

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
  it('chapters win', () => expect(skipStatus(true, { i: false, c: false, mi: [45, 135] })).toBe('по главам файла'));
  it('manual marks', () => {
    expect(skipStatus(false, { i: false, c: false, mi: [45, 135] })).toBe('в файле нет глав · заставка 0:45–2:15');
    expect(skipStatus(false, { i: false, c: false, mc: 90 })).toBe('в файле нет глав · титры: последние 1:30');
    expect(skipStatus(false, { i: false, c: false, mi: [45, 135], mc: 90 })).toBe('в файле нет глав · заставка 0:45–2:15 · титры: последние 1:30');
  });
  it('nothing set', () => expect(skipStatus(false, { i: true, c: true })).toBe('не заданы'));
});
