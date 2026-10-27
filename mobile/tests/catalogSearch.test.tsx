import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { CatalogResults, resetCatalogResults } from '../src/screens/catalog/CatalogSearch';
import { Discover } from '../src/screens/catalog/Discover';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const MOVIE: CatalogTitle = { kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026, poster: 'https://img.test/a.jpg', rating: 7.4 };
const SHOW: CatalogTitle = { kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 0, poster: '', rating: 0 };

type Search = CatalogClient['search'];

function fake(impl?: Search) {
  const search = vi.fn<Search>(impl || (() => Promise.resolve({ items: [MOVIE, SHOW], pages: 1 })));
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search,
    card: vi.fn(() => Promise.reject(new Error('x'))),
  });
  return search;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}
const trackers = vi.fn();
// the field belongs to the «Поиск» screen; this stands in for it
function Results() {
  const [q, setQ] = useState('');
  return (
    <>
      <input aria-label="Movie or series" placeholder="Movie or series" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <CatalogResults text={q} onTrackers={trackers} />
    </>
  );
}
const field = () => el.querySelector('input[aria-label="Movie or series"]') as HTMLInputElement;
function type(v: string) {
  act(() => {
    field().value = v;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  clearDiscover();
  resetCatalogResults();
  trackers.mockReset();
  applyLanguageSetting('en');
  vi.useFakeTimers();
  torrents.value = [];
  resetTo({ name: 'library' });
});

afterEach(() => {
  try {
    act(() => render(null, el));
    setCatalogClientForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  } finally {
    applyLanguageSetting('ru');
  }
});

describe('«Поиск» → «Каталог» results', () => {
  it('has a labelled field and searches 400 ms after typing stops, from 2 characters', async () => {
    const search = fake();
    mount(<Results />);
    type('m');
    expect(el.textContent).toContain('Type at least 2 letters');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(search).not.toHaveBeenCalled();
    type('mid');
    await act(async () => { vi.advanceTimersByTime(300); });
    type('midn');
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(search).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('midn', 1);
  });

  it('shows rows with poster, title, year · kind and rating, and opens the title', async () => {
    fake();
    mount(<Results />);
    type('midnight');
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    const rows = Array.from(el.querySelectorAll('button.m-srch-row')) as HTMLButtonElement[];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Midnight Archive');
    expect(rows[0].textContent).toContain('2026 · Movie');
    expect(rows[0].textContent).toContain('★ 7.4');
    const img = rows[0].querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(img.getAttribute('width')).toBe('64');
    expect(img.getAttribute('height')).toBe('92');
    expect(rows[1].textContent).toContain('Series');
    expect(rows[1].textContent).not.toContain('·');
    act(() => rows[0].click());
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'movie', id: 11 });
  });

  it('offers a tracker search for the query', async () => {
    fake();
    mount(<Results />);
    type('midnight');
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    expect(el.textContent).toContain('Need a specific release?');
    const link = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Search “midnight” on trackers'))!;
    expect(link).toBeTruthy();
    act(() => link.click());
    expect(trackers).toHaveBeenCalledWith('midnight');
  });

  it('says so when nothing is found', async () => {
    fake(() => Promise.resolve({ items: [], pages: 0 }));
    mount(<Results />);
    type('zzzz');
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    expect(el.textContent).toContain('Nothing found in the catalog');
  });

  it('shows the offline error with «Retry» that searches again', async () => {
    const search = fake(() => Promise.reject(new Error('offline')));
    mount(<Results />);
    type('midnight');
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    expect(el.querySelector('[role=alert]')!.textContent).toContain('Movie catalog unavailable');
    search.mockImplementation(() => Promise.resolve({ items: [MOVIE], pages: 1 }));
    act(() => (Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Retry') as HTMLButtonElement).click());
    await act(async () => { vi.advanceTimersByTime(0); });
    await flush();
    expect(search).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('Midnight Archive');
    // typing after a retry is debounced again
    type('midnight!');
    await act(async () => { vi.advanceTimersByTime(399); });
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(search).toHaveBeenCalledTimes(3);
  });
});

describe('Discover search entry', () => {
  it('the search icon opens «Поиск» on «Каталог»', async () => {
    fake();
    mount(<Discover />);
    await flush();
    act(() => (el.querySelector('button[aria-label="Search"]') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'add', scope: 'catalog' });
  });

  it('back from a title opened in the results: the same results, with no new request', async () => {
    const search = fake();
    mount(<CatalogResults text="midnight" onTrackers={trackers} />);
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    act(() => (el.querySelector('button.m-srch-row') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'movie', id: 11 });
    act(() => render(null, el));
    mount(<CatalogResults text="midnight" onTrackers={trackers} />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();
    expect(el.querySelectorAll('button.m-srch-row').length).toBe(2);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
