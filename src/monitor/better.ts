// «Лучшее качество» (v0.17) for the films of the library: a release of the same film (name, year ±1) in a better
// quality (quality.ts) than the library torrent. Each film is searched at most once a day (stamps in tsp.betterChecked,
// pruned to the library). A film's first check is silent, as a subscription's is: the best rank it finds is only
// remembered as the baseline, so an upgrade with a big library does not flood the notifications. After that, one
// finding per new best rank (`<hash>:<rank>`). Films whose journal says omp.q: false
// («Следить за качеством» off) are skipped. Series are left to the new-episodes check. Chromium 53 safe.
import { guessCategory } from '../lib/categoryGuess';
import { watchesBetterQuality } from '../lib/journal';
import { posterQuery } from '../lib/posterSearch';
import { displayTitle } from '../lib/torrentName';
import { searchAll, type SearchHandle } from '../sources/search';
import type { SourceContext, SourceResult } from '../sources/types';
import { isObject, loadJson, saveJson } from '../store/storage';
import type { CheckOptions } from './check';
import { seriesNames, yearOf, type LibraryTorrent } from './newEpisodes';
import { isBetter, qualityLabel, qualityRank } from './quality';
import { addFindings, rememberSeen, seenKeys } from './subs';
import { BETTER_ID, type Finding } from './types';

export const BETTER_CHECKED_KEY = 'tsp.betterChecked';
/** A film is searched at most once in this time. */
export const BETTER_EVERY_MS = 24 * 60 * 60 * 1000;

export interface BetterRelease {
  /** Library torrent (lowercase infohash). */
  torrentHash: string;
  /** qualityRank of the candidate. */
  rank: number;
  /** The best better release: the highest rank, then the most seeds. */
  candidate: SourceResult;
  /** Other better releases, best first («Другая раздача»). */
  others: SourceResult[];
}

/** A film of the library: category «Фильмы», or an empty category the title guesses as a film. */
export function isLibraryFilm(t: Pick<LibraryTorrent, 'title' | 'category'>): boolean {
  const c = t.category || '';
  // an explicit category is the user's word; only an empty one is guessed (as isWatchedSeries does)
  return c === 'movie' || (c === '' && guessCategory(t.title) === 'movie');
}

/** Search query for a film: the first title variant (up to four words) plus the year when the title has one. */
export function filmQuery(title: string): string {
  const name = posterQuery(title);
  if (!name) return '';
  const year = yearOf(title);
  return year !== null ? name + ' ' + year : name;
}

/** A library film whose quality is watched (omp.q is not false) and whose title gives a query. */
export function isWatchedFilm(t: LibraryTorrent): boolean {
  return isLibraryFilm(t) && watchesBetterQuality(t.data) && filmQuery(displayTitle(t)) !== '';
}

interface Ranked {
  r: SourceResult;
  rank: number;
  i: number;
}

/** The best better release of the same film among `results`, or null. */
export function pickBetter(t: LibraryTorrent, results: SourceResult[]): BetterRelease | null {
  const title = displayTitle(t);
  const names = seriesNames(title);
  if (!names.length) return null;
  const haveYear = yearOf(title);
  const hash = (t.hash || '').toLowerCase();
  const list: Ranked[] = [];
  results.forEach((r, i) => {
    if (hash && r.hash === hash) return;
    // a series or a soundtrack of the same name is not the film
    if (guessCategory(r.Title) !== 'movie') return;
    // without a year a remake cannot be told apart: when the library title has one, the candidate needs it too
    const year = yearOf(r.Title);
    if (haveYear !== null && (year === null || Math.abs(year - haveYear) > 1)) return;
    if (!seriesNames(r.Title).some((n) => names.indexOf(n) >= 0)) return;
    if (!isBetter(r.Title, title)) return;
    list.push({ r, rank: qualityRank(r.Title), i });
  });
  if (!list.length) return null;
  list.sort((a, b) => b.rank - a.rank || (b.r.Seed || 0) - (a.r.Seed || 0) || a.i - b.i);
  return { torrentHash: hash, rank: list[0].rank, candidate: list[0].r, others: list.slice(1).map((x) => x.r) };
}

interface Outcome {
  /** Some source answered (the film counts as checked). */
  answered: boolean;
  best: BetterRelease | null;
}

function search(ctx: SourceContext, t: LibraryTorrent, o: CheckOptions): Promise<Outcome> {
  const none: Outcome = { answered: false, best: null };
  if (!isWatchedFilm(t)) return Promise.resolve(none);
  let h: SearchHandle;
  try {
    h = (o.search || searchAll)(filmQuery(displayTitle(t)), { ctx, from: o.from, timeoutMs: o.timeoutMs });
  } catch (e) {
    return Promise.resolve(none);
  }
  return h.done.then(
    () => ({ answered: h.answered().length > 0, best: pickBetter(t, h.results()) }),
    () => none,
  );
}

