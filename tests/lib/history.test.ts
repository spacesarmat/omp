import { describe, it, expect } from 'vitest';
import { buildHistory, whenLabel, sourceLine, deviceLabel, resumeFrom, isHistoryFilter, type FallbackEntry, type HistoryProgress } from '../../src/lib/history';
import type { Torrent } from '../../src/api/types';

// local time: 2 October 2026, 23:00
const NOW = new Date(2026, 9, 2, 23, 0).getTime();
const at = (month: number, day: number, h: number, m: number, year = 2026) => new Date(year, month, day, h, m).getTime();

function torrent(hash: string, entries?: object[], extra: object = {}): Torrent {
  const data = entries ? JSON.stringify({ TorrServer: { Files: [] }, omp: { v: 1, h: entries }, ...extra }) : '';
  return { hash, title: 'T ' + hash, stat: 5, data };
}

const noLocal = () => null;

describe('buildHistory', () => {
  const a = torrent('a', [
    { f: 3, t: 600, d: 2900, at: at(9, 2, 21, 40), src: 'phone', name: 'Pixel 7' },
    { f: 2, t: 100, d: 2900, at: at(9, 1, 22, 15), src: 'tv' },
  ]);
  const b = torrent('b', [{ f: 1, t: 4325, d: 7120, at: at(9, 1, 20, 0), src: 'tv' }]);
  const c = torrent('c'); // no journal
  const d = { hash: 'd', title: 'D', stat: 5, data: 'not json' } as Torrent;
  const fallback: FallbackEntry[] = [
    { torrent: c, fileIndex: 0, progress: { time: 50, duration: 100, updated: at(8, 30, 10, 0) } },
    { torrent: d, fileIndex: 4, progress: { time: 70, duration: 0, updated: 0 } },
    // a torrent with a journal: the journal wins
    { torrent: b, fileIndex: 9, progress: { time: 1, duration: 2, updated: at(9, 2, 22, 0) } },
  ];
  const list = [a, b, c, d];

  it('all: the latest entry per torrent from the journals, then the older sources as TV, newest first', () => {
    const h = buildHistory(list, 'all', fallback, noLocal);
    expect(h.map((x) => [x.torrent.hash, x.fileIndex, x.source.src, x.source.name || ''])).toEqual([
      ['a', 3, 'phone', 'Pixel 7'],
      ['b', 1, 'tv', ''],
      ['c', 0, 'tv', ''],
      ['d', 4, 'tv', ''],
    ]);
    expect(h[0].progress).toEqual({ time: 600, duration: 2900, updated: at(9, 2, 21, 40) });
    expect(h[3].source.at).toBe(0);
  });

  it('tv: TV entries and the older sources', () => {
    const h = buildHistory(list, 'tv', fallback, noLocal);
    expect(h.map((x) => [x.torrent.hash, x.fileIndex])).toEqual([['a', 2], ['b', 1], ['c', 0], ['d', 4]]);
  });

  it('phone: phone entries only', () => {
    const h = buildHistory(list, 'phone', fallback, noLocal);
    expect(h.map((x) => [x.torrent.hash, x.fileIndex])).toEqual([['a', 3]]);
  });

  it('newer local progress of the same file replaces the journal position', () => {
    const local = (hash: string, f: number): HistoryProgress | null =>
      hash === 'b' && f === 1 ? { time: 5000, duration: 7120, updated: at(9, 2, 22, 30) } : null;
    const h = buildHistory(list, 'all', [], local);
    expect(h[0].torrent.hash).toBe('b');
    expect(h[0].progress.time).toBe(5000);
    expect(h[0].source).toEqual({ src: 'tv', at: at(9, 2, 22, 30) });
  });

  it('a phone-only journal still shows the TV fallback under «С телевизора»', () => {
    const p = torrent('p', [{ f: 1, t: 5, d: 9, at: at(9, 1, 20, 0), src: 'phone', name: 'Pixel' }]);
    const fb: FallbackEntry[] = [{ torrent: p, fileIndex: 7, progress: { time: 50, duration: 100, updated: at(9, 2, 10, 0) } }];
    expect(buildHistory([p], 'tv', fb, noLocal).map((x) => [x.fileIndex, x.source.src])).toEqual([[7, 'tv']]);
    expect(buildHistory([p], 'all', fb, noLocal).map((x) => [x.fileIndex, x.source.src])).toEqual([[1, 'phone']]);
  });

  it('newer local progress is labelled as this device', () => {
    const local = (): HistoryProgress => ({ time: 100, duration: 200, updated: at(9, 2, 22, 30) });
    const h = buildHistory([a], 'all', [], local, 40, { src: 'tv' });
    expect(h[0].source).toEqual({ src: 'tv', at: at(9, 2, 22, 30) });
    const h2 = buildHistory([b], 'all', [], local, 40, { src: 'phone', name: 'Моя' });
    expect(h2[0].source).toEqual({ src: 'phone', name: 'Моя', at: at(9, 2, 22, 30) });
  });

  it('older local progress does not', () => {
    const local = (): HistoryProgress => ({ time: 1, duration: 2, updated: 1 });
    expect(buildHistory([b], 'all', [], local)[0].progress.time).toBe(4325);
  });

  it('respects the limit', () => {
    expect(buildHistory(list, 'all', fallback, noLocal, 2)).toHaveLength(2);
  });
});

