import { describe, it, expect } from 'vitest';
import { filterTorrents, sortTorrents, nextSort, sortLabel, SORT_OPTIONS } from '../../src/lib/librarySearch';
import type { Torrent } from '../../src/api/types';

const t = (hash: string, title: string, size = 0, ts = 0): Torrent => ({ hash, title, stat: 5, torrent_size: size, timestamp: ts });
const list = [t('a', 'Star.Trek.Strange.New.Worlds.S04', 30, 3), t('b', 'Ёлки 2', 10, 1), t('c', 'The Ark S03', 20, 2)];

describe('filterTorrents', () => {
  it('matches all words ignoring case, dots and ё', () => {
    expect(filterTorrents(list, 'star trek').map((x) => x.hash)).toEqual(['a']);
    expect(filterTorrents(list, 'елки').map((x) => x.hash)).toEqual(['b']);
    expect(filterTorrents(list, 'ark s03').map((x) => x.hash)).toEqual(['c']);
    expect(filterTorrents(list, 'ark star')).toEqual([]);
    expect(filterTorrents(list, '  ')).toBe(list);
  });
});

describe('sortTorrents', () => {
  it('sorts by mode without mutating', () => {
    expect(sortTorrents(list, 'new').map((x) => x.hash)).toEqual(['a', 'c', 'b']);
    expect(sortTorrents(list, 'title').map((x) => x.hash)).toEqual(['a', 'c', 'b']);
    expect(sortTorrents(list, 'size').map((x) => x.hash)).toEqual(['a', 'c', 'b']);
    expect(sortTorrents([t('x', 'B', 1, 1), t('y', 'a', 2, 2)], 'title').map((x) => x.hash)).toEqual(['y', 'x']);
    expect(list.map((x) => x.hash)).toEqual(['a', 'b', 'c']);
  });
  it('cycles modes and labels them', () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['new', 'title', 'size']);
    expect(nextSort('new')).toBe('title');
    expect(nextSort('size')).toBe('new');
    expect(sortLabel('title')).toBe('По названию');
  });
});
