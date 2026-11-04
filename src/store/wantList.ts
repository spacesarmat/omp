// TV «Хочу посмотреть»: titles saved from «Обзор» and the title card. The TV keeps its own list; adding a title also
// asks OMP on the phone (when linked) to watch for its releases. Newest first, at most WANT_MAX items; bad storage is
// ignored.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { t } from '../i18n';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialog';
import { tvGlyphs } from '../ui/tvText';
import { torrentQuery, type CatalogTitle, type Kind } from '../catalog/tmdb';
import { phoneLink } from '../phone/phoneStore';
import { phoneSubRemoveQuery, phoneWantAdd } from '../phone/monitor';
import { PhoneRpcError } from '../phone/rpc';
import { sameQuery } from '../monitor/subs';

export const WANT_KEY = 'tsp.tvWant';
export const WANT_MAX = 500;

export interface WantItem {
  kind: Kind;
  id: number;
  title: string;
  year: number;
  poster: string;
  added: number;
}

export function sanitizeWant(v: unknown): WantItem[] {
  if (!Array.isArray(v)) return [];
  const out: WantItem[] = [];
  const seen: { [k: string]: boolean } = {};
  v.forEach((x) => {
    if (!isObject(x) || (x.kind !== 'movie' && x.kind !== 'tv') || typeof x.id !== 'number' || typeof x.title !== 'string') return;
    const key = x.kind + ':' + x.id;
    if (seen[key] || out.length >= WANT_MAX) return;
    seen[key] = true;
    out.push({
      kind: x.kind,
      id: x.id,
      title: x.title,
      year: typeof x.year === 'number' ? x.year : 0,
      poster: typeof x.poster === 'string' ? x.poster : '',
      added: typeof x.added === 'number' ? x.added : 0,
    });
  });
  return out;
}

export const wantList = signal<WantItem[]>(sanitizeWant(loadJson<unknown>(WANT_KEY, [], Array.isArray)));

export function reloadWant(): void {
  wantList.value = sanitizeWant(loadJson<unknown>(WANT_KEY, [], Array.isArray));
}

export function isWanted(kind: string, id: number): boolean {
  return wantList.value.some((w) => w.kind === kind && w.id === id);
}

/** Adds the title (newest first, the oldest drops off past the limit) or removes it. True when it is on the list now. */
export function toggleWant(x: { kind: Kind; id: number; title: string; year: number; poster: string }, now: number = Date.now()): boolean {
  const exists = isWanted(x.kind, x.id);
  wantList.value = exists
    ? wantList.value.filter((w) => !(w.kind === x.kind && w.id === x.id))
    : [{ kind: x.kind, id: x.id, title: x.title, year: x.year, poster: x.poster, added: now }].concat(wantList.value).slice(0, WANT_MAX);
  saveJson(WANT_KEY, wantList.value);
  return !exists;
}

/** The list as grid tiles. */
export function wantTitles(): CatalogTitle[] {
  return wantList.value.map((w) => ({ kind: w.kind, id: w.id, title: w.title, original: '', year: w.year, poster: w.poster, rating: 0 }));
}

function wantQuery(w: { kind: Kind; title: string; year: number }): string {
  return torrentQuery({ title: w.title, original: '', year: w.year, kind: w.kind });
}

/** Drops TV list rows whose search is this subscription query (the phone subscription was deleted). */
export function removeWantByQuery(query: string): void {
  const next = wantList.value.filter((w) => !sameQuery(wantQuery(w), query));
  if (next.length === wantList.value.length) return;
  wantList.value = next;
  saveJson(WANT_KEY, wantList.value);
}

/** The search the phone was given for this row: the year stored with it, not the year a later card happens to show. */
function savedQuery(saved: WantItem, x: CatalogTitle): string {
  return wantQuery(saved) || torrentQuery(x);
}

function addWant(x: CatalogTitle): boolean {
  const on = toggleWant(x);
  const query = torrentQuery(x);
  const local = () => toast(t('tv.want.added') + ' ' + t('tv.want.connectPhone'));
  if (!phoneLink.value) {
    local();
    return on;
  }
  phoneWantAdd(query, {
    kind: x.kind,
    id: x.id,
    title: x.title || x.original,
    year: x.year || 0,
    poster: x.poster || '',
  }).then(
    () => toast(t('tv.want.addedPhone')),
    (e) => {
      // the phone refused with its own words (e.g. the subscription cap without OMP): say so instead of «connect a phone»
      if (e instanceof PhoneRpcError && e.code === 'failed' && e.message) toast(t('tv.want.added') + ' ' + e.message);
      else local();
    },
  );
  return on;
}

/**
 * Drop the row and its phone subscription. The query is the one stored when the title was added: a film from
 * «Скоро в цифре» has no year, and the full card later does, so the card's query would miss the subscription.
 * Nothing changes until the phone agrees, so a failed call leaves both lists as they were.
 */
function dropWant(saved: WantItem, x: CatalogTitle): void {
  const query = savedQuery(saved, x);
  phoneSubRemoveQuery(query).then(
    () => {
      if (isWanted(x.kind, x.id)) toggleWant(saved);
      toast(t('tv.want.removedPhone'));
    },
    () => toast(t('tv.want.removeFailed')),
  );
}

/**
 * Toggle with a toast. Adding hands the title to the phone (the same query as «Найти раздачи», plus the card so the
 * subscription keeps its poster). Removing a linked phone's subscription also deletes its saved findings, so that
 * asks first and leaves both lists alone until the answer is yes. With no phone, only this TV list changes.
 * True when the title is on the list when this returns (a removal that is still asking counts as on the list).
 */
export function wantAction(x: CatalogTitle): boolean {
  const saved = wantList.value.filter((w) => w.kind === x.kind && w.id === x.id)[0];
  if (!saved) return addWant(x);
  if (!phoneLink.value) {
    toggleWant(x);
    toast(t('tv.want.removed'));
    return false;
  }
  const name = tvGlyphs(saved.title || x.title || x.original);
  confirmDialog(t('tv.want.removeAsk', { name: name }), t('tv.want.removeConfirm'), 'want-remove').then((ok) => {
    if (!ok || !isWanted(x.kind, x.id)) return;
    dropWant(saved, x);
  });
  return true;
}
