// The series screen: the TMDB show of a library series, found like the release posters are (a TMDB search for the
// poster query of the title, the year preferred) and kept in memory per series key and language, so a revisit is instant.
// A failed lookup (offline, no key) is not kept; a search with no show is.
import { signal } from '@preact/signals';
import { lang } from '../../../src/i18n';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { findShow, pickShow as pick } from './tmdbShow';
import { displayTitle, yearOf } from '../../../src/lib/torrentName';
import type { CatalogCard, CatalogTitle } from '../../../src/catalog/tmdb';
import type { SeriesGroup } from './seriesGroups';

const matches = new Map<string, CatalogCard | null>();

const cacheKey = (key: string) => lang.peek() + '|' + key;

/** The match found before: a card, null (no show), undefined (not looked up yet). */
export function cachedSeriesMatch(key: string): CatalogCard | null | undefined {
  return matches.get(cacheKey(key));
}

/** The show among search results: a series of that year, else the first series; films never match. */
export const pickShow = pick;

/** The earliest year in the titles of the series' torrents (the first season's, closest to the first air date). */
function groupYear(g: SeriesGroup): number {
  let best = 0;
  g.members.forEach((m) => {
    const y = +(yearOf(displayTitle(m).replace(/[._]+/g, ' ')) || 0);
    if (y && (!best || y < best)) best = y;
  });
  return best;
}

/** The TMDB card of the series (null when TMDB has no such show); rejects when TMDB cannot be reached. */
export function matchSeries(g: SeriesGroup): Promise<CatalogCard | null> {
  const key = cacheKey(g.key);
  const hit = matches.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return phoneCatalog().then((c) =>
    findShow(c, displayTitle(g.lead), groupYear(g)).then((show) => {
      if (!show) {
        matches.set(key, null);
        return null;
      }
      return c.card('tv', show.id).then((card) => {
        matches.set(key, card);
        return card;
      });
    }),
  );
}

// «Мои» tiles: lookups of the VISIBLE series cards only, at most 2 at a time, one per series key and language.
// A failed lookup (offline) is not retried for a while; a found card or «no show» is in `matches` for good.
const MAX_LOOKUPS = 2;
const RETRY_MS = 10 * 60 * 1000;
let running = 0;
let generation = 0;
const waiting: { key: string; group: SeriesGroup }[] = [];
const pending = new Set<string>();
const failedAt = new Map<string, number>();

/** Bumped when a tile lookup ends: the tiles read `cachedSeriesMatch` again. */
export const seriesMatchVersion = signal(0);

function pump(): void {
  while (running < MAX_LOOKUPS && waiting.length) {
    const job = waiting.shift()!;
    running++;
    const gen = generation;
    const done = (ok: boolean) => {
      if (gen !== generation) return;
      running--;
      pending.delete(job.key);
      if (!ok) failedAt.set(job.key, Date.now());
      seriesMatchVersion.value++;
      pump();
    };
    matchSeries(job.group).then(
      () => done(true),
      () => done(false),
    );
  }
}

/** A tile came into view: look its series up unless it is known, queued or failed lately. */
export function requestSeriesMatch(g: SeriesGroup): void {
  if (cachedSeriesMatch(g.key) !== undefined) return;
  const key = cacheKey(g.key);
  if (pending.has(key)) return;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return;
  pending.add(key);
  waiting.push({ key, group: g });
  pump();
}

/** Tests: forget every match. */
export function resetSeriesMatches(): void {
  matches.clear();
  waiting.length = 0;
  pending.clear();
  failedAt.clear();
  running = 0;
  generation++;
}
