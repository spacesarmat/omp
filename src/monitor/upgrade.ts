// «Найти в лучшем качестве» (v0.17) on the torrent screen: a search the user starts for a release of the same film or
// the same season of a series in a better quality than the library torrent. Films follow the rules of the daily check
// (better.ts); a series release must be of the same series and season (a pack of seasons covering it counts) and hold
// at least the episodes the torrent has. The user-initiated search tries every switched-on source (no pause, no daily
// limit). After a replace the phone's own watch positions (tsp.progress, keyed by infohash and file index) are moved to
// the new torrent's files matched by episode (replace.ts mapFiles), so «Продолжить» lands on the same episode. Pure
// selection plus a cancellable search; Chromium 53 safe.
import { guessCategory } from '../lib/categoryGuess';
import type { TorrentFile } from '../lib/episodes';
import { displayTitle } from '../lib/torrentName';
import { searchAll, type SearchHandle } from '../sources/search';
import type { SourceContext, SourceResult } from '../sources/types';
import { clearProgress, getLocalProgress, saveProgress } from '../store/progress';
import { betterFilmReleases, filmQuery, isLibraryFilm, rankReleases } from './better';
import type { CheckOptions } from './check';
import { parseEpisodeRange } from './episodes';
import { libraryRange, seriesNames, seriesQuery, yearOf, type LibraryTorrent } from './newEpisodes';
import { isBetter } from './quality';
import { mapFiles } from './replace';

export type UpgradeKind = 'film' | 'series';

/** A library series (category «Сериалы», or an empty one guessed as a series) whose season and episodes are known. */
function isUpgradeSeries(t: LibraryTorrent): boolean {
  const c = t.category || '';
  if (c !== 'tv' && (c !== '' || guessCategory(t.title) !== 'tv')) return false;
  return libraryRange(t) !== null;
}

/** What the torrent is for «Найти в лучшем качестве»: a film, a series with a known season, or null (not offered). */
export function upgradeKind(t: LibraryTorrent): UpgradeKind | null {
  const title = displayTitle(t);
  if (isUpgradeSeries(t)) return seriesQuery(t.title) ? 'series' : null;
  if (isLibraryFilm({ title, category: t.category })) return filmQuery(title) ? 'film' : null;
  return null;
}

/** The search query: the film's name and year, or the series' name. '' when the torrent is not offered. */
export function upgradeQuery(t: LibraryTorrent): string {
  const kind = upgradeKind(t);
  if (kind === 'film') return filmQuery(displayTitle(t));
  if (kind === 'series') return seriesQuery(t.title);
  return '';
}

/**
 * Releases of the same season of the series in a better quality, best first. The candidate: the same series name;
 * the year ±1 when both titles have one; the same season, or a pack of seasons that covers it; at least the episodes
 * the torrent has (its last episode ≥ ours, its first ≤ ours when both are known; a pack of seasons counts as whole);
 * isBetter than the torrent's title; not a soundtrack; not the torrent itself.
 */
export function betterSeriesReleases(t: LibraryTorrent, results: SourceResult[]): SourceResult[] {
  const have = libraryRange(t);
  if (!have) return [];
  const title = displayTitle(t);
  const names = seriesNames(t.title);
  if (!names.length) return [];
  const haveYear = yearOf(t.title);
  const hash = (t.hash || '').toLowerCase();
  return rankReleases(
    results.filter((r) => {
      if (hash && r.hash === hash) return false;
      if (guessCategory(r.Title) === 'music') return false;
      const range = parseEpisodeRange(r.Title);
      if (range.seasonTo !== undefined) {
        // a pack of seasons: the whole seasons, ours among them
        if (range.season === undefined || have.season < range.season || have.season > range.seasonTo) return false;
      } else {
        if ((range.season === undefined ? 1 : range.season) !== have.season) return false;
        if (range.to === undefined || range.to < have.to) return false;
        if (range.from !== undefined && have.from !== undefined && range.from > have.from) return false;
      }
      const year = yearOf(r.Title);
      if (haveYear !== null && year !== null && Math.abs(year - haveYear) > 1) return false;
      if (!seriesNames(r.Title).some((n) => names.indexOf(n) >= 0)) return false;
      return isBetter(r.Title, title);
    }),
  );
}

/** The better releases of the torrent among `results`, best first (rank, then seeds); [] when it is not offered. */
export function pickUpgrades(t: LibraryTorrent, results: SourceResult[]): SourceResult[] {
  const kind = upgradeKind(t);
  if (kind === 'film') return betterFilmReleases(t, results);
  if (kind === 'series') return betterSeriesReleases(t, results);
  return [];
}

export interface UpgradeOutcome {
  /** Better releases, best first. */
  candidates: SourceResult[];
  /** Some source answered (false: nothing could be asked, every source failed, or cancelled). */
  answered: boolean;
}

export interface UpgradeSearch {
  /** Never rejects. */
  done: Promise<UpgradeOutcome>;
  /** Stops the search; `done` then settles with no candidates. */
  cancel(): void;
}

/** Searches now (every switched-on source, or `opts.from`) for better releases of the torrent. */
export function findUpgrades(ctx: SourceContext, t: LibraryTorrent, opts?: CheckOptions): UpgradeSearch {
  const o = opts || {};
  const none: UpgradeOutcome = { candidates: [], answered: false };
  const query = upgradeQuery(t);
  if (!query) return { done: Promise.resolve(none), cancel: () => undefined };
  let cancelled = false;
  let h: SearchHandle;
  try {
    h = (o.search || searchAll)(query, { ctx, from: o.from, timeoutMs: o.timeoutMs, cloudflareTimeoutMs: o.cloudflareTimeoutMs });
  } catch (e) {
    return { done: Promise.resolve(none), cancel: () => undefined };
  }
  const done = h.done.then(
    (): UpgradeOutcome => (cancelled ? none : { candidates: pickUpgrades(t, h.results()), answered: h.answered().length > 0 }),
    () => none,
  );
  return {
    done,
    cancel: () => {
      cancelled = true;
      h.cancel();
    },
  };
}

/**
 * Moves the phone's watch positions of the old torrent to the new one, file by file as mapFiles matches them (by the
 * episode label / number, else the name, else the index). Positions are written oldest first, so the last watched
 * episode stays the latest; a new file that already has a position keeps it. The old torrent's positions are then
 * dropped. Returns how many were carried.
 */
export function carryProgress(oldHash: string, oldFiles: TorrentFile[], newHash: string, newFiles: TorrentFile[]): number {
  if (!oldHash || !newHash || oldHash === newHash || !oldFiles.length || !newFiles.length) return 0;
  const map = mapFiles(oldFiles, newFiles);
  const moves: { to: number; time: number; duration: number; updated: number }[] = [];
  oldFiles.forEach((f) => {
    const p = getLocalProgress(oldHash, f.id);
    const to = map[f.id];
    if (!p || to === null || to === undefined) return;
    if (getLocalProgress(newHash, to)) return;
    moves.push({ to, time: p.time, duration: p.duration, updated: p.updated });
  });
  // two old files on one new slot: the newer position wins
  moves.sort((a, b) => b.updated - a.updated);
  const taken: { [id: number]: boolean } = {};
  const keep = moves.filter((m) => {
    if (taken[m.to]) return false;
    taken[m.to] = true;
    return true;
  });
  keep.reverse().forEach((m) => saveProgress(newHash, m.to, m.time, m.duration));
  clearProgress(oldHash);
  return keep.length;
}
