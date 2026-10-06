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

function episodeKey(path: string): string {
  const e = parseEpisode(path);
  return e.season !== null && e.episode !== null ? e.season + 'x' + e.episode : '';
}

/** Per torrent: its series group and its episodes (file id → SxxEyy key, SxxEyy key → file ids). */
interface Entry {
  tor: Torrent;
  group: number;
  keyOf: { [id: number]: string };
  idsOf: { [key: string]: number[] };
}

interface Index {
  byHash: { [hash: string]: Entry };
  /** Group id → the hashes in it (only series; a film or a nameless torrent is alone, group -1). */
  members: { [group: number]: string[] };
}

// one index per torrent list (the store replaces the array on every change): titles and files are parsed once per list
const indexes = new WeakMap<Torrent[], Index>();

function buildIndex(list: Torrent[]): Index {
  const parent: number[] = list.map(function (_, i) { return i; });
  const find = function (i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner: { [name: string]: number } = {};
  const named: boolean[] = [];
  list.forEach(function (t, i) {
    const names = isSeriesTorrent(t) ? seriesNames(displayTitle(t)) : [];
    named.push(names.length > 0);
    names.forEach(function (n) {
      if (owner[n] === undefined) owner[n] = i;
      else {
        const a = find(owner[n]);
        const b = find(i);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    });
  });
  const byHash: { [hash: string]: Entry } = {};
  const members: { [group: number]: string[] } = {};
  list.forEach(function (t, i) {
    const group = named[i] ? find(i) : -1;
    const keyOf: { [id: number]: string } = {};
    const idsOf: { [key: string]: number[] } = {};
    if (group >= 0) {
      playableFiles(torrentFiles(t)).forEach(function (f) {
        const k = episodeKey(f.path);
        if (!k) return;
        keyOf[f.id] = k;
        (idsOf[k] = idsOf[k] || []).push(f.id);
      });
      (members[group] = members[group] || []).push(t.hash);
    }
    if (!byHash[t.hash]) byHash[t.hash] = { tor: t, group: group, keyOf: keyOf, idsOf: idsOf };
  });
  return { byHash: byHash, members: members };
}

function indexOf(list: Torrent[]): Index {
  let ix = indexes.get(list);
  if (!ix) {
    ix = buildIndex(list);
    indexes.set(list, ix);
  }
  return ix;
}

/** The torrents of the same series as `tor` (sharing a name variant, as the library groups them), `tor` included. */
export function seriesSiblings(list: Torrent[], tor: Torrent): Torrent[] {
  const ix = indexOf(list);
  const e = ix.byHash[tor.hash];
  if (!e || e.group < 0) return [tor];
  return ix.members[e.group].map(function (h) { return ix.byHash[h].tor; });
}

/** The file of `tor` at `idx` and the same episode in the other releases of its series (that one first). */
export function episodeCopies(list: Torrent[], hash: string, idx: number): EpisodeCopy[] {
  const self: EpisodeCopy = { hash: hash, fileIndex: idx };
  const ix = indexOf(list);
  const e = ix.byHash[hash];
  const key = e ? e.keyOf[idx] : undefined;
  if (!e || !key) return [self];
  const out: EpisodeCopy[] = [self];
  ix.members[e.group].forEach(function (h) {
    if (h === hash) return;
    const ids = ix.byHash[h].idsOf[key];
    if (ids) ids.forEach(function (id) { out.push({ hash: h, fileIndex: id }); });
  });
  return out;
}

/** Whether the file at `idx` of the torrent has an episode number (SxxEyy). */
export function isEpisodeFile(list: Torrent[], hash: string, idx: number): boolean {
  const e = indexOf(list).byHash[hash];
  return !!e && !!e.keyOf[idx];
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
 * The progress of a file counting the copies of its episode in the other releases of the series.
 * A watched record (local or a server mark) wins over a position unless that position is strictly newer than a known
 * watched time; a server mark has no time, so it always wins. Among positions the most recently updated wins (the
 * file's own on a tie). A position from another copy is kept only below the file's own known duration.
 * Nothing recorded anywhere: not watched, no position.
 */
export function episodeProgress(list: Torrent[], hash: string, idx: number, reader: ProgressReader): EpisodeProgress {
  let watched: EpisodeProgress | null = null;
  let untimed = false;
  let partial: EpisodeProgress | null = null;
  episodeCopies(list, hash, idx).forEach(function (c) {
    const p = own(c, reader);
    if (!p) return;
    if (p.watched) {
      if (!p.updated) untimed = true;
      if (!watched || p.updated > watched.updated) watched = p;
    } else if (!partial || p.updated > partial.updated) {
      partial = p;
    }
  });
  const w = watched as EpisodeProgress | null;
  const pp = partial as EpisodeProgress | null;
  const b = w && (untimed || !pp || pp.updated <= w.updated) ? w : pp;
  if (!b) return { watched: false, position: 0, ratio: 0, updated: 0, duration: 0, hash: hash, fileIndex: idx };
  if (b.hash === hash && b.fileIndex === idx) return b;
  const mine = reader.local(hash, idx);
  const known = mine && mine.duration > 0 ? mine.duration : 0;
  if (b.position && known && b.position >= known) {
    return { watched: b.watched, position: 0, ratio: b.ratio, updated: b.updated, duration: b.duration, hash: b.hash, fileIndex: b.fileIndex };
  }
  return b;
}