describe('labels', () => {
  it('when: today, yesterday, a date, a date of another year', () => {
    expect(whenLabel(at(9, 2, 21, 40), NOW)).toBe('сегодня 21:40');
    expect(whenLabel(at(9, 2, 0, 5), NOW)).toBe('сегодня 00:05');
    expect(whenLabel(at(9, 1, 22, 15), NOW)).toBe('вчера 22:15');
    expect(whenLabel(at(8, 30, 12, 0), NOW)).toBe('30 сентября');
    expect(whenLabel(at(0, 1, 12, 0), NOW)).toBe('1 января');
    expect(whenLabel(at(11, 31, 12, 0, 2025), NOW)).toBe('31 декабря 2025');
    expect(whenLabel(0, NOW)).toBe('');
  });

  it('yesterday across a month boundary', () => {
    expect(whenLabel(at(8, 30, 23, 59), at(9, 1, 0, 30))).toBe('вчера 23:59');
  });

  it('device and source line', () => {
    expect(deviceLabel('tv')).toBe('Телевизор');
    expect(deviceLabel('phone', 'Pixel 7')).toBe('Телефон «Pixel 7»');
    expect(deviceLabel('phone')).toBe('Телефон');
    expect(deviceLabel('phone', 'Телефон')).toBe('Телефон');
    expect(sourceLine({ src: 'phone', name: 'Андрей', at: at(9, 2, 21, 40) }, NOW)).toBe('Телефон «Андрей» · сегодня 21:40');
    expect(sourceLine({ src: 'tv', at: at(9, 1, 22, 15) }, NOW)).toBe('Телевизор · вчера 22:15');
    expect(sourceLine({ src: 'tv', at: 0 }, NOW)).toBe('Телевизор');
  });

  it('filter values', () => {
    expect(isHistoryFilter('phone')).toBe(true);
    expect(isHistoryFilter('radio')).toBe(false);
  });
});

describe('resumeFrom', () => {
  it('the saved position unless too early or finished', () => {
    expect(resumeFrom({ time: 600, duration: 2900, updated: 1 }, 10, 0.9)).toBe(600);
    expect(resumeFrom({ time: 600, duration: 0, updated: 1 }, 10, 0.9)).toBe(600);
    expect(resumeFrom({ time: 5, duration: 2900, updated: 1 }, 10, 0.9)).toBe(0);
    expect(resumeFrom({ time: 2800, duration: 2900, updated: 1 }, 10, 0.9)).toBe(0);
  });
});
