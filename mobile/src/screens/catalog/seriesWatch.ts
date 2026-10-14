// Where «Смотреть на ТВ» starts for a catalog series: the file with a saved position, else the first episode.
import type { Torrent } from '../../../../src/api/types';
import { librarySeasonHash, seasonIndex } from '../../../../src/catalog/library';
import type { CatalogCard } from '../../../../src/catalog/tmdb';
import { parseEpisode, playableFiles, type TorrentFile } from '../../../../src/lib/episodes';
import { sharedResume } from '../../lib/sharedProgress';
import { filesOf } from '../../watch';

export interface WatchSpot {
  hash: string;
  file: TorrentFile;
  at: number;
}

function hashesOf(list: Torrent[], card: CatalogCard, season: number | null): string[] {
  const idx = seasonIndex(list);
  const numbers = season ? [season] : card.seasons.map((s) => s.number).sort((a, b) => a - b);
  const out: string[] = [];
  numbers.forEach((n) => {
    const h = librarySeasonHash(idx, card, n);
    if (h && out.indexOf(h) < 0) out.push(h);
  });
  return out;
}

/** The first library torrent of the series (one season when `season` is set). */
export function seriesLibraryHash(list: Torrent[], card: CatalogCard, season: number | null): string {
  return hashesOf(list, card, season)[0] || '';
}

/** A playable file of the series (one season when `season` is set). Null when the library has none. */
export function seriesWatchSpot(list: Torrent[], card: CatalogCard, season: number | null): WatchSpot | null {
  let best: WatchSpot | null = null;
  let first: { spot: WatchSpot; sn: number; ep: number } | null = null;
  hashesOf(list, card, season).forEach((hash) => {
    const tor = list.filter((t) => t.hash === hash)[0];
    if (!tor) return;
    playableFiles(filesOf(tor)).forEach((file) => {
      const parsed = parseEpisode(file.path);
      if (season && parsed.season !== null && parsed.season !== season) return;
      const sn = parsed.season !== null ? parsed.season : season || 0;
      const ep = parsed.episode !== null ? parsed.episode : 0;
      const at = sharedResume(hash, file.id);
      const spot = { hash, file, at };
      if (at > 0 && (!best || at > best.at)) best = spot;
      if (!first || sn < first.sn || (sn === first.sn && ep < first.ep)) first = { spot, sn, ep };
    });
  });
  return best || (first ? first.spot : null);
}

/** File size of each episode number in one season (the largest file when several torrents have it). */
export function episodeSizes(list: Torrent[], card: CatalogCard, season: number): { [n: number]: number } {
  const out: { [n: number]: number } = {};
  hashesOf(list, card, season).forEach((hash) => {
    const tor = list.filter((t) => t.hash === hash)[0];
    if (!tor) return;
    playableFiles(filesOf(tor)).forEach((file) => {
      const parsed = parseEpisode(file.path);
      if (parsed.episode === null) return;
      if (parsed.season !== null && parsed.season !== season) return;
      const prev = out[parsed.episode] || 0;
      if (file.length > prev) out[parsed.episode] = file.length;
    });
  });
  return out;
}
