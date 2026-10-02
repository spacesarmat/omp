import { describe, it, expect, beforeEach } from 'vitest';
import { favorites, isFavorite, toggleFavorite, sanitizeFavorites, reloadFavorites } from '../../src/store/favorites';

beforeEach(() => { localStorage.clear(); reloadFavorites(); });

describe('favorites', () => {
  it('toggles, keeps newest first and persists', () => {
    expect(toggleFavorite('http://a/1.m3u', 'A')).toBe(true);
    expect(toggleFavorite('http://b/2.m3u', 'B')).toBe(true);
    expect(favorites.value.map((f) => f.title)).toEqual(['B', 'A']);
    expect(isFavorite('http://a/1.m3u')).toBe(true);
    reloadFavorites();
    expect(favorites.value).toHaveLength(2);
    expect(toggleFavorite('http://a/1.m3u', 'A')).toBe(false);
    expect(isFavorite('http://a/1.m3u')).toBe(false);
    expect(favorites.value.map((f) => f.title)).toEqual(['B']);
  });
  it('sanitizes', () => {
    expect(sanitizeFavorites([{ url: 'u', title: 't' }, { url: 1 }, null, 'x'])).toEqual([{ url: 'u', title: 't' }]);
    expect(sanitizeFavorites({})).toEqual([]);
  });
});
