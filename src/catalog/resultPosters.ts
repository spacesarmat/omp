// Posters for found releases (search rows, «Новое» cards): a TMDB search through the active catalog client.
// Lookups are deduplicated by the normalized query and at most MAX_RUNNING run at once, so a long result list never
// floods the network or slows the torrent search down. The phone plugs its own catalog in with setPosterLookup.
// Chromium 53 safe.
import { activeCatalog } from './activeCatalog';
import { latinTitle, posterQuery } from '../lib/posterSearch';
import { parseEpisodeRange } from '../monitor/episodes';
import { libraryTitle } from '../lib/libraryView';
import { yearOf } from '../lib/torrentName';
import type { CatalogTitle } from './tmdb';

/** The show name a poster search should use: before « · сезон» and the release tail. */
export function posterName(title: string): string {
  const named = libraryTitle({ hash: '', title: title || '' });
  const base = named.meta ? named.title : (named.title || '').split(' · ')[0];
  return posterQuery(base || title || '');
}

/** Queries for one release: the show name, then the Latin title when the torrent names both. */
export function posterQueries(title: string): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    const n = (q || '').replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  add(posterName(title));
  add(latinTitle([title || '']));
  return out;
}

/** A series release names a season. The poster and the group then prefer the TV show over a film of the same name. */
export function releaseIsSeries(title: string): boolean {
  return parseEpisodeRange(title || '').season !== undefined;
}

/**
 * The TMDB row to use. A series release takes the TV show (exact title first), and a film of the same
 * name does not stand in for it. `year` picks among what is left.
 */