/** Searches now for a better release of a watched library film (no daily limit: the replace sheet). Never rejects. */
export function findBetter(ctx: SourceContext, t: LibraryTorrent, opts?: CheckOptions): Promise<BetterRelease | null> {
  return search(ctx, t, opts || {}).then((x) => x.best);
}

/** `<hash>:<rank>`: one notification per new best rank of a film. */
export function betterKey(b: Pick<BetterRelease, 'torrentHash' | 'rank'>): string {
  return b.torrentHash + ':' + b.rank;
}

/** The highest rank already reported for a film (-1: none). */
function reportedRank(hash: string, seen: string[]): number {
  let max = -1;
  seen.forEach((k) => {
    const at = k.lastIndexOf(':');
    if (at > 0 && k.slice(0, at) === hash) {
      const n = parseInt(k.slice(at + 1), 10);
      if (n > max) max = n;
    }
  });
  return max;
}

// --- daily stamps: { [lowercase hash]: unix ms of the last search some source answered }

function loadChecked(): { [hash: string]: number } {
  const v = loadJson<unknown>(BETTER_CHECKED_KEY, {}, isObject) as { [k: string]: unknown };
  const out: { [hash: string]: number } = {};
  Object.keys(v).forEach((h) => {
    const at = v[h];
    if (typeof at === 'number' && isFinite(at) && at > 0) out[h] = at;
  });
  return out;
}

function stamp(hash: string, now: number): void {
  const all = loadChecked();
  all[hash] = now;
  saveJson(BETTER_CHECKED_KEY, all);
}

/** The film is due: never searched, searched BETTER_EVERY_MS ago or more, or stamped in the future (clock change). */
export function betterDue(hash: string, now: number): boolean {
  const at = loadChecked()[(hash || '').toLowerCase()];
  return !at || at > now || now - at >= BETTER_EVERY_MS;
}

/** Drops the stamps of torrents for which `keep(hash)` is false (gone from the library). */
export function pruneBetterChecked(keep: (hash: string) => boolean): void {
  const all = loadChecked();
  const left: { [hash: string]: number } = {};
  let changed = false;
  Object.keys(all).forEach((h) => {
    if (keep(h)) left[h] = all[h];
    else changed = true;
  });
  if (changed) saveJson(BETTER_CHECKED_KEY, left);
}

/** The watched films that are due, the longest unchecked first (never checked before all), else in library order. */
export function dueFilms<T extends LibraryTorrent>(torrents: T[], now: number): T[] {
  const checked = loadChecked();
  const at = (t: T) => checked[(t.hash || '').toLowerCase()] || 0;
  return torrents
    .map((t, i) => ({ t, i }))
    .filter((x) => isWatchedFilm(x.t) && betterDue(x.t.hash, now))
    .sort((a, b) => at(a.t) - at(b.t) || a.i - b.i)
    .map((x) => x.t);
}

/**
 * Checks the due watched films one by one; returns (and saves) the findings of ranks above any reported before for the
 * film. The first check of a film only stores its baseline rank (no finding). A film is stamped only when some source answered (an offline run tries again next time). Never rejects.
 */
export function checkBetterQuality(ctx: SourceContext, torrents: LibraryTorrent[], opts?: CheckOptions): Promise<Finding[]> {
  const o = opts || {};
  const at = o.now === undefined ? Date.now() : o.now;
  const found: Finding[] = [];
  let chain: Promise<void> = Promise.resolve();
  dueFilms(torrents, at).forEach((t) => {
    chain = chain.then(() =>
      search(ctx, t, o).then((x) => {
        const hash = (t.hash || '').toLowerCase();
        const reported = reportedRank(hash, seenKeys(BETTER_ID) || []);
        // never searched (no stamp) and nothing reported: this answer is the film's baseline
        const baseline = !loadChecked()[hash] && reported < 0;
        if (x.answered) stamp(hash, at);
        const b = x.best;
        if (!b || b.rank <= reported) return;
        const key = betterKey(b);
        if (baseline) {
          rememberSeen(BETTER_ID, [key]);
          return;
        }
        const title = displayTitle(t);
        const f: Finding = {
          subId: BETTER_ID,
          key,
          result: b.candidate,
          at,
          better: { torrentHash: hash, torrentTitle: title, have: qualityLabel(title), got: qualityLabel(b.candidate.Title) },
        };
        rememberSeen(BETTER_ID, [key]);
        addFindings([f]);
        found.push(f);
      }),
    );
  });
  return chain.then(() => found);
}
