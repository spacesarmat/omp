import { describe, it, expect, vi } from 'vitest';
import { findMovie } from '../../src/lib/tmdbMovie';
import type { CatalogClient } from '../../src/catalog/client';

const item = (kind: 'tv' | 'movie', id: number, year: number) => ({ kind, id, title: 'x', original: 'x', year, poster: '', rating: 0 });
const client = (items: ReturnType<typeof item>[] | Error) => {
  const card = vi.fn(async (kind: string, id: number) => ({ kind, id }));
  const search = vi.fn(() => (items instanceof Error ? Promise.reject(items) : Promise.resolve({ items, pages: 1 })));
  return { c: { search, card } as unknown as CatalogClient, card, search };
};

describe('findMovie', () => {
  it('takes the film of the year, not the series', async () => {
    const { c, card } = client([item('tv', 1, 2024), item('movie', 2, 2023), item('movie', 3, 2024)]);
    await findMovie(c, 'Dune', 2024);
    expect(card).toHaveBeenCalledWith('movie', 3);
  });
  it('accepts a year off by one when none is exact', async () => {
    const { c, card } = client([item('movie', 2, 2023)]);
    await findMovie(c, 'Dune off', 2024);
    expect(card).toHaveBeenCalledWith('movie', 2);
  });
  it('is null without a film', async () => {
    const { c, card } = client([item('tv', 1, 2024)]);
    expect(await findMovie(c, 'Only show', 2024)).toBeNull();
    expect(card).not.toHaveBeenCalled();
  });
  it('is null when the search fails, and tries again next time', async () => {
    const { c } = client(new Error('down'));
    expect(await findMovie(c, 'Down', 2024)).toBeNull();
    const ok = client([item('movie', 5, 2024)]);
    expect(await findMovie(ok.c, 'Down', 2024)).toEqual({ kind: 'movie', id: 5 });
  });
  it('asks once per title and year', async () => {
    const { c, search } = client([item('movie', 7, 2020)]);
    await findMovie(c, 'Cached', 2020);
    await findMovie(c, 'Cached', 2020);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
