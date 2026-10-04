import { describe, it, expect } from 'vitest';
import { parseData, addEntry, serializeData, sanitizeSupport, supportOf, supportOfList, withSupport } from '../../src/lib/journal';

describe('support mark (omp.d)', () => {
  it('is kept with unknown keys of omp when the history is written', () => {
    const data = JSON.stringify({ lampa: 1, omp: { v: 1, h: [], d: { until: 1800000000000 }, future: { x: 1 }, w: false } });
    const p = parseData(data)!;
    const out = JSON.parse(serializeData(p.obj, addEntry(p.journal, { f: 1, t: 5, d: 9, src: 'tv' }, 1700000000000)));
    expect(out.lampa).toBe(1);
    expect(out.omp.d).toEqual({ until: 1800000000000 });
    expect(out.omp.future).toEqual({ x: 1 });
    expect(out.omp.w).toBe(false);
    expect(out.omp.h).toHaveLength(1);
  });

  it('a malformed mark is dropped on write and reads as none', () => {
    const bad: unknown[] = ['x', { until: 'soon' }, { until: -5 }, { until: null }, [1]];
    bad.forEach((d) => {
      const data = JSON.stringify({ omp: { v: 1, h: [], d } });
      expect(supportOf(data)).toBe(0);
      expect(JSON.parse(serializeData(parseData(data)!.obj, [])).omp.d).toBeUndefined();
    });
    expect(sanitizeSupport({ until: 1800000000000.7 })).toEqual({ until: 1800000000000 });
    expect(supportOf('not json')).toBe(0);
    expect(supportOf(undefined)).toBe(0);
  });

  it('withSupport sets it keeping the rest; the latest among torrents wins', () => {
    const obj = { TorrServer: { Files: [] }, omp: { v: 1, h: [], s: { i: true, c: false }, other: 2 } };
    const data = serializeData(withSupport(obj, 1800000000000), []);
    const out = JSON.parse(data);
    expect(out.omp).toMatchObject({ v: 1, h: [], s: { i: true, c: false }, other: 2, d: { until: 1800000000000 } });
    expect(out.TorrServer).toEqual({ Files: [] });
    expect(supportOf(data)).toBe(1800000000000);
    expect(JSON.parse(serializeData(withSupport({}, 5), [])).omp).toEqual({ v: 1, h: [], d: { until: 5 } });
    const later = JSON.stringify({ omp: { v: 1, h: [], d: { until: 1900000000000 } } });
    expect(supportOfList([{ data }, { data: later }, { data: 'junk' }, {}])).toBe(1900000000000);
    expect(supportOfList(null)).toBe(0);
  });
});
