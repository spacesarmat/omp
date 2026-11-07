import { describe, it, expect } from 'vitest';
import { seasonFileIds, seasonSpan, seasonStep } from '../../src/player/seasonQueue';
import type { TorrentFile } from '../../src/lib/episodes';

const file = (id: number, path: string): TorrentFile => ({ id, path, length: 1 });

const pack: TorrentFile[] = [
  file(1, 'TNG.S06E01.mkv'),
  file(5, 'TNG.S06E05.mkv'),
  file(6, 'TNG.S06E06.mkv'),
  file(8, 'TNG.S06E08.mkv'),
  file(20, 'TNG.S06E10.mkv'),
  file(11, 'TNG.S07E01.mkv'),
  file(30, 'TNG/Extras/interview.mkv'),
];

describe('season queue', () => {
  it('starts mid-season and keeps only the later episodes of that season', () => {
    const span = seasonSpan(pack, 5);
    expect(span.season).toBe(6);
    expect(span.start).toBe(0);
    expect(span.files.map((f) => f.id)).toEqual([5, 6]);
    expect(span.missing).toBe(7);
    expect(seasonFileIds(pack, 5)).toEqual([5, 6]);
  });

  it('plays through the end of the season when the catalog count is reached', () => {
    const span = seasonSpan([file(1, 'TNG.S06E01.mkv'), file(2, 'TNG.S06E02.mkv'), file(3, 'TNG.S07E01.mkv')], 1, 2);
    expect(span.files.map((f) => f.id)).toEqual([1, 2]);
    expect(span.missing).toBeNull();
  });

  it('names the next episode when the release stops before the known season length', () => {
    const span = seasonSpan([file(1, 'TNG.S06E01.mkv'), file(2, 'TNG.S06E02.mkv')], 1, 26);
    expect(span.files.map((f) => f.id)).toEqual([1, 2]);
    expect(span.missing).toBe(3);
  });

  it('a film is one file and does not send a season list', () => {
    const span = seasonSpan([file(1, 'Movie.2020.mkv'), file(2, 'Movie.2020.extra.mkv')], 1);
    expect(span.season).toBeNull();
    expect(span.files.map((f) => f.id)).toEqual([1]);
    expect(span.missing).toBeNull();
    expect(seasonFileIds([file(1, 'Movie.2020.mkv')], 1)).toBeUndefined();
  });

  it('the next episode starts once, a stop or a second end does not move', () => {
    const base = { length: 3, index: 1, ended: true, cancel: false, seen: null as number | null, missing: 8 };
    const first = seasonStep(base);
    expect(first.step).toEqual({ kind: 'next', index: 2 });
    const again = seasonStep({ ...base, seen: first.seen });
    expect(again.step).toEqual({ kind: 'stay' });
    expect(seasonStep({ ...base, cancel: true }).step).toEqual({ kind: 'stay' });
    expect(seasonStep({ ...base, ended: false }).step).toEqual({ kind: 'stay' });
    expect(seasonStep({ ...base, index: 2, seen: null }).step).toEqual({ kind: 'done', missing: 8 });
  });
});
