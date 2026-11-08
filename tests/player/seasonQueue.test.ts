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

  it('an episode with no season number still stops on a gap, and the chosen copy stays', () => {
    const files = [
      file(1, 'Show.E01.mkv'),
      file(8, 'Show.E01.Director.mkv'),
      file(3, 'Show.E03.mkv'),
      file(9, 'Show/Extras/interview.mkv'),
    ];
    const span = seasonSpan(files, 8);
    expect(span.episodic).toBe(true);
    expect(span.season).toBeNull();
    expect(span.files.map((f) => f.id)).toEqual([8]);
    expect(span.missing).toBe(2);
    expect(seasonFileIds(files, 8)).toEqual([8]);
  });

  it('a file from another season folder does not fill this season, and an explicit season wins over the folder', () => {
    const files = [
      file(1, 'Season 1/Show.E01.mkv'),
      file(2, 'Season 2/Show - 02.mkv'),
      file(3, 'Season 1/Show.E03.mkv'),
      file(4, 'Season 2/Show.S01E02.mkv'),
    ];
    const season1 = seasonSpan(files, 1);
    expect(season1.season).toBe(1);
    expect(season1.files.map((f) => f.id)).toEqual([1, 4, 3]);
    expect(season1.missing).toBeNull();
    expect(seasonFileIds(files, 1)).toEqual([1, 4, 3]);
    expect(season1.files.some((f) => f.id === 2)).toBe(false);
    const chosen = seasonSpan(files, 4);
    expect(chosen.files[0].id).toBe(4);
    expect(chosen.files.map((f) => f.id)).toEqual([4, 3]);
    const gapped = [
      file(1, 'Season 1/Show.E01.mkv'),
      file(2, 'Season 2/Show - 02.mkv'),
      file(3, 'Season 1/Show.E03.mkv'),
    ];
    const hole = seasonSpan(gapped, 1);
    expect(hole.files.map((f) => f.id)).toEqual([1]);
    expect(hole.missing).toBe(2);
    expect(seasonFileIds(gapped, 1)).toEqual([1]);
    const season2 = seasonSpan(files, 2);
    expect(season2.season).toBe(2);
    expect(season2.files.map((f) => f.id)).toEqual([2]);
    expect(season2.missing).toBeNull();
    expect(season2.files.some((f) => f.id === 4)).toBe(false);
  });

  it('a fractional episode does not stand in for the whole number, and a normal E02 still does', () => {
    const prefixed = [
      file(1, 'Show.S01E01.mkv'),
      file(2, 'Show.S01E02.5.mkv'),
      file(3, 'Show.S01E03.mkv'),
    ];
    const hole = seasonSpan(prefixed, 1);
    expect(hole.files.map((f) => f.id)).toEqual([1]);
    expect(hole.missing).toBe(2);
    expect(seasonFileIds(prefixed, 1)).toEqual([1]);
    const special = seasonSpan(prefixed, 2);
    expect(special.episodic).toBe(true);
    expect(special.season).toBe(1);
    expect(special.files.map((f) => f.id)).toEqual([2]);
    expect(special.missing).toBeNull();
    expect(seasonFileIds(prefixed, 2)).toEqual([2]);
    const loose = [
      file(1, 'Show.E01.mkv'),
      file(2, 'Show.E02.5.mkv'),
      file(3, 'Season 1/E02.5.mkv'),
      file(4, 'Show.E03.mkv'),
    ];
    expect(seasonSpan(loose, 1).files.map((f) => f.id)).toEqual([1]);
    expect(seasonSpan(loose, 1).missing).toBe(2);
    const whole = [
      file(1, 'Show.E01.mkv'),
      file(2, 'Show.E02.mkv'),
      file(9, 'Show.E02.1080p.mkv'),
      file(3, 'Show.E03.mkv'),
    ];
    const run = seasonSpan(whole, 1);
    expect(run.missing).toBeNull();
    expect(run.files.map((f) => f.id)).toContain(1);
    expect(run.files.map((f) => f.id)).toContain(3);
    expect(run.files.filter((f) => f.id === 2 || f.id === 9)).toHaveLength(1);
    const picked = seasonSpan(whole, 9);
    expect(picked.files[0].id).toBe(9);
    expect(picked.files.some((f) => f.id === 2)).toBe(false);
    expect(seasonSpan([file(1, 'Show.S01E02.mkv')], 1).missing).toBeNull();
    expect(seasonSpan([file(1, 'Show.S01E02.x264.mkv')], 1).files).toHaveLength(1);
    expect(seasonSpan([file(1, 'Season 1/02.mkv')], 1).season).toBe(1);
    const otherFolder = [
      file(1, 'Show.E01.mkv'),
      file(2, 'Season 1/02.mkv'),
      file(3, 'Show.E03.mkv'),
    ];
    expect(seasonSpan(otherFolder, 1).files.map((f) => f.id)).toEqual([1]);
    expect(seasonSpan(otherFolder, 1).missing).toBe(2);
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
