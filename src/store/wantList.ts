// TV «Хочу посмотреть»: titles saved from «Обзор» and the title card. Lives on the TV only for now (a later version
// hands it to the phone's monitoring). Newest first, at most WANT_MAX items; bad storage is ignored.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { t } from '../i18n';
import { toast } from '../ui/toast';
import type { CatalogTitle, Kind } from '../catalog/tmdb';

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

/** Toggle with the toast on add. */
export function wantAction(x: CatalogTitle): boolean {
  const on = toggleWant(x);
  toast(on ? t('tv.want.added') + ' ' + t('tv.want.hint') : t('tv.want.removed'));
  return on;
}