function withPosterFirst(list: CatalogTitle[], year: number): CatalogTitle | null {
  const pictured = list.filter((x) => /^https?:\/\//i.test(x.poster || ''));
  const use = pictured.length ? pictured : list;
  const same = year ? use.filter((x) => x.year === year)[0] : undefined;
  return same || use[0] || null;
}

export function showChoice(items: CatalogTitle[], query: string, year: number, series: boolean): CatalogTitle | null {
  const q = (query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const exact = q
    ? items.filter((x) => (x.title || '').toLowerCase() === q || (x.original || '').toLowerCase() === q)
    : [];
  const pool = exact.length ? exact : items;
  if (series) {
    const tvExact = exact.filter((x) => x.kind === 'tv');
    const shows = tvExact.length ? tvExact : items.filter((x) => x.kind === 'tv');
    if (!shows.length) return null;
    return withPosterFirst(shows, year);
  }
  return withPosterFirst(pool, year);
}

/** A poster URL from a TMDB page. A series release returns a poster only from a TV show. */
export function posterChoice(items: CatalogTitle[], query: string, year: number, series?: boolean): string {
  const hit = showChoice(items, query, year, !!series);
  if (!hit) return '';
  if (series && hit.kind !== 'tv') return '';
  return /^https?:\/\//i.test(hit.poster || '') ? hit.poster : '';
}

export const MAX_RUNNING = 3;

/** The poster URL for a query ('' when none); `year` prefers a title of that year. `series` keeps a film from standing in. */
export type PosterLookup = (query: string, year: number, series?: boolean) => Promise<string>;

const catalogLookup: PosterLookup = (query, year, series) =>
  activeCatalog()
    .then((c) => c.search(query, 1))
    .then((r) => {
      return posterChoice(r.items, query, year, !!series);
    });

let lookup: PosterLookup = catalogLookup;

interface Entry {
  key: string;
  query: string;
  year: number;
  series: boolean;
  state: 'queued' | 'running' | 'done';
  url: string;
  waiters: ((url: string) => void)[];
}

let entries: { [key: string]: Entry } = {};
let queue: Entry[] = [];
let running = 0;
// bumped on a reset: lookups of an earlier generation finish without touching the new state
let generation = 0;

/** The dedupe key: the poster query of the title, case- and space-insensitive. */
export function posterKey(title: string): string {
  return posterName(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pump(): void {
  while (running < MAX_RUNNING && queue.length) {
    const e = queue.shift()!;
    e.state = 'running';
    running++;
    const gen = generation;
    const finish = (url: string, keep: boolean) => {
      if (gen !== generation) return;
      running--;
      e.state = 'done';
      e.url = url;
      const w = e.waiters;
      e.waiters = [];
      // a failed lookup (offline, blocked, no key) is forgotten: a row shown later asks again
      if (!keep && entries[e.key] === e) delete entries[e.key];
      for (let i = 0; i < w.length; i++) w[i](url);
      pump();
    };
    let p: Promise<string>;
    try {
      p = lookup(e.query, e.year, e.series);
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (url) => finish(typeof url === 'string' ? url : '', true),
      () => finish('', false),
    );
  }
}

/**
 * Asks for the poster of a release title; `done` gets the URL ('' when none). Returns a cancel function: a lookup
 * nobody waits for any more leaves the queue before it starts. `metaYear` is the year the indexer reported for the
 * row; it stands in for the year of the title, which a name like «1917 (2019)» reads wrong.
 */
function requestOne(query: string, title: string, series: boolean, year: number, done: (url: string) => void): () => void {
  const key = query.toLowerCase().replace(/\s+/g, ' ').trim() + '\u0000' + (year || '0') + (series ? '\u0000tv' : '');
  if (!key) {
    done('');
    return () => undefined;
  }
  let e = entries[key];
  if (e && e.state === 'done') {
    done(e.url);
    return () => undefined;
  }
  if (!e) {
    e = { key, query, year, series, state: 'queued', url: '', waiters: [] };
    entries[key] = e;
    queue.push(e);
  }
  const entry = e;
  let called = false;
  const waiter = (url: string) => {
    if (!called) {
      called = true;
      done(url);
    }
  };
  entry.waiters.push(waiter);
  pump();
  return () => {
    called = true;
    const i = entry.waiters.indexOf(waiter);
    if (i >= 0) entry.waiters.splice(i, 1);
    if (entry.state === 'queued' && !entry.waiters.length) {
      queue = queue.filter((q) => q !== entry);
      if (entries[key] === entry) delete entries[key];
    }
  };
}

/**
 * Asks for the poster of a release title; `done` gets the URL ('' when none). A series title tries the Latin
 * name when the local one has no TV poster. Returns a cancel function.
 */
export function requestPoster(title: string, done: (url: string) => void, metaYear?: number): () => void {
  const queries = posterQueries(title);
  const series = releaseIsSeries(title);
  const year = metaYear || titleYear(title);
  if (!queries.length) {
    done('');
    return () => undefined;
  }
  let dead = false;
  let cancelCurrent = (): void => undefined;
  const step = (i: number) => {
    if (dead) return;
    if (i >= queries.length) {
      done('');
      return;
    }
    cancelCurrent = requestOne(queries[i], title, series, year, (url) => {
      if (dead) return;
      if (url || i + 1 >= queries.length) done(url);
      else step(i + 1);
    });
  };
  step(0);
  return () => {
    dead = true;
    cancelCurrent();
  };
}

/**
 * Sets the lookup (null restores the active-catalog one) and forgets every poster found so far: the phone plugs in
 * its catalog at start, tests a fake.
 */
export function setPosterLookup(fn: PosterLookup | null): void {
  lookup = fn || catalogLookup;
  entries = {};
  queue = [];
  running = 0;
  generation++;
}

/** The year a release line names for itself (dots as separators: «1917.2019.1080p»). */
function titleYear(title: string): number {
  const y = yearOf((title || '').replace(/[._]+/g, ' '));
  return y ? +y : 0;
}

/** TMDB show a release resolved to. `poster` is '' when the page had the show but no image. */
export interface ShowHit {
  id: number;
  title: string;
  poster: string;
}

export type ShowLookup = (query: string, year: number) => Promise<CatalogTitle[]>;

const defaultShowLookup: ShowLookup = (query) =>
  activeCatalog()
    .then((c) => c.search(query, 1))
    .then((r) => r.items || [])
    .catch(() => []);

let showLookup: ShowLookup = defaultShowLookup;

interface ShowEntry {
  key: string;
  title: string;
  year: number;
  state: 'queued' | 'running' | 'done';
  hit: ShowHit | null;
  waiters: ((hit: ShowHit | null) => void)[];
}

let showEntries: { [key: string]: ShowEntry } = {};
let showQueue: ShowEntry[] = [];
let showRunning = 0;

function posterOf(hit: CatalogTitle | null): string {
  return hit && /^https?:\/\//i.test(hit.poster || '') ? hit.poster : '';
}

function resolveShow(title: string, metaYear: number): Promise<ShowHit | null> {
  const series = releaseIsSeries(title);
  const year = metaYear || titleYear(title);
  const queries = posterQueries(title);
  const step = (i: number, fallback: ShowHit | null): Promise<ShowHit | null> => {
    if (i >= queries.length) return Promise.resolve(fallback);
    return showLookup(queries[i], year).then(
      (items) => {
        const hit = showChoice(items || [], queries[i], year, series);
        if (!hit || !hit.id || (series && hit.kind !== 'tv')) return step(i + 1, fallback);
        const row: ShowHit = { id: hit.id, title: hit.title || queries[i], poster: posterOf(hit) };
        if (row.poster) return Promise.resolve(row);
        return step(i + 1, fallback || row);
      },
      () => step(i + 1, fallback),
    );
  };
  return step(0, null);
}

function pumpShows(): void {
  while (showRunning < MAX_RUNNING && showQueue.length) {
    const e = showQueue.shift()!;
    e.state = 'running';
    showRunning++;
    resolveShow(e.title, e.year).then((hit) => {
      showRunning--;
      if (showEntries[e.key] !== e) {
        pumpShows();
        return;
      }
      e.state = 'done';
      e.hit = hit;
      const w = e.waiters;
      e.waiters = [];
      for (let i = 0; i < w.length; i++) w[i](hit);
      pumpShows();
    });
  }
}

/** The show (id, title, poster) for a release title. The same title shares one lookup. */
export function requestShow(title: string, done: (hit: ShowHit | null) => void, metaYear?: number): () => void {
  const queries = posterQueries(title);
  const year = metaYear || titleYear(title);
  const key = (queries.join('\n') + '\u0000' + (year || '0') + (releaseIsSeries(title) ? '\u0000tv' : '')).toLowerCase();
  if (!queries.length) {
    done(null);
    return () => undefined;
  }
  let e = showEntries[key];
  if (e && e.state === 'done') {
    done(e.hit);
    return () => undefined;
  }
  if (!e) {
    e = { key, title, year, state: 'queued', hit: null, waiters: [] };
    showEntries[key] = e;
    showQueue.push(e);
    pumpShows();
  }
  const entry = e;
  let called = false;
  const waiter = (hit: ShowHit | null) => {
    if (!called) {
      called = true;
      done(hit);
    }
  };
  entry.waiters.push(waiter);
  return () => {
    called = true;
    const i = entry.waiters.indexOf(waiter);
    if (i >= 0) entry.waiters.splice(i, 1);
  };
}

/** Phone catalog, or null to restore the active-catalog search. Forgets shows found so far. */
export function setShowLookup(fn: ShowLookup | null): void {
  showLookup = fn || defaultShowLookup;
  showEntries = {};
  showQueue = [];
  showRunning = 0;
}
