import { describe, it, expect } from 'vitest';
import { categoryOf, mapSearchCategory, CATEGORY_TABS } from '../../src/lib/category';

describe('categoryOf', () => {
  it('maps TorrServer categories', () => {
    expect(categoryOf('movie')).toBe('movie');
    expect(categoryOf('tv')).toBe('tv');
    expect(categoryOf('music')).toBe('music');
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
    expect(mapSearchCategory('')).toBe('');
  });
});

describe('CATEGORY_TABS', () => {
  it('starts with all', () => expect(CATEGORY_TABS[0].id).toBe('all'));
});
