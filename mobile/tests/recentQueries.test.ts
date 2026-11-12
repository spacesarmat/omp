import { describe, it, expect, beforeEach } from 'vitest';
import { loadRecentQueries, magnetInClipboard, rememberQuery } from '../src/lib/recentQueries';

beforeEach(() => localStorage.clear());

describe('recent source queries', () => {
  it('keeps the newest eight, drops duplicates, ignores blanks', () => {
    rememberQuery('  Дюна  ');
    rememberQuery('Реаль');
    rememberQuery('дюна');
    expect(loadRecentQueries()).toEqual(['дюна', 'Реаль']);
    for (let i = 0; i < 10; i++) rememberQuery('q' + i);
    expect(loadRecentQueries()).toHaveLength(8);
    expect(loadRecentQueries()[0]).toBe('q9');
  });

  it('reads a magnet or a hash from clipboard text', () => {
    const hash = 'ab'.repeat(20);
    expect(magnetInClipboard('  magnet:?xt=urn:btih:abc  ')).toBe('magnet:?xt=urn:btih:abc');
    expect(magnetInClipboard(hash)).toBe('magnet:?xt=urn:btih:' + hash);
    expect(magnetInClipboard('hello')).toBeNull();
    expect(magnetInClipboard('')).toBeNull();
  });
});
