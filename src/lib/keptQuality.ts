// The quality badge stays after the torrent is renamed to a clean title.
// The first release string that names a resolution is kept by hash; file names cover a title that was
// already clean before this build. Chromium 53: no ?., no ??.
import type { TorrentFile } from '../api/types';
import { displayBadge, parseReleaseInfo, resolutionFromSize } from './releaseInfo';
import { displayTitle, torrentFiles } from './torrentName';
import { nameLocked, rawReleaseOf } from './journal';
import { isObject, loadJson, saveJson } from '../store/storage';

const KEY = 'omp.rawTitle';

const mem: { [hash: string]: string } = {};
let loaded = false;

function qualityFrom(title: string): string {
  const res = parseReleaseInfo(title).resolution;
  return res ? displayBadge(res) : '';
}

function ensure(): void {
  if (loaded) return;
  loaded = true;
  const saved = loadJson<{ [k: string]: unknown }>(KEY, {}, isObject);
  const keys = Object.keys(saved);
  for (let i = 0; i < keys.length; i++) {
    const v = saved[keys[i]];
    if (typeof v === 'string' && v) mem[keys[i]] = v;
  }
}

function persist(): void {
  saveJson(KEY, mem);
}

/** Tests: forget the remembered release titles, including the copy in localStorage. */
export function resetKeptQuality(): void {
  const keys = Object.keys(mem);
  for (let i = 0; i < keys.length; i++) delete mem[keys[i]];
  loaded = true;
  persist();
  loaded = false;
}

/** Keeps the first title that still names a resolution. A later clean name does not replace it. */
export function rememberRawTitle(hash: string, title: string): void {
  ensure();
  if (!hash || mem[hash]) return;
  if (!qualityFrom(title || '')) return;
  mem[hash] = title;
  persist();
}

export function rememberedRawTitle(hash: string): string {
  ensure();
  return mem[hash] || '';
}

/**
 * Badge for a library card. The current title wins, then the release title saved before a rename,
 * then a file name (`Show.S01E01.1080p.mkv`).
 */
/** The release string readers should use: the one saved on the torrent, else the visible title. */
export function releaseText(tor: { hash: string; title?: string; name?: string; data?: string; file_stats?: TorrentFile[] }): string {
  return rawReleaseOf(tor.data) || displayTitle(tor);
}

function yearIn(title: string): number {
  const m = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/.exec(title || '');
  return m ? +m[1] : 0;
}

/**
 * The name and year film matching should use. An automatic cleanup keeps the saved release string.
 * A title the person typed wins, and a year they typed replaces the old one. A rename that
 * leaves the year out keeps the year from the release string.
 */
export function identityText(tor: { hash?: string; title?: string; name?: string; data?: string; file_stats?: TorrentFile[] }): string {
  const named = { hash: tor.hash || '', title: tor.title, name: tor.name, data: tor.data, file_stats: tor.file_stats };
  const visible = displayTitle(named);
  const raw = rawReleaseOf(tor.data);
  if (!nameLocked(tor.data)) return raw || visible;
  if (yearIn(visible)) return visible;
  const y = yearIn(raw);
  return y ? visible + ' (' + y + ')' : visible;
}

export function torrentQuality(tor: { hash: string; title?: string; name?: string; data?: string; file_stats?: TorrentFile[]; torrent_size?: number }): string {
  const own = qualityFrom(displayTitle(tor));
  if (own) return own;
  const shared = qualityFrom(rawReleaseOf(tor.data));
  if (shared) return shared;
  const saved = rememberedRawTitle(tor.hash);
  if (saved) {
    const q = qualityFrom(saved);
    if (q) return q;
  }
  const files = torrentFiles(tor);
  for (let i = 0; i < files.length; i++) {
    const q = qualityFrom(files[i].path || '');
    if (q) return q;
  }
  const named = displayTitle(tor) + ' ' + (rawReleaseOf(tor.data) || '');
  const est = resolutionFromSize(named, tor.torrent_size);
  return est ? displayBadge(est) : '';
}
