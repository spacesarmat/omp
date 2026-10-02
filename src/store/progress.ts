import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent, ViewedEntry } from '../api/types';
import type { TorrServerClient } from '../api/torrserver';

export interface Progress {
  time: number;
  duration: number;
  updated: number;
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
      out[k] = { time: p.time, duration: p.duration, updated: p.updated };
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

function serverEntry(hash: string, idx: number): ViewedEntry | null {
  return serverViewed.value.find((e) => e.hash === hash && e.file_index === idx) || null;
}

function ratio(p: Progress): number {
  return p.duration > 0 ? p.time / p.duration : 0;
}

export function isWatched(hash: string, idx: number): boolean {
  const p = getLocalProgress(hash, idx);
  if (p && p.duration > 0) return ratio(p) >= WATCHED_RATIO;
  const s = serverEntry(hash, idx);
  return !!s && !(s.timecode && s.timecode >= MIN_RESUME);
}

export function resumePosition(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  if (p && p.duration > 0) return ratio(p) < WATCHED_RATIO && p.time >= MIN_RESUME ? p.time : 0;
  const s = serverEntry(hash, idx);
  return s && s.timecode && s.timecode >= MIN_RESUME ? s.timecode : 0;
}

export function progressRatio(hash: string, idx: number): number {
  const p = getLocalProgress(hash, idx);
  return p ? Math.min(1, ratio(p)) : 0;
}

export function saveProgress(hash: string, idx: number, time: number, duration: number): void {
  local[key(hash, idx)] = { time, duration, updated: stamp() };
  persist();
}

export function markWatched(hash: string, idx: number): void {
  saveProgress(hash, idx, 1, 1);
}

export function clearProgress(hash: string, idx?: number): void {
  if (idx === undefined) {
    Object.keys(local).forEach((k) => { if (k.indexOf(hash + ':') === 0) delete local[k]; });
  } else {
    delete local[key(hash, idx)];
  }
  persist();
}

export function refreshViewed(c: Pick<TorrServerClient, 'viewedList'>): Promise<void> {
  return c.viewedList().then(
    (list) => { serverViewed.value = list; },
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
  const seen: { [h: string]: boolean } = {};
  const out: { torrent: Torrent; fileIndex: number; progress: Progress }[] = [];
  entries.forEach((e) => {
    if (seen[e.hash] || out.length >= limit) return;
    seen[e.hash] = true;
    out.push({ torrent: byHash[e.hash], fileIndex: e.fileIndex, progress: e.progress });
  });
  return out;
}
