// Posters for monitoring subscriptions. A card that already has an https poster keeps it. Everything else
// (a season reminder, a typed search, a magnet title used as the query, «Хочу» from the TV) is looked up
// once: by TMDB id when the card is known, otherwise by the query. A failure is not remembered, so the next
// open tries again. Chromium 53 safe.
import { activeCatalog } from '../catalog/activeCatalog';
import type { CatalogClient } from '../catalog/client';
import type { CatalogTitle } from '../catalog/tmdb';
import { normTitle, posterQuery } from '../lib/posterSearch';
import { yearOf } from '../lib/torrentName';
import {
  getSubscription,
  loadSubs,
  needsSubPoster,
  sameQuery,
  setSubscriptionAddedHook,
  setSubscriptionPoster,
  subscriptionPoster,
} from './subs';
import type { Subscription } from './types';

/** Two lookups at a time, so opening «Подписки» does not flood TMDB. */
const MAX_RUNNING = 2;

export type SubPosterLookup = (sub: Subscription) => Promise<{ poster: string } | null>;

type PosterClient = Pick<CatalogClient, 'search' | 'card' | 'posters'>;

let lookup: SubPosterLookup | null = null;
let onChanged: (() => void) | null = null;
const waiting: Subscription[] = [];
const running: { [id: string]: boolean } = {};
let active = 0;

function httpsPoster(v: string): string {
  return /^https:\/\/\S+$/.test(v) ? v.slice(0, 500) : '';
}

/** The result is this title: equal, or one name starts with the other (a season query still names the show). */
function named(item: CatalogTitle, query: string): boolean {
  const q = normTitle(query);
  if (q.length < 2) return false;
  const titles = [normTitle(item.title), normTitle(item.original)];
  for (let i = 0; i < titles.length; i++) {
    const n = titles[i];
    if (n.length < 2) continue;
    if (n === q || q.indexOf(n) === 0 || n.indexOf(q) === 0) return true;
  }
  return false;
}

/**
 * One lookup. `{ poster: '' }` means the catalog was asked and has nothing (remember that).
 * `null` means the catalog could not be asked (try again later).
 */
export function lookupSubPosterWith(c: PosterClient, sub: Subscription): Promise<{ poster: string } | null> {
  const cat = sub.catalog;
  if (cat && cat.id > 0) {
    const fromCard = (): Promise<{ poster: string } | null> => {
      let p: Promise<{ poster: string } | null>;
      try {
        p = c.card(cat.kind, cat.id).then(
          (card) => ({ poster: httpsPoster((card && card.poster) || '') }),
          () => null,
        );
      } catch (e) {
        p = Promise.resolve(null);
      }
      return p;
    };
    let listed: Promise<{ poster: string } | null>;
    try {
      listed = c.posters(cat.kind, cat.id).then(
        (urls) => {
          const list = urls || [];
          for (let i = 0; i < list.length; i++) {
            const url = httpsPoster(list[i] || '');
            if (url) return { poster: url };
          }
          return fromCard();
        },
        () => fromCard(),
      );
    } catch (e) {
      listed = fromCard();
    }
    return listed;
  }
  const name = posterQuery(sub.query) || (sub.query || '').replace(/\s+/g, ' ').trim();
  if (!name) return Promise.resolve({ poster: '' });
  const yearText = yearOf(sub.query);
  const year = yearText ? +yearText : 0;
  let search: Promise<{ poster: string } | null>;
  try {
    search = c.search(name, 1).then(
      (r) => {
        const items = (r.items || []).filter((x) => !!httpsPoster(x.poster) && named(x, name));
        if (!items.length) return { poster: '' };
        let hit = items[0];
        if (year) {
          const same = items.filter((x) => x.year === year)[0];
          const near = items.filter((x) => Math.abs(x.year - year) === 1)[0];
          hit = same || near;
        }
        return { poster: hit ? httpsPoster(hit.poster) : '' };
      },
      () => null,
    );
  } catch (e) {
    search = Promise.resolve(null);
  }
  return search;
}

/** The app's catalog (phoneCatalog registers it). A missing catalog is a retry, not "no poster". */
export function lookupSubPoster(sub: Subscription): Promise<{ poster: string } | null> {
  return activeCatalog().then(
    (c) => lookupSubPosterWith(c, sub),
    () => null,
  );
}

/** The lookup was for this title. An edit (a new query, or another card) must not keep this answer. */
function samePosterSubject(a: Subscription, b: Subscription): boolean {
  if (!sameQuery(a.query, b.query)) return false;
  const ac = a.catalog;
  const bc = b.catalog;
  if (!ac && !bc) return true;
  if (!ac || !bc) return false;
  return ac.kind === bc.kind && ac.id === bc.id;
}

function pump(): void {
  if (!lookup) return;
  while (active < MAX_RUNNING && waiting.length) {
    const sub = waiting.shift();
    if (!sub) break;
    const current = getSubscription(sub.id);
    if (!current || !needsSubPoster(current) || running[current.id]) continue;
    running[current.id] = true;
    active++;
    const id = current.id;
    const subject = current;
    const ask = lookup;
    let p: Promise<{ poster: string } | null>;
    try {
      p = ask(subject);
    } catch (e) {
      p = Promise.reject(e);
    }
    const finish = (hit: { poster: string } | null) => {
      delete running[id];
      active--;
      const now = getSubscription(id);
      // the person edited the subscription while TMDB was answering: drop that answer and look up the new title
      if (now && !samePosterSubject(subject, now)) {
        if (needsSubPoster(now)) queueSubPoster(now);
        else pump();
        return;
      }
      if (hit && now) {
        const saved = setSubscriptionPoster(id, hit.poster);
        if (saved && onChanged) {
          const changed = subscriptionPoster(saved) !== subscriptionPoster(now) || saved.noPoster !== now.noPoster;
          if (changed) onChanged();
        }
      }
      pump();
    };
    p.then(finish, () => finish(null));
  }
}

/** Queues one subscription. No-op when a poster is already stored, a lookup said none exists, or one is running. */
export function queueSubPoster(sub: Subscription): void {
  if (!lookup || !needsSubPoster(sub) || running[sub.id]) return;
  for (let i = 0; i < waiting.length; i++) if (waiting[i].id === sub.id) return;
  waiting.push(sub);
  pump();
}

/** Every saved subscription that still has no poster. Safe to call again: finished ones are skipped. */
export function backfillSubPosters(): void {
  if (!lookup) return;
  const list = loadSubs();
  for (let i = 0; i < list.length; i++) queueSubPoster(list[i]);
}

/**
 * Turns the lookup on (`null` stops it). `changed` runs after a poster is stored, so the screen redraws.
 * Also fills subscriptions that were saved before this build.
 */
export function installSubPosters(next: SubPosterLookup | null, changed?: (() => void) | null): void {
  lookup = next;
  onChanged = changed || null;
  waiting.length = 0;
  setSubscriptionAddedHook(next ? (s) => queueSubPoster(s) : null);
  if (next) backfillSubPosters();
}
