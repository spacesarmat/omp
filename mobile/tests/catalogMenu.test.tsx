import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CatalogMenu } from '../src/share/CatalogMenu';
import { currentRoute, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import { seriesKey } from '../../src/lib/seriesGroups';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import type { CatalogTitle } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

const show: CatalogTitle = { kind: 'tv', id: 1, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 0 };
const film: CatalogTitle = { kind: 'movie', id: 2, title: 'Дюна: Часть вторая', original: 'Dune: Part Two', year: 2024, poster: '', rating: 0 };

let el: HTMLElement;

function mount(item: CatalogTitle) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<CatalogMenu item={item} onClose={() => undefined} />, el));
}

beforeEach(() => {
  torrents.value = [];
  resetTo({ name: 'library' });
});

afterEach(() => {
  act(() => render(null, el));
});

describe('catalog poster menu', () => {
  it('names the release the mark points at and offers to correct the show', async () => {
    const tor = { hash: 'a', title: 'Тёмная материя / Dark Matter (2 сезон) 2026 WEB-DL' } as Torrent;
    torrents.value = [tor];
    const bad = () => Promise.reject(new Error('unused here'));
    setCatalogClientForTests({
      novelties: bad,
      discover: bad,
      person: bad,
      season: bad,
      posters: bad,
      similar: async () => [],
      card: bad,
      search: async () => ({ items: [{ kind: 'tv', id: 77, title: 'Другая тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 0 }], pages: 1 }),
    } as unknown as Parameters<typeof setCatalogClientForTests>[0]);
    mount(show);
    const sub = el.querySelector('[data-library-release]');
    expect(sub && sub.textContent).toContain('Тёмная материя');
    const fix = el.querySelector('[data-catalog-wrong]') as HTMLButtonElement;
    expect(fix).toBeTruthy();
    act(() => fix.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(el.textContent).toContain('Другая тёмная материя');
    setCatalogClientForTests(null);
    resetSeriesMatches();
  });

  it('opens the series page for a later season whose year is not the show year', () => {
    const tor = { hash: 'a', title: 'Тёмная материя / Dark Matter (2 сезон) 2026 WEB-DL' } as Torrent;
    torrents.value = [tor];
    mount(show);
    const button = el.querySelector('[data-catalog-action="library"]') as HTMLButtonElement;
    expect(button.textContent).toContain('В медиатеке');
    act(() => button.click());
    expect(currentRoute.value).toEqual({ name: 'series', key: seriesKey(tor), season: 2 });
  });

  it('opens the torrent of a film and hides the library action when nothing matches', () => {
    const tor = { hash: 'b', title: 'Дюна: Часть вторая / Dune: Part Two (2024) 2160p' } as Torrent;
    torrents.value = [tor];
    mount(film);
    act(() => (el.querySelector('[data-catalog-action="library"]') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'b' });
    torrents.value = [];
    mount(film);
    expect(el.querySelector('[data-catalog-action="library"]')).toBeNull();
  });
});
