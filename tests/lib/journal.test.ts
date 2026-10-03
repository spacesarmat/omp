import { describe, it, expect } from 'vitest';
import { parseData, addEntry, serializeData, removeFile, journalOf, sanitizeSkip, JOURNAL_MAX, type JournalEntry } from '../../src/lib/journal';

const T0 = 1_759_400_000_000;

describe('parseData', () => {
  it('empty data: an empty object and journal', () => {
    expect(parseData('')).toEqual({ obj: {}, journal: [], skip: null });
    expect(parseData(undefined)).toEqual({ obj: {}, journal: [], skip: null });
    expect(parseData('  ')).toEqual({ obj: {}, journal: [], skip: null });
  });

  it('non-JSON or non-object data is not OMP-writable', () => {
    expect(parseData('garbage')).toBeNull();
    expect(parseData('[1,2]')).toBeNull();
    expect(parseData('"text"')).toBeNull();
    expect(parseData('42')).toBeNull();
    expect(journalOf('garbage')).toEqual([]);
  });

  it('reads the journal, keeps the whole object, drops malformed entries', () => {
    const data = JSON.stringify({
      TorrServer: { Files: [{ id: 1, path: 'a.mkv', length: 5 }] },
      lampa: { x: 1 },
      omp: {
        v: 1,
        h: [
          { f: 1, t: 10, d: 100, at: T0, src: 'tv' },
          { f: 2, t: 20, d: 0, at: T0 + 5, src: 'phone', name: ' Pixel 7 ' },
          { f: -1, t: 1, d: 1, at: T0, src: 'tv' },
          { f: 3, t: 1, d: 1, at: T0, src: 'radio' },
          'junk',
        ],
      },
    });
    const p = parseData(data)!;
    expect(p.obj.lampa).toEqual({ x: 1 });
    expect(p.journal).toEqual([
      { f: 2, t: 20, d: 0, at: T0 + 5, src: 'phone', name: 'Pixel 7' },
      { f: 1, t: 10, d: 100, at: T0, src: 'tv' },
    ]);
  });

  it('ignores a journal of another version', () => {
    expect(journalOf(JSON.stringify({ omp: { v: 2, h: [{ f: 1, t: 1, d: 1, at: T0, src: 'tv' }] } }))).toEqual([]);
  });
});

describe('addEntry', () => {
  it('puts the new entry first with the given time', () => {
    const j = addEntry([], { f: 1, t: 12.7, d: 100, src: 'tv' }, T0);
    expect(j).toEqual([{ f: 1, t: 12.7, d: 100, at: T0, src: 'tv' }]);
  });

  it('one entry per file + source + name, updated and moved up', () => {
    let j: JournalEntry[] = [];
    j = addEntry(j, { f: 1, t: 10, d: 100, src: 'tv' }, T0);
    j = addEntry(j, { f: 1, t: 10, d: 100, src: 'phone', name: 'Pixel' }, T0 + 1);
    j = addEntry(j, { f: 2, t: 5, d: 50, src: 'tv' }, T0 + 2);
    j = addEntry(j, { f: 1, t: 40, d: 100, src: 'tv' }, T0 + 3);
    j = addEntry(j, { f: 1, t: 30, d: 100, src: 'phone', name: 'Galaxy' }, T0 + 4);
    expect(j.map((e) => [e.f, e.src, e.name || '', e.t])).toEqual([
      [1, 'phone', 'Galaxy', 30],
      [1, 'tv', '', 40],
      [2, 'tv', '', 5],
      [1, 'phone', 'Pixel', 10],
    ]);
  });

  it(`keeps at most ${JOURNAL_MAX} entries, dropping the oldest`, () => {
    let j: JournalEntry[] = [];
    for (let i = 0; i < 30; i++) j = addEntry(j, { f: i, t: 1, d: 2, src: 'tv' }, T0 + i);
    expect(j).toHaveLength(JOURNAL_MAX);
    expect(j[0].f).toBe(29);
    expect(j[JOURNAL_MAX - 1].f).toBe(10);
  });

  it('a malformed entry leaves the journal as is', () => {
    const j = addEntry([], { f: 1, t: 1, d: 1, src: 'tv' }, T0);
    expect(addEntry(j, { f: -2, t: 1, d: 1, src: 'tv' }, T0 + 1)).toEqual(j);
  });
});

