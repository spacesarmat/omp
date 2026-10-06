// «Обзор» tiles: the TMDB list answers carry no release dates, so the card of each VISIBLE tile is fetched (the
// client caches it), at most 2 at a time, one per title and language; the tile shows its date label once known.
// A failed fetch (offline) is not retried for a while.
import { signal } from '@preact/signals';
import { lang } from '../../../src/i18n';
import type { CatalogCard, Kind } from '../../../src/catalog/tmdb';
import { phoneCatalog } from './phoneCatalog';

const MAX_LOOKUPS = 2;
const RETRY_MS = 10 * 60 * 1000;

const cards = new Map<string, CatalogCard>();
const waiting: { key: string; kind: Kind; id: number }[] = [];
const pending = new Set<string>();
const failedAt = new Map<string, number>();
let running = 0;
let generation = 0;

/** Bumped when a tile card arrives: the tiles read `cachedTileCard` again. */
export const tileCardVersion = signal(0);

const keyOf = (kind: Kind, id: number) => lang.peek() + '|' + kind + ':' + id;

/** The card fetched before for a tile; undefined while unknown. */
export function cachedTileCard(kind: Kind, id: number): CatalogCard | undefined {
  return cards.get(keyOf(kind, id));
}

function pump(): void {
  while (running < MAX_LOOKUPS && waiting.length) {
    const job = waiting.shift()!;
    running++;
    const gen = generation;
    const done = (card: CatalogCard | null) => {
      if (gen !== generation) return;
      running--;
      pending.delete(job.key);
      if (card) cards.set(job.key, card);
      else failedAt.set(job.key, Date.now());
      tileCardVersion.value++;
      pump();
    };
    phoneCatalog()
      .then((c) => c.card(job.kind, job.id))
      .then(done, () => done(null));
  }
}

/** A tile came into view: fetch its card unless known, queued or failed lately. */
export function requestTileCard(kind: Kind, id: number): void {
  const key = keyOf(kind, id);
  if (cards.has(key) || pending.has(key)) return;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return;
  pending.add(key);
  waiting.push({ key, kind, id });
  pump();
}

/** Tests: forget every card and the queue. */
export function resetTileCards(): void {
  cards.clear();
  waiting.length = 0;
  pending.clear();
  failedAt.clear();
  running = 0;
  generation++;
}
