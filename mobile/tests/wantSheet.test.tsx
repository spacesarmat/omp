import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { WantSheet } from '../src/screens/catalog/WantSheet';
import { TitleCard, wantQuery } from '../src/screens/catalog/TitleCard';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { toast } from '../src/ui/toast';
import { saveSearchFilters } from '../src/ui/FiltersSheet';
import { NO_FILTERS } from '../../src/sources/filters';
import { loadSubs } from '../../src/monitor/subs';
import type { CatalogCard } from '../../src/catalog/tmdb';

const FILM: CatalogCard = {
  kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026,
  poster: '', rating: 7.4, backdrop: '', genres: ['drama'], runtime: 118, overview: '', cast: [], seasons: [], airing: false,
};
const SHOW: CatalogCard = {
  kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 2024,
  poster: '', rating: 8, backdrop: '', genres: [], runtime: 50, overview: '', cast: [],
  seasons: [{ number: 1, episodes: 8, year: 2024, aired: 8 }], airing: true,
};

let el: HTMLElement;
let closed = 0;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}
const flush = () =>
  act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
const button = (text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;
const sheet = (card: CatalogCard) => mount(<WantSheet card={card} onClose={() => closed++} />);

beforeEach(() => {
  localStorage.clear();
  closed = 0;
  toast.value = '';
  applyLanguageSetting('en');
});
afterEach(() => {
  act(() => render(null, el));
  setCatalogClientForTests(null);
  applyLanguageSetting('ru');
});

describe('WantSheet', () => {
  it('describes what it will watch for', () => {
    sheet(FILM);
    expect(el.textContent).toContain('OMP will look for "Midnight Archive" (2026) on your sources and tell you in "New" when a torrent appears.');
    act(() => render(null, el));
    sheet(SHOW);
    expect(el.textContent).toContain('OMP will look for "Frost Pass" (2024) on your sources and tell you in "New" about new episodes.');
  });

  it('defaults the quality from the saved filters', () => {
    const chosen = () => Array.from(el.querySelectorAll('.m-chip.on')).map((c) => c.textContent);
    sheet(FILM);
    expect(chosen()).toEqual(['Any']);
    expect(['Any', '1080p', '4K'].every((l) => !!button(l))).toBe(true);
    act(() => render(null, el));
    saveSearchFilters({ ...NO_FILTERS, res: [720] });
    sheet(FILM);
    expect(chosen()).toEqual(['1080p']);
    act(() => render(null, el));
    saveSearchFilters({ ...NO_FILTERS, res: [1080, 2160] });
    sheet(FILM);
    expect(chosen()).toEqual(['1080p']);
    act(() => render(null, el));
    saveSearchFilters({ ...NO_FILTERS, res: [2160] });
    sheet(FILM);
    expect(chosen()).toEqual(['4K']);
  });

  it('subscribes with the chosen quality, toasts and closes', () => {
    sheet(FILM);
    act(() => button('4K')!.click());
    act(() => button('Subscribe')!.click());
    const subs = loadSubs();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ query: wantQuery(FILM), quality: '2160', sources: null, notify: true, better: true });
    expect(toast.value).toBe('Subscribed - see "New"');
    expect(closed).toBe(1);
  });

  it('the switch «Только лучшее качество» is on by default; switched off, the subscription has no better', () => {
    applyLanguageSetting('ru');
    const better = () => el.querySelector('[role=switch][aria-label="Только лучшее качество"]') as HTMLElement;
    sheet(FILM);
    expect(better().getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('сообщать, только когда качество выше прежних находок');
    act(() => button('Подписаться')!.click());
    expect(loadSubs()[0].better).toBe(true);
    localStorage.clear();
    act(() => render(null, el));
    sheet(FILM);
    act(() => better().click());
    expect(better().getAttribute('aria-checked')).toBe('false');
    act(() => button('Подписаться')!.click());
    expect(loadSubs()).toHaveLength(1);
    expect(loadSubs()[0].better).toBeUndefined();
  });

  it('the better-quality switch in English', () => {
    sheet(FILM);
    expect(el.querySelector('[role=switch][aria-label="Better quality only"]')).toBeTruthy();
    expect(el.textContent).toContain('only when the quality beats earlier finds');
  });

  it('cancels without subscribing', () => {
    sheet(FILM);
    act(() => button('Cancel')!.click());
    expect(loadSubs()).toHaveLength(0);
    expect(closed).toBe(1);
  });

  it('switches the card to "Following" without reopening it', async () => {
    setCatalogClientForTests({
      novelties: () => Promise.resolve({ items: [], pages: 0 }),
      discover: () => Promise.resolve({ items: [], pages: 0 }),
      search: () => Promise.resolve({ items: [], pages: 0 }),
      card: () => Promise.resolve(SHOW),
    });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    act(() => button('Want to watch')!.click());
    expect(el.querySelector('[role=dialog]')).toBeTruthy();
    act(() => button('Subscribe')!.click());
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(button('Following this series')).toBeTruthy();
    expect(button('Want to watch')).toBeUndefined();
  });
});
