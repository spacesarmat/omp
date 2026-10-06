// TV «Хочу посмотреть»: titles saved from «Обзор» and the title card. The TV keeps its own list; adding a title also
// asks OMP on the phone (when linked) to watch for its releases. Newest first, at most WANT_MAX items; bad storage is
// ignored.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { t } from '../i18n';
import { toast } from '../ui/toast';
import { torrentQuery, type CatalogTitle, type Kind } from '../catalog/tmdb';
import { phoneLink } from '../phone/phoneStore';
import { phoneWantAdd } from '../phone/monitor';

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

/**
 * Toggle with a toast. Adding also hands the title to the phone (the same query as «Найти раздачи» of the card); the
 * toast waits for its answer. Removing touches only the TV list: the phone's subscription stays.
 */
export function wantAction(x: CatalogTitle): boolean {
  const on = toggleWant(x);
  if (!on) {
    toast(t('tv.want.removed'));
    return on;
  }
  const local = () => toast(t('tv.want.added') + ' ' + t('tv.want.connectPhone'));
  if (!phoneLink.value) {
    local();
    return on;
  }
  phoneWantAdd(torrentQuery(x)).then(() => toast(t('tv.want.addedPhone')), local);
  return on;
}
