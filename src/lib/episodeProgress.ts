// One episode (SxxEyy) of a series is often in the library more than once: a 4K and a 1080p release of a season.
// Its progress is kept per torrent hash and file index; this reads the copies together, so watching S04E01 in one
// release marks it (or offers its position) in the others. Only reading: nothing stored or sent to TorrServer changes.
// Films, torrents of other series and files without SxxEyy are never mixed in. Pure: the progress comes from `reader`.
import { seriesNames } from '../monitor/newEpisodes';
import { guessCategory } from './categoryGuess';
import { displayTitle, torrentFiles } from './torrentName';
import { parseEpisode, playableFiles } from './episodes';
import type { Torrent } from '../api/types';

/** The same thresholds as src/store/progress.ts. */
const WATCHED_RATIO = 0.9;
const MIN_RESUME = 10;

export interface StoredProgress {
  time: number;
  duration: number;
  updated: number;
}

/** Where the progress of one file comes from: the local record, else the server's viewed mark. */
export interface ProgressReader {
  local(hash: string, idx: number): StoredProgress | null;
  server(hash: string, idx: number): { timecode?: number } | null;
}

export interface EpisodeProgress {
  watched: boolean;
  /** Seconds to resume from; 0 for none. */
  position: number;
  /** Watched share 0…1 of the copy the progress came from. */
  ratio: number;
  /** When it was recorded (0: a server mark or nothing). */
  updated: number;
  /** The duration known with it (0: unknown). */
  duration: number;
  /** The copy it came from. */
  hash: string;
  fileIndex: number;
}

export interface EpisodeCopy {
  hash: string;
  fileIndex: number;
}

function isSeriesTorrent(t: Torrent): boolean {
  if (t.category === 'tv') return true;
  if (t.category === 'movie' || t.category === 'music') return false;
  return guessCategory(displayTitle(t)) === 'tv';
}

function namesOf(t: Torrent): string[] {
  return isSeriesTorrent(t) ? seriesNames(displayTitle(t)) : [];
}

/** The torrents of the same series as `tor` (sharing a name variant, as the library groups them), `tor` included. */
export function seriesSiblings(list: Torrent[], tor: Torrent): Torrent[] {
  const names = namesOf(tor);
  if (!names.length) return [tor];
  const out: Torrent[] = [tor];
  const seen: { [n: string]: boolean } = {};
  names.forEach(function (n) {
    seen[n] = true;
  });
  // a release titled only in English joins through one titled in both: grow the name set until nothing new joins
  let grew = true;
  while (grew) {
    grew = false;
    list.forEach(function (t) {
      if (out.indexOf(t) >= 0 || t.hash === tor.hash) return;
      const ns = namesOf(t);
      if (!ns.some(function (n) { return seen[n]; })) return;
      out.push(t);
      ns.forEach(function (n) {
        seen[n] = true;
      });
      grew = true;
    });
  }
  return out;
}

function episodeKey(path: string): string {
  const e = parseEpisode(path);
  return e.season !== null && e.episode !== null ? e.season + 'x' + e.episode : '';
}

/** The file of `tor` at `idx` and the same episode in the other releases of its series (that one first). */
export function episodeCopies(list: Torrent[], hash: string, idx: number): EpisodeCopy[] {
  const self: EpisodeCopy = { hash: hash, fileIndex: idx };
  let tor: Torrent | undefined;
  for (let i = 0; i < list.length && !tor; i++) if (list[i].hash === hash) tor = list[i];
  if (!tor) return [self];
  const file = torrentFiles(tor).filter(function (f) { return f.id === idx; })[0];
  const key = file ? episodeKey(file.path) : '';
  if (!key) return [self];
  const out: EpisodeCopy[] = [self];
  seriesSiblings(list, tor).forEach(function (t) {
    if (t.hash === hash) return;
    playableFiles(torrentFiles(t)).forEach(function (f) {
      if (episodeKey(f.path) === key) out.push({ hash: t.hash, fileIndex: f.id });
    });
  });
  return out;
}

function own(c: EpisodeCopy, r: ProgressReader): EpisodeProgress | null {
  const p = r.local(c.hash, c.fileIndex);
  if (p && p.duration > 0) {
    const ratio = p.time / p.duration;
    const watched = ratio >= WATCHED_RATIO;
    return {
      watched: watched,
      position: !watched && p.time >= MIN_RESUME ? p.time : 0,
      ratio: Math.min(1, ratio),
      updated: p.updated,
      duration: p.duration,
      hash: c.hash,
      fileIndex: c.fileIndex,
    };
  }
  const s = r.server(c.hash, c.fileIndex);
  if (!s) return null;
  const at = s.timecode && s.timecode >= MIN_RESUME ? s.timecode : 0;
  return { watched: !at, position: at, ratio: 0, updated: 0, duration: 0, hash: c.hash, fileIndex: c.fileIndex };
}

/**
 * The progress of a file counting the copies of its episode in the other releases of the series: the most recently
 * updated record wins (the file's own on a tie). A position from another copy is kept only below the file's own
 * known duration. Nothing recorded anywhere: not watched, no position.
 */
export function episodeProgress(list: Torrent[], hash: string, idx: number, reader: ProgressReader): EpisodeProgress {
  let best: EpisodeProgress | null = null;
  episodeCopies(list, hash, idx).forEach(function (c) {
    const p = own(c, reader);
    if (p && (!best || p.updated > best.updated)) best = p;
  });
  const none: EpisodeProgress = { watched: false, position: 0, ratio: 0, updated: 0, duration: 0, hash: hash, fileIndex: idx };
  const b = best as EpisodeProgress | null;
  if (!b) return none;
  if (b.hash === hash && b.fileIndex === idx) return b;
  const mine = reader.local(hash, idx);
  const known = mine && mine.duration > 0 ? mine.duration : 0;
  if (b.position && known && b.position >= known) {
    return { watched: b.watched, position: 0, ratio: b.ratio, updated: b.updated, duration: b.duration, hash: b.hash, fileIndex: b.fileIndex };
  }
  return b;
}
