// Where «Смотреть на ТВ» starts for a catalog series: the file with a saved position, else the first episode.
import type { Torrent } from '../../../../src/api/types';
import { librarySeasonHashes, seasonHashIndex } from '../../../../src/catalog/library';
import type { CatalogCard } from '../../../../src/catalog/tmdb';
import { parseEpisode, playableFiles, type TorrentFile } from '../../../../src/lib/episodes';
import { sharedProgress, sharedRatio, sharedResume } from '../../lib/sharedProgress';
import { filesOf } from '../../watch';

export interface WatchSpot {
  hash: string;
  file: TorrentFile;
  at: number;
}

function hashesOf(list: Torrent[], card: CatalogCard, season: number | null): string[] {
  const idx = seasonHashIndex(list);
  const numbers = season ? [season] : card.seasons.map((s) => s.number).sort((a, b) => a - b);
  const out: string[] = [];
  numbers.forEach((n) => {
    librarySeasonHashes(idx, card, n).forEach((h) => {
      if (out.indexOf(h) < 0) out.push(h);
    });
  });
  return out;
}

/** The first library torrent of the series (one season when `season` is set). */
export function seriesLibraryHash(list: Torrent[], card: CatalogCard, season: number | null): string {
  return hashesOf(list, card, season)[0] || '';
}

/** A playable file of the series (one season when `season` is set). Null when the library has none. */
export function seriesWatchSpot(list: Torrent[], card: CatalogCard, season: number | null): WatchSpot | null {
  const found: { best: WatchSpot | null; bestAt: number; first: { spot: WatchSpot; sn: number; ep: number } | null } = {
    best: null,
    bestAt: 0,
    first: null,
  };
  hashesOf(list, card, season).forEach((hash) => {
    const tor = list.filter((t) => t.hash === hash)[0];
    if (!tor) return;
    playableFiles(filesOf(tor)).forEach((file) => {
      const parsed = parseEpisode(file.path);
      if (season && parsed.season !== null && parsed.season !== season) return;
      const sn = parsed.season !== null ? parsed.season : season || 0;
      const ep = parsed.episode !== null ? parsed.episode : 0;
      const progress = sharedProgress(hash, file.id);
      const at = progress.position || sharedResume(hash, file.id);
      const spot = { hash, file, at };
      const first = found.first;
      // The series screen resumes the episode saved most recently, not the one left at the largest position.
      if (at > 0 && (!found.best || progress.updated > found.bestAt)) {
        found.best = spot;
        found.bestAt = progress.updated;
      }
      if (!first || sn < first.sn || (sn === first.sn && ep < first.ep)) found.first = { spot, sn, ep };
    });
  });
  return found.best || (found.first ? found.first.spot : null);
}

/** Watched share 0…1 of one episode (1 when it is finished), from its own progress, not the season's resume target. */
export function episodeRatio(list: Torrent[], card: CatalogCard, season: number, episode: number): number {
  let best = 0;
  hashesOf(list, card, season).forEach((hash) => {
    const tor = list.filter((t) => t.hash === hash)[0];
    if (!tor) return;
    playableFiles(filesOf(tor)).forEach((file) => {
      const parsed = parseEpisode(file.path);
      if (parsed.episode !== episode) return;
      if (parsed.season !== null && parsed.season !== season) return;
      const ratio = sharedRatio(hash, file.id);
      if (ratio > best) best = ratio;
    });
  });
  return best;
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
