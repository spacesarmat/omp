import { describe, it, expect } from 'vitest';
import { categoryOf, mapSearchCategory, categoryTabs } from '../../src/lib/category';

describe('categoryOf', () => {
  it('maps TorrServer categories', () => {
    expect(categoryOf('movie')).toBe('movie');
    expect(categoryOf('tv')).toBe('tv');
    expect(categoryOf('music')).toBe('music');
    expect(categoryOf('audiobook')).toBe('audiobook');
    expect(categoryOf('')).toBe('other');
    expect(categoryOf(undefined)).toBe('other');
    expect(categoryOf('anime')).toBe('other');
  });
});

describe('mapSearchCategory', () => {
  it('maps search result categories', () => {
    expect(mapSearchCategory('Movie')).toBe('movie');
    expect(mapSearchCategory('TV')).toBe('tv');
    expect(mapSearchCategory('Series')).toBe('tv');
    expect(mapSearchCategory('Music')).toBe('music');
    expect(mapSearchCategory('Audiobook')).toBe('audiobook');
    expect(mapSearchCategory('Аудиокниги')).toBe('audiobook');
    expect(mapSearchCategory('')).toBe('');
  });
});

describe('categoryTabs', () => {
  it('starts with all and lists audiobooks before other', () => {
    expect(categoryTabs()[0].id).toBe('all');
    expect(categoryTabs().map((x) => x.id)).toEqual(['all', 'movie', 'tv', 'music', 'audiobook', 'other']);
  });
});
