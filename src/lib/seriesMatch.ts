// The series screen: the TMDB show of a library series, found like the release posters are (a TMDB search for the
// poster query of the title, the year preferred) and kept in memory per series key and language, so a revisit is instant.
// A failed lookup (offline, no key) is not kept; a search with no show is.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../store/storage';
import { lang } from '../i18n';
import { activeCatalog } from '../catalog/activeCatalog';
import { findShow, pickShow as pick } from './tmdbShow';
import { displayTitle, yearOf } from './torrentName';
import type { CatalogCard, CatalogTitle } from '../catalog/tmdb';
import type { SeriesGroup } from './seriesGroups';

const matches = new Map<string, CatalogCard | null>();

// The match outlives the page: series key → TMDB id (0: no show) with the show's status, for SAVED_TTL. A cold start
// then asks the card by id instead of searching again, and the calendar skips the shows known to be over.
const SAVED_KEY = 'tsp.seriesTmdb';
const SAVED_TTL = 7 * 24 * 60 * 60 * 1000;
const SAVED_MAX = 400;
interface Saved { id: number; s: string; at: number; }
let saved: { [k: string]: Saved } | null = null;

function savedMap(): { [k: string]: Saved } {
  if (saved) return saved;
  const raw = loadJson<{ [k: string]: unknown }>(SAVED_KEY, {}, isObject);
  const out: { [k: string]: Saved } = {};
  Object.keys(raw).forEach((k) => {
    const v = raw[k] as { id?: unknown; s?: unknown; at?: unknown } | null;
    if (v && typeof v.id === 'number' && v.id >= 0 && typeof v.at === 'number') out[k] = { id: v.id, s: typeof v.s === 'string' ? v.s : '', at: v.at };
  });
  saved = out;
  return out;
}

function savedOf(key: string): Saved | null {
  const v = savedMap()[key];
  const age = v ? Date.now() - v.at : -1;
  return v && age >= 0 && age < SAVED_TTL ? v : null;
}

function remember(key: string, card: CatalogCard | null): void {
  const map = savedMap();
  map[key] = { id: card ? card.id : 0, s: card && card.status ? card.status : '', at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > SAVED_MAX) {
    keys.sort((a, b) => map[a].at - map[b].at).slice(0, keys.length - SAVED_MAX).forEach((k) => delete map[k]);
  }
  saveJson(SAVED_KEY, map);
}

/** The series is known (from a match of the last 7 days) to be over (ended, canceled) or to be no TMDB show. */
export function knownOver(key: string): boolean {
  const v = savedOf(cacheKey(key));
  return !!v && (v.id === 0 || v.s === 'ended' || v.s === 'canceled');
}

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
export function matchSeries(g: SeriesGroup, opts?: { force?: boolean }): Promise<CatalogCard | null> {
  const key = cacheKey(g.key);
  const force = !!(opts && opts.force);
  const hit = matches.get(key);
  // `force` (pull to refresh): the show found before, its card fetched again
  if (hit !== undefined && !(force && hit)) return Promise.resolve(hit);
  const known = savedOf(key);
  return activeCatalog().then((c) => {
    if (known && known.id === 0) {
      matches.set(key, null);
      return null;
    }
    const found = hit ? Promise.resolve({ id: hit.id }) : known ? Promise.resolve({ id: known.id }) : findShow(c, displayTitle(g.named), groupYear(g));
    return found.then((show) => {
      if (!show) {
        matches.set(key, null);
        remember(key, null);
        return null;
      }
      return (force ? c.card('tv', show.id, { force: true }) : c.card('tv', show.id)).then((card) => {
        matches.set(key, card);
        remember(key, card);
        return card;
      });
    });
  });
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

/** The lookup of this series failed lately (offline, no key): no card is coming soon. */
export function seriesMatchFailed(key: string): boolean {
  const failed = failedAt.get(cacheKey(key));
  return failed !== undefined && Date.now() - failed < RETRY_MS;
}

/** Tests: forget every match. */
export function resetSeriesMatches(): void {
  matches.clear();
  saved = null;
  waiting.length = 0;
  pending.clear();
  failedAt.clear();
  running = 0;
  generation++;
}
