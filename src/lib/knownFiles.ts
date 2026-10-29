// The file list of a release, kept on this device once TorrServer has shown it. TorrServer lists a torrent it is not
// working on without file_stats, and keeps the files in `data` only when that was empty when it saved the torrent:
// OMP writes the tracker seed count (`omp.ts`) right after adding, before the metadata arrives, so a release added by
// OMP often has no files there. Without this, a release that stopped answering showed no episodes at all.
import type { TorrentFile } from './episodes';
import { isObject, loadJson, saveJson } from '../store/storage';

const KEY = 'omp.knownFiles';
/** Releases kept (the newest seen first); an old one drops out. */
export const KNOWN_FILES_MAX = 150;

type Entry = { h: string; f: TorrentFile[] };

let cache: Entry[] | null = null;

function validFile(v: unknown): v is TorrentFile {
  return isObject(v) && typeof v.id === 'number' && typeof v.path === 'string' && typeof v.length === 'number';
}

function validEntry(v: unknown): v is Entry {
  return isObject(v) && typeof v.h === 'string' && Array.isArray(v.f) && v.f.every(validFile);
}

function entries(): Entry[] {
  if (!cache) cache = loadJson<Entry[]>(KEY, [], (v) => Array.isArray(v) && v.every(validEntry));
  return cache;
}

function slim(files: TorrentFile[]): TorrentFile[] {
  return files.filter(validFile).map((f) => ({ id: f.id, path: f.path, length: f.length }));
}

function sameFiles(a: TorrentFile[], b: TorrentFile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].path !== b[i].path || a[i].length !== b[i].length) return false;
  return true;
}

/** Puts one release first; true when the stored list changed. */
function put(hash: string, files: TorrentFile[]): boolean {
  const h = (hash || '').toLowerCase();
  const f = slim(files || []);
  if (!h || !f.length) return false;
  const all = entries();
  const at = all.findIndex((e) => e.h === h);
  if (at === 0 && sameFiles(all[0].f, f)) return false;
  if (at > 0 && sameFiles(all[at].f, f)) return false;
  const rest = all.filter((e) => e.h !== h);
  cache = [{ h, f }].concat(rest).slice(0, KNOWN_FILES_MAX);
  return true;
}

/** The files TorrServer last showed for the release on this device; [] when never seen. */
export function knownFiles(hash: string | undefined): TorrentFile[] {
  const h = (hash || '').toLowerCase();
  if (!h) return [];
  const e = entries().filter((x) => x.h === h)[0];
  return e ? e.f : [];
}

/** Remembers the files of a release (a loadInfo answer, a list entry with file_stats). */
export function rememberFiles(hash: string, files: TorrentFile[] | undefined): void {
  if (put(hash, files || [])) saveJson(KEY, entries());
}

/** The files kept in a torrent's `data` by TorrServer ({"TorrServer":{"Files":[...]}}); [] when there are none. */
export function dataFiles(data: string | undefined): TorrentFile[] {
  if (!data || !data.trim()) return [];
  try {
    const d = JSON.parse(data);
    const f = d && d.TorrServer && d.TorrServer.Files;
    return Array.isArray(f) ? f : [];
  } catch (e) {
    return [];
  }
}

/**
 * The torrent list from the server: the releases TorrServer shows files for, and keeps none of in `data`, are remembered
 * (one write for the whole list). Those with files in `data` need nothing here.
 */
export function rememberListed(list: { hash: string; data?: string; file_stats?: TorrentFile[] }[]): void {
  let changed = false;
  (list || []).forEach((t) => {
    if (!t || !t.file_stats || !t.file_stats.length || dataFiles(t.data).length) return;
    if (put(t.hash, t.file_stats)) changed = true;
  });
  if (changed) saveJson(KEY, entries());
}

/** Tests: forget the in-memory copy (the next read loads localStorage again). */
export function resetKnownFilesForTests(): void {
  cache = null;
}
