import { describe, it, expect, afterEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useMovieCard } from '../../src/lib/useMovieCard';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import type { Torrent } from '../../src/api/types';

const item = (kind: 'tv' | 'movie', id: number, year: number) => ({ kind, id, title: 'x', original: 'x', year, poster: '', rating: 0 });
const search = vi.fn();
const card = vi.fn();
const stub: any = { search, card };

let seen: any = 'unset';
function Probe({ tor }: { tor?: Torrent }) {
  seen = useMovieCard(tor);
  return null;
}
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
let host: HTMLElement;
async function mount(tor?: Torrent) {
  host = document.createElement('div');
  act(() => render(h(Probe, { tor }), host));
  await flush();
}

afterEach(() => {
  act(() => render(null, host));
  setCatalogProvider(null);
  search.mockReset();
  card.mockReset();
  seen = 'unset';
});

describe('useMovieCard', () => {
  it('finds the film by the library title and year', async () => {
    setCatalogProvider(() => Promise.resolve(stub));
    search.mockResolvedValue({ items: [item('movie', 8, 2023)], pages: 1 });
    card.mockResolvedValue({ kind: 'movie', id: 8, cast: [] });
    await mount({ hash: 'mc1', title: 'Тихий сигнал / Quiet Signal (2023) BDRip 1080p', category: 'movie' } as Torrent);
    expect(search).toHaveBeenCalledWith('Тихий сигнал', 1);
    expect(seen).toEqual({ kind: 'movie', id: 8, cast: [] });
  });
  it('never asks for a series', async () => {
    setCatalogProvider(() => Promise.resolve(stub));
    await mount({ hash: 'mc2', title: 'Dark Matter S01 (2024) 1080p', category: 'tv' } as Torrent);
    expect(search).not.toHaveBeenCalled();
    expect(seen).toBeNull();
  });
  it('is null for a torrent without a year, or none at all', async () => {
    setCatalogProvider(() => Promise.resolve(stub));
    await mount({ hash: 'mc3', title: 'Some Film', category: 'movie' } as Torrent);
    expect(search).not.toHaveBeenCalled();
    expect(seen).toBeNull();
    await mount(undefined);
    expect(seen).toBeNull();
  });
  it('is null when TMDB is not reachable', async () => {
    setCatalogProvider(() => Promise.reject(new Error('catalog:nokey')));
    await mount({ hash: 'mc4', title: 'Quiet Signal (2021)', category: 'movie' } as Torrent);
    expect(seen).toBeNull();
  });
  it('remembers the card by hash', async () => {
    setCatalogProvider(() => Promise.resolve(stub));
    search.mockResolvedValue({ items: [item('movie', 9, 2022)], pages: 1 });
    card.mockResolvedValue({ kind: 'movie', id: 9, cast: [] });
    const tor = { hash: 'mc5', title: 'Quiet Hour (2022)', category: 'movie' } as Torrent;
    await mount(tor);
    act(() => render(null, host));
    search.mockClear();
    await mount(tor);
    expect(search).not.toHaveBeenCalled();
    expect(seen).toEqual({ kind: 'movie', id: 9, cast: [] });
  });
});
