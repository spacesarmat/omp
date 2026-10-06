import { describe, it, expect, beforeEach } from 'vitest';
import { wantList, toggleWant, isWanted, reloadWant, sanitizeWant, WANT_KEY, WANT_MAX } from '../../src/store/wantList';

const item = (id: number, kind: 'movie' | 'tv' = 'movie') => ({ kind, id, title: 'T' + id, year: 2020, poster: '' });

beforeEach(() => {
  localStorage.clear();
  wantList.value = [];
});

describe('wantList', () => {
  it('toggles, keeps newest first and persists', () => {
    expect(toggleWant(item(1), 1)).toBe(true);
    expect(toggleWant(item(2, 'tv'), 2)).toBe(true);
    expect(wantList.value.map((w) => w.id)).toEqual([2, 1]);
    expect(isWanted('tv', 2)).toBe(true);
    expect(isWanted('movie', 2)).toBe(false);
    reloadWant();
    expect(wantList.value).toHaveLength(2);
    expect(toggleWant(item(1), 3)).toBe(false);
    expect(wantList.value.map((w) => w.id)).toEqual([2]);
    expect(JSON.parse(localStorage.getItem(WANT_KEY)!)).toHaveLength(1);
  });

  it('keeps at most 500, dropping the oldest', () => {
    for (let i = 0; i < WANT_MAX + 5; i++) toggleWant(item(i), i);
    expect(wantList.value).toHaveLength(WANT_MAX);
    expect(wantList.value[0].id).toBe(WANT_MAX + 4);
    expect(isWanted('movie', 0)).toBe(false);
  });

  it('ignores bad JSON and bad entries', () => {
    localStorage.setItem(WANT_KEY, '{oops');
    reloadWant();
    expect(wantList.value).toEqual([]);
    expect(sanitizeWant([{ kind: 'movie', id: 1, title: 'a' }, { kind: 'x', id: 2, title: 'b' }, null, { kind: 'tv', id: 1, title: 'c' }, { kind: 'movie', id: 1, title: 'dup' }]))
      .toEqual([{ kind: 'movie', id: 1, title: 'a', year: 0, poster: '', added: 0 }, { kind: 'tv', id: 1, title: 'c', year: 0, poster: '', added: 0 }]);
    expect(sanitizeWant({})).toEqual([]);
  });
});
