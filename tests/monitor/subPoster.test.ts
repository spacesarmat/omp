import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addSubscription, loadSubs, removeSubscription, saveSubs } from '../../src/monitor/subs';
import { backfillSubPosters, installSubPosters, lookupSubPosterWith, queueSubPoster } from '../../src/monitor/subPoster';
import type { CatalogTitle } from '../../src/catalog/tmdb';
import type { Subscription } from '../../src/monitor/types';

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const sub = (query: string, catalog?: Subscription['catalog']): Subscription => ({
  id: 's',
  query,
  quality: '',
  sources: null,
  notify: true,
  createdAt: 1,
  catalog,
});

const hit = (id: number, title: string, year: number, poster: string): CatalogTitle => ({
  kind: 'movie', id, title, original: title, year, poster, rating: 1,
});

beforeEach(() => {
  localStorage.clear();
  installSubPosters(null);
});
afterEach(() => installSubPosters(null));

describe('lookupSubPosterWith', () => {
  it('uses the card posters, then the card itself, and an http link is not a poster', async () => {
    const card = { kind: 'movie' as const, id: 7, title: 'Дюна', year: 2021, poster: '' };
    const posters = vi.fn(() => Promise.resolve(['https://img.test/a.jpg']));
    expect(await lookupSubPosterWith({ posters, card: vi.fn(), search: vi.fn() } as never, sub('Дюна', card))).toEqual({ poster: 'https://img.test/a.jpg' });
    expect(posters).toHaveBeenCalledWith('movie', 7);

    const fromCard = vi.fn(() => Promise.resolve({ poster: 'https://img.test/b.jpg' }));
    expect(await lookupSubPosterWith({ posters: () => Promise.resolve([]), card: fromCard, search: vi.fn() } as never, sub('Дюна', card))).toEqual({ poster: 'https://img.test/b.jpg' });

    expect(await lookupSubPosterWith({
      posters: () => Promise.resolve(['http://insecure/a.jpg']),
      card: () => Promise.resolve({ poster: '' }),
      search: vi.fn(),
    } as never, sub('Дюна', card))).toEqual({ poster: '' });
  });

  it('a query matches the title and the year; a dated miss is empty, not a random title', async () => {
    const search = vi.fn(() => Promise.resolve({
      items: [
        hit(1, 'Другое', 2021, 'https://img.test/o.jpg'),
        hit(2, 'Дюна', 2021, 'https://img.test/d.jpg'),
        hit(3, 'Дюна', 1984, 'https://img.test/old.jpg'),
      ],
      pages: 1,
    }));
    const c = { search, posters: vi.fn(), card: vi.fn() } as never;
    expect(await lookupSubPosterWith(c, sub('Дюна 2021'))).toEqual({ poster: 'https://img.test/d.jpg' });
    expect(await lookupSubPosterWith(c, sub('Дюна 1999'))).toEqual({ poster: '' });
    expect(search).toHaveBeenCalled();
  });

  it('a season query still matches the show', async () => {
    const search = vi.fn(() => Promise.resolve({
      items: [{ kind: 'tv' as const, id: 9, title: 'Орбитальная станция', original: 'Orbit', year: 2024, poster: 'https://img.test/s.jpg', rating: 1 }],
      pages: 1,
    }));
    expect(await lookupSubPosterWith({ search, posters: vi.fn(), card: vi.fn() } as never, sub('Орбитальная станция 2 сезон'))).toEqual({ poster: 'https://img.test/s.jpg' });
  });

  it('a catalog error is a retry, not an empty poster', async () => {
    const card = { kind: 'tv' as const, id: 4, title: 'Шоу', year: 2024, poster: '' };
    expect(await lookupSubPosterWith({
      posters: () => Promise.reject(new Error('down')),
      card: () => Promise.reject(new Error('down')),
      search: vi.fn(),
    } as never, sub('Шоу', card))).toBeNull();
  });
});

describe('poster backfill', () => {
  it('stores a poster at add time when the lookup knows one, and fills an older row', async () => {
    installSubPosters(async (s) => ({ poster: s.query === 'Пусто' ? '' : 'https://img.test/new.jpg' }));
    addSubscription({ query: 'Дюна 2021', quality: '', sources: null, notify: true }, 1);
    await flush();
    expect(loadSubs()[0].poster).toBe('https://img.test/new.jpg');
    expect(loadSubs()[0].noPoster).toBeUndefined();

    saveSubs(loadSubs().concat([{ id: 'old', query: 'Старое', quality: '', sources: null, notify: true, createdAt: 2 }]));
    backfillSubPosters();
    await flush();
    expect(loadSubs().filter((s) => s.id === 'old')[0].poster).toBe('https://img.test/new.jpg');

    const miss = addSubscription({ query: 'Пусто', quality: '', sources: null, notify: true }, 3)!;
    await flush();
    const stored = loadSubs().filter((s) => s.id === miss.id)[0];
    expect(stored.noPoster).toBe(true);
    expect(stored.poster).toBeUndefined();
  });

  it('a failed lookup does not stick, so the next one can fill the poster', async () => {
    let fail = true;
    installSubPosters(async () => (fail ? null : { poster: 'https://img.test/ok.jpg' }));
    addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 1);
    await flush();
    expect(loadSubs()[0].poster).toBeUndefined();
    expect(loadSubs()[0].noPoster).toBeUndefined();
    fail = false;
    queueSubPoster(loadSubs()[0]);
    await flush();
    expect(loadSubs()[0].poster).toBe('https://img.test/ok.jpg');
  });

  it('does not replace a poster that was known when the subscription was added', async () => {
    const ask = vi.fn(async () => ({ poster: 'https://img.test/other.jpg' }));
    installSubPosters(ask);
    addSubscription({
      query: 'Дюна 2021',
      quality: '',
      sources: null,
      notify: true,
      catalog: { kind: 'movie', id: 7, title: 'Дюна', year: 2021, poster: 'https://img.test/card.jpg' },
    }, 1);
    await flush();
    expect(ask).not.toHaveBeenCalled();
    expect(loadSubs()[0].catalog!.poster).toBe('https://img.test/card.jpg');
    expect(loadSubs()[0].poster).toBeUndefined();
  });

  it('a subscription removed while the lookup runs is not written back', async () => {
    let go: (v: { poster: string }) => void = () => undefined;
    installSubPosters(() => new Promise((resolve) => { go = resolve; }));
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 1)!;
    removeSubscription(s.id);
    go({ poster: 'https://img.test/late.jpg' });
    await flush();
    expect(loadSubs()).toEqual([]);
  });
});
