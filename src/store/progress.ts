import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent, ViewedEntry } from '../api/types';
import type { TorrServerClient } from '../api/torrserver';

export interface Progress {
  time: number;
  duration: number;
  updated: number;
  /** The player said this stop is not a finish, even when the position is near the end. */
  open?: boolean;
}

const KEY = 'tsp.progress';
export const WATCHED_RATIO = 0.9;
export const MIN_RESUME = 10;

export function sanitizeProgress(v: unknown): { [k: string]: Progress } {
  const out: { [k: string]: Progress } = {};
  if (!isObject(v)) return out;
  Object.keys(v).forEach((k) => {
    const p = v[k];
    if (isObject(p) && typeof p.time === 'number' && typeof p.duration === 'number' && typeof p.updated === 'number'
      && isFinite(p.time) && isFinite(p.duration) && isFinite(p.updated)) {
      const row: Progress = { time: p.time, duration: p.duration, updated: p.updated };
      if (p.open === true) row.open = true;
      out[k] = row;
    }
  });
  return out;
}

let local: { [k: string]: Progress } = sanitizeProgress(loadJson<unknown>(KEY, {}, isObject));
export const progressVersion = signal(0);
export const serverViewed = signal<ViewedEntry[]>([]);

const key = (hash: string, idx: number) => hash + ':' + idx;

// strictly increasing timestamps keep 'continue watching' order deterministic
let lastStamp = 0;
function stamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

function persist() {
  saveJson(KEY, local);
  progressVersion.value++;
}

export function reloadProgress(): void {
  local = sanitizeProgress(loadJson<unknown>(KEY, {}, isObject));
  progressVersion.value++;
}

export function getLocalProgress(hash: string, idx: number): Progress | null {
  return local[key(hash, idx)] || null;
}

/** When any file of `hash` was played here last (finished ones too); 0 when never. */
export function lastPlayedAt(hash: string): number {
  const head = hash + ':';
  let best = 0;
  Object.keys(local).forEach((k) => {
    if (k.indexOf(head) === 0 && (local[k].updated || 0) > best) best = local[k].updated || 0;
  });
  return best;
}

function serverEntry(hash: string, idx: number): ViewedEntry | null {
  return serverViewed.value.find((e) => e.hash === hash && e.file_index === idx) || null;
}

/** The two sources of a file's progress, for reading copies of one episode together (src/lib/episodeProgress). */
export const progressReader = {
  local: getLocalProgress,
  server: serverEntry,
};

function ratio(p: Progress): number {
  return p.duration > 0 ? p.time / p.duration : 0;
}

export function isWatched(hash: string, idx: number): boolean {
  const p = getLocalProgress(hash, idx);
  if (p && p.open) return false;
  if (p && p.duration > 0) return ratio(p) >= WATCHED_RATIO;
  const s = serverEntry(hash, idx);
  return !!s && !(s.timecode && s.timecode >= MIN_RESUME);
}

export function resumePosition(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  if (p && p.open && p.time >= MIN_RESUME) return p.time;
  if (p && p.duration > 0) return ratio(p) < WATCHED_RATIO && p.time >= MIN_RESUME ? p.time : 0;
  const s = serverEntry(hash, idx);
  return s && s.timecode && s.timecode >= MIN_RESUME ? s.timecode : 0;
}

export function progressRatio(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  return p ? Math.min(1, ratio(p)) : 0;
}

export function saveProgress(hash: string, idx: number, time: number, duration: number, open = false): void {
  const row: Progress = { time, duration, updated: stamp() };
  if (open) row.open = true;
  local[key(hash, idx)] = row;
  persist();
}

export function markWatched(hash: string, idx: number): void {
  saveProgress(hash, idx, 1, 1);
}

/** The files of `hash` with progress on this device. */
export function localFileIds(hash: string): number[] {
  const head = hash + ':';
  return Object.keys(local)
    .filter((k) => k.indexOf(head) === 0)
    .map((k) => +k.slice(head.length))
    .filter((n) => isFinite(n));
}

/**
 * The progress of `fromHash` copied onto the files of `toHash` (`map`: from id to id, null skipped) where it is newer
 * than what is there; the times stay. Returns how many were copied.
 */
export function carryProgress(fromHash: string, toHash: string, map: { [fromId: number]: number | null }): number {
  let n = 0;
  localFileIds(fromHash).forEach((id) => {
    const to = map[id];
    if (to === null || to === undefined) return;
    const src = local[key(fromHash, id)];
    const dst = local[key(toHash, to)];
    if (dst && (dst.updated || 0) >= (src.updated || 0)) return;
    local[key(toHash, to)] = { time: src.time, duration: src.duration, updated: src.updated };
    n++;
  });
  if (n) persist();
  return n;
}

export function clearProgress(hash: string, idx?: number): void {
  if (idx === undefined) {
    Object.keys(local).forEach((k) => { if (k.indexOf(hash + ':') === 0) delete local[k]; });
  } else {
    delete local[key(hash, idx)];
  }
  persist();
}

let viewedGen = 0;

/** Changes whenever the server marks are reset (another server): a late write must not refill the cache then. */
export function viewedGeneration(): number {
  return viewedGen;
}

export function resetViewed(): void {
  viewedGen++;
  serverViewed.value = [];
}

export function refreshViewed(c: Pick<TorrServerClient, 'viewedList'>): Promise<void> {
  const my = viewedGen;
  return c.viewedList().then(
    (list) => { if (my === viewedGen) serverViewed.value = list; },
    () => undefined,
  );
}

export function continueWatching(list: Torrent[], limit = 10): { torrent: Torrent; fileIndex: number; progress: Progress }[] {
  const byHash: { [h: string]: Torrent } = {};
  list.forEach((t) => { byHash[t.hash] = t; });
  const entries = Object.keys(local)
    .map((k) => {
      const sep = k.lastIndexOf(':');
      return { hash: k.slice(0, sep), fileIndex: +k.slice(sep + 1), progress: local[k] };
    })
    .filter((e) => byHash[e.hash] && e.progress.time >= MIN_RESUME && ratio(e.progress) < WATCHED_RATIO)
    .sort((a, b) => b.progress.updated - a.progress.updated);
  const server = serverViewed.value
    .filter((e) => byHash[e.hash] && typeof e.timecode === 'number' && e.timecode >= MIN_RESUME && !local[key(e.hash, e.file_index)])
    .map((e) => ({ hash: e.hash, fileIndex: e.file_index, progress: { time: e.timecode as number, duration: 0, updated: 0 } }));
  const all = entries.concat(server);
  const seen: { [h: string]: boolean } = {};
  const out: { torrent: Torrent; fileIndex: number; progress: Progress }[] = [];
  all.forEach((e) => {
    if (seen[e.hash] || out.length >= limit) return;
    seen[e.hash] = true;
    out.push({ torrent: byHash[e.hash], fileIndex: e.fileIndex, progress: e.progress });
  });
  return out;
}