describe('serializeData', () => {
  it('writes only the omp key and keeps every other key', () => {
    const data = JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'a.mkv', length: 5 }] }, lampa: { time: 3 }, omp: { v: 1, h: [] } });
    const p = parseData(data)!;
    const out = JSON.parse(serializeData(p.obj, addEntry(p.journal, { f: 1, t: 10, d: 20, src: 'tv' }, T0)));
    expect(out.TorrServer).toEqual({ Files: [{ id: 1, path: 'a.mkv', length: 5 }] });
    expect(out.lampa).toEqual({ time: 3 });
    expect(out.omp).toEqual({ v: 1, h: [{ f: 1, t: 10, d: 20, at: T0, src: 'tv' }] });
  });

  it('round-trips through parseData', () => {
    const j = addEntry([], { f: 4, t: 1, d: 2, src: 'phone', name: 'Pixel' }, T0);
    expect(journalOf(serializeData({}, j))).toEqual(j);
  });
});

describe('removeFile', () => {
  it('drops every source of a file', () => {
    let j: JournalEntry[] = [];
    j = addEntry(j, { f: 1, t: 1, d: 2, src: 'tv' }, T0);
    j = addEntry(j, { f: 2, t: 1, d: 2, src: 'tv' }, T0 + 1);
    j = addEntry(j, { f: 1, t: 1, d: 2, src: 'phone', name: 'P' }, T0 + 2);
    expect(removeFile(j, 1).map((e) => e.f)).toEqual([2]);
  });
});

describe('skip settings (key s)', () => {
  it('sanitizeSkip: defaults, valid marks, malformed parts dropped', () => {
    expect(sanitizeSkip(undefined)).toBeNull();
    expect(sanitizeSkip([1])).toBeNull();
    expect(sanitizeSkip({})).toEqual({ i: false, c: false });
    expect(sanitizeSkip({ i: true, c: true, mi: [45, 135], mc: 90 })).toEqual({ i: true, c: true, mi: [45, 135], mc: 90 });
    expect(sanitizeSkip({ i: 1, c: 'yes' })).toEqual({ i: false, c: false });
    expect(sanitizeSkip({ i: true, mi: [10, 5], mc: -3 })).toEqual({ i: true, c: false });
    expect(sanitizeSkip({ mi: [-1, 5] })).toEqual({ i: false, c: false });
    expect(sanitizeSkip({ mi: [1], mc: 'x' })).toEqual({ i: false, c: false });
  });

  it('parseData reads s next to the history', () => {
    const p = parseData(JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false, mc: 60 } } }))!;
    expect(p.skip).toEqual({ i: true, c: false, mc: 60 });
    expect(parseData(JSON.stringify({ omp: { v: 1, h: [] } }))!.skip).toBeNull();
  });

  it('serializeData keeps s by default, replaces and removes it on request', () => {
    const obj = { lampa: 1, omp: { v: 1, h: [], s: { i: true, c: false, mc: 60 } } };
    const j: JournalEntry[] = [{ f: 1, t: 1, d: 2, at: T0, src: 'tv' }];
    expect(JSON.parse(serializeData(obj, j)).omp).toEqual({ v: 1, h: j, s: { i: true, c: false, mc: 60 } });
    expect(JSON.parse(serializeData(obj, j, { i: false, c: true })).omp.s).toEqual({ i: false, c: true });
    expect(JSON.parse(serializeData(obj, j, null)).omp.s).toBeUndefined();
    expect(JSON.parse(serializeData(obj, j)).lampa).toBe(1);
    expect(JSON.parse(serializeData({}, j)).omp.s).toBeUndefined();
  });
});

describe('journal: keys of newer versions', () => {
  it('serializeData keeps unknown keys inside omp', () => {
    const data = JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false }, future: { x: 1 } }, lampa: 2 });
    const p = parseData(data)!;
    const out = JSON.parse(serializeData(p.obj, p.journal));
    expect(out.omp.future).toEqual({ x: 1 });
    expect(out.omp.s).toEqual({ i: true, c: false });
    expect(out.lampa).toBe(2);
  });
});
