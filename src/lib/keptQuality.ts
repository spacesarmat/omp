// The quality badge stays after the torrent is renamed to a clean title.
// The first release string that names a resolution is kept by hash; file names cover a title that was
// already clean before this build. Chromium 53: no ?., no ??.
import type { TorrentFile } from '../api/types';
import { displayBadge, parseReleaseInfo, releaseBadges } from './releaseInfo';
import { displayTitle, torrentFiles } from './torrentName';
import { isObject, loadJson, saveJson } from '../store/storage';

const KEY = 'omp.rawTitle';

const mem: { [hash: string]: string } = {};
let loaded = false;

function qualityFrom(title: string): string {
  const badges = releaseBadges(parseReleaseInfo(title)).filter((x) => !/^\d{4}$/.test(x));
  return badges.length ? displayBadge(badges[0]) : '';
}

function ensure(): void {
  if (loaded) return;
  loaded = true;
  const saved = loadJson<unknown>(KEY, {}, isObject);
  const keys = Object.keys(saved);
  for (let i = 0; i < keys.length; i++) {
    const v = (saved as { [k: string]: unknown })[keys[i]];
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
export function torrentQuality(tor: { hash: string; title?: string; name?: string; data?: string; file_stats?: TorrentFile[] }): string {
  const own = qualityFrom(displayTitle(tor));
  if (own) return own;
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
  return '';
}
