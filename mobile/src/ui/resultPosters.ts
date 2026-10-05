// Posters for found releases (search rows, «Новое» cards): a TMDB search through the «Обзор» catalog client, whose
// answers are cached on the phone. Lookups are deduplicated by the normalized query and at most MAX_RUNNING run at
// once, so a long result list never floods the network or slows the torrent search down.
import { phoneCatalog } from '../catalog/phoneCatalog';
import { posterQuery } from '../../../src/lib/posterSearch';
import { yearOf } from '../../../src/lib/torrentName';

export const MAX_RUNNING = 3;

/** The poster URL for a query ('' when none); `year` prefers a title of that year. */
export type PosterLookup = (query: string, year: number) => Promise<string>;

const catalogLookup: PosterLookup = (query, year) =>
  phoneCatalog()
    .then((c) => c.search(query, 1))
    .then((r) => {
      const withPoster = r.items.filter((x) => !!x.poster);
      const same = year ? withPoster.filter((x) => x.year === year)[0] : undefined;
      return (same || withPoster[0] || { poster: '' }).poster;
    });

let lookup: PosterLookup = catalogLookup;

interface Entry {
  key: string;
  query: string;
  year: number;
  state: 'queued' | 'running' | 'done';
  url: string;
  waiters: ((url: string) => void)[];
}

let entries: { [key: string]: Entry } = {};
let queue: Entry[] = [];
let running = 0;
// bumped by the test reset: lookups of an earlier generation finish without touching the new state
let generation = 0;

/** The dedupe key: the poster query of the title, case- and space-insensitive. */
export function posterKey(title: string): string {
  return posterQuery(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
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
      // a failed lookup (offline, blocked) is forgotten: a row shown later asks again
      if (!keep && entries[e.key] === e) delete entries[e.key];
      for (let i = 0; i < w.length; i++) w[i](url);
      pump();
    };
    let p: Promise<string>;
    try {
      p = lookup(e.query, e.year);
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
 * nobody waits for any more leaves the queue before it starts.
 */
export function requestPoster(title: string, done: (url: string) => void): () => void {
  const query = posterQuery(title || '');
  const key = posterKey(title);
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
    const y = yearOf((title || '').replace(/[._]+/g, ' '));
    e = { key, query, year: y ? +y : 0, state: 'queued', url: '', waiters: [] };
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

/** A fake lookup for tests (null restores the catalog one); also forgets every poster found so far. */
export function setPosterLookupForTests(fn: PosterLookup | null): void {
  lookup = fn || catalogLookup;
  entries = {};
  queue = [];
  running = 0;
  generation++;
}
