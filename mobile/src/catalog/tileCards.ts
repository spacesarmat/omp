// «Обзор» tiles: the TMDB list answers carry no release dates, so the card of each VISIBLE tile is fetched, at most
// 2 at a time, the latest tile to come into view first (a fling does not make the tiles on screen wait behind the ones
// scrolled past); a tile that leaves the view before its turn is dropped from the queue, and leaving «Обзор» clears it.
// The cards stay out of the shared TMDB cache: only a small projection for the date label is kept here, bounded.
// A failed fetch (offline) is not retried for a while.
import { signal } from '@preact/signals';
import { lang } from '../../../src/i18n';
import type { CatalogCard, Kind } from '../../../src/catalog/tmdb';
import { phoneCatalog } from './phoneCatalog';

const MAX_LOOKUPS = 2;
const RETRY_MS = 10 * 60 * 1000;
/** Queued tiles at most (the oldest go first). */
const MAX_WAITING = 24;
/** Projections kept at most (the oldest go first). */
const MAX_CARDS = 300;

/** A card with only what a tile label needs (no overview, cast or images). */
export type TileCard = CatalogCard;

const cards = new Map<string, TileCard>();
let waiting: { key: string; kind: Kind; id: number }[] = [];
const visible = new Set<string>();
const pending = new Set<string>();
const failedAt = new Map<string, number>();
let running = 0;
let generation = 0;

/** Bumped when a tile card arrives: the tiles read `cachedTileCard` again. */
export const tileCardVersion = signal(0);

const keyOf = (kind: Kind, id: number) => lang.peek() + '|' + kind + ':' + id;

/** The projection kept for a tile; undefined while unknown. */
export function cachedTileCard(kind: Kind, id: number): TileCard | undefined {
  return cards.get(keyOf(kind, id));
}

function slim(c: CatalogCard): TileCard {
  return {
    kind: c.kind, id: c.id, title: c.title, original: c.original, year: c.year, poster: '', rating: c.rating,
    backdrop: '', genres: [], runtime: 0, overview: '', cast: [], airing: c.airing,
    seasons: c.seasons.map((s) => ({ number: s.number, episodes: s.episodes, year: s.year, aired: s.aired, airDate: s.airDate })),
    releases: c.releases, nextEpisode: c.nextEpisode, status: c.status,
  };
}

function keep(key: string, c: CatalogCard): void {
  cards.delete(key);
  cards.set(key, slim(c));
  while (cards.size > MAX_CARDS) {
    const first = cards.keys().next();
    if (first.done) break;
    cards.delete(first.value);
  }
}

function pump(): void {
  while (running < MAX_LOOKUPS && waiting.length) {
    // the latest tile to come into view first; one no longer in view is dropped
    const job = waiting.pop()!;
    if (!visible.has(job.key)) {
      pending.delete(job.key);
      continue;
    }
    running++;
    const gen = generation;
    const done = (card: CatalogCard | null) => {
      if (gen !== generation) return;
      running--;
      pending.delete(job.key);
      if (card) keep(job.key, card);
      else failedAt.set(job.key, Date.now());
      tileCardVersion.value++;
      pump();
    };
    phoneCatalog()
      .then((c) => c.card(job.kind, job.id, { store: false }))
      .then(done, () => done(null));
  }
}

/** A tile came into view: fetch its card unless known, queued or failed lately. */
export function requestTileCard(kind: Kind, id: number): void {
  const key = keyOf(kind, id);
  visible.add(key);
  if (cards.has(key) || pending.has(key)) return;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return;
  pending.add(key);
  waiting.push({ key, kind, id });
  while (waiting.length > MAX_WAITING) pending.delete(waiting.shift()!.key);
  pump();
}

/** A tile left the view: its queued fetch (if any) is dropped. */
export function leaveTileCard(kind: Kind, id: number): void {
  const key = keyOf(kind, id);
  visible.delete(key);
  const before = waiting.length;
  waiting = waiting.filter((j) => j.key !== key);
  if (waiting.length !== before) pending.delete(key);
}

/** «Обзор» was left: nothing queued is fetched any more (the running ones finish). */
export function cancelTileCards(): void {
  waiting.forEach((j) => pending.delete(j.key));
  waiting = [];
  visible.clear();
}

/** Tests: forget every card and the queue. */
export function resetTileCards(): void {
  cards.clear();
  waiting = [];
  visible.clear();
  pending.clear();
  failedAt.clear();
  running = 0;
  generation++;
}
