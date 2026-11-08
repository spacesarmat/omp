import { describe, it, expect } from 'vitest';
import { seasonFileIds, seasonSpan, seasonStep, seasonVisit } from '../../src/player/seasonQueue';
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

  it('keeps the chosen copy when another file has the same episode', () => {
    const files = [
      file(1, 'Show.S01E01.mkv'),
      file(9, 'Show.S01E01.Director.mkv'),
      file(3, 'Show.S01E02.mkv'),
    ];
    const span = seasonSpan(files, 9);
    expect(span.files.map((f) => f.id)).toEqual([9, 3]);
    expect(seasonFileIds(files, 9)).toEqual([9, 3]);
    expect(span.files.filter((f) => f.id === 1)).toEqual([]);
  });

  it('a combined file that skips a number does not hide the gap or the episode in between', () => {
    const withHole = [file(1, 'Show.S01E01E03.mkv'), file(4, 'Show.S01E04.mkv')];
    const hole = seasonSpan(withHole, 1);
    expect(hole.files.map((f) => f.id)).toEqual([1]);
    expect(hole.missing).toBe(2);
    const filled = [file(1, 'Show.S01E01E03.mkv'), file(2, 'Show.S01E02.mkv'), file(4, 'Show.S01E04.mkv')];
    const span = seasonSpan(filled, 1);
    expect(span.files.map((f) => f.id)).toEqual([1, 2, 4]);
    expect(span.missing).toBeNull();
  });

  it('a combined file covers every episode in its name and is queued once', () => {
    const files = [
      file(1, 'Show.S01E01.mkv'),
      file(2, 'Show.S01E02-E03.mkv'),
      file(4, 'Show.S01E04.mkv'),
    ];
    const span = seasonSpan(files, 1);
    expect(span.files.map((f) => f.id)).toEqual([1, 2, 4]);
    expect(span.missing).toBeNull();
    expect(seasonSpan(files, 2).files.map((f) => f.id)).toEqual([2, 4]);
  });

  it('a known season length shows the episodes the release does not have', () => {
    const files = [1, 2, 3, 4, 5, 6].map((n) => file(n, 'Show.S06E0' + n + '.mkv'));
    expect(seasonSpan(files, 1).missing).toBeNull();
    expect(seasonSpan(files, 1, 8).missing).toBe(7);
    expect(seasonSpan(files, 1, 8).files).toHaveLength(6);
  });

  it('going back to an episode can advance again, a second end of the same visit cannot', () => {
    let state = { index: -1, ended: 0, advanced: false };
    state = seasonVisit(state, 0, 0, true).state;
    let step = seasonVisit(state, 0, 10, true);
    expect(step.go).toBe('next');
    state = step.state;
    step = seasonVisit(state, 0, 11, true);
    expect(step.go).toBe('stay');
    state = seasonVisit(step.state, 1, 10, true).state;
    expect(state.advanced).toBe(false);
    state = seasonVisit(state, 0, 0, true).state;
    step = seasonVisit(state, 0, 20, true);
    expect(step.go).toBe('next');
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
