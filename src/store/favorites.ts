import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';

export interface FavoritePlaylist {
  url: string;
  title: string;
}

const KEY = 'tsp.playlists';

export function sanitizeFavorites(v: unknown): FavoritePlaylist[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is FavoritePlaylist => isObject(f) && typeof f.url === 'string' && typeof f.title === 'string')
    .map((f) => ({ url: f.url, title: f.title }));
}

export const favorites = signal<FavoritePlaylist[]>(sanitizeFavorites(loadJson<unknown>(KEY, [], Array.isArray)));

export function reloadFavorites(): void {
  favorites.value = sanitizeFavorites(loadJson<unknown>(KEY, [], Array.isArray));
}

export function isFavorite(url: string): boolean {
  return favorites.value.some((f) => f.url === url);
}

export function toggleFavorite(url: string, title: string): boolean {
  const exists = isFavorite(url);
  favorites.value = exists ? favorites.value.filter((f) => f.url !== url) : [{ url, title }].concat(favorites.value);
  saveJson(KEY, favorites.value);
  return !exists;
}
