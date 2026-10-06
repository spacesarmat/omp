import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { tileLabel, releaseParts, upcomingEpisodes, nextEpisodeSeasons, dayHeader, episodeCode } from '../src/lib/releaseDates';
import { TitleCard } from '../src/screens/catalog/TitleCard';
import { TileWhen } from '../src/screens/catalog/Discover';
import { resetTileCards } from '../src/catalog/tileCards';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetTo, navigate } from '../src/nav';
import { torrents } from '../../src/store/library';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogCard, SeasonDetails } from '../../src/catalog/tmdb';

// «today» is Tuesday 6 October 2026, noon local time
const NOW = new Date(2026, 9, 6, 12).getTime();

const FILM: CatalogCard = {
  kind: 'movie', id: 11, title: 'Полуночный архив', original: 'Midnight Archive', year: 2026, poster: '', rating: 7,
  backdrop: '', genres: [], runtime: 100, overview: '', cast: [], seasons: [], airing: false, releases: {},
};
const film = (releases: CatalogCard['releases']): CatalogCard => ({ ...FILM, releases });

const SHOW: CatalogCard = {
  kind: 'tv', id: 21, title: 'Ледяной перевал', original: 'Frost Pass', year: 2024, poster: '', rating: 8, backdrop: '',
  genres: [], runtime: 50, overview: '', cast: [], airing: true, status: 'returning', lastAirDate: '2026-10-01',
  seasons: [
    { number: 2, episodes: 8, year: 2026, aired: 4, airDate: '2026-09-10' },
    { number: 1, episodes: 8, year: 2024, aired: 8, airDate: '2024-03-01' },
  ],
  nextEpisode: { season: 2, episode: 5, airDate: '2026-10-08' },
};
const show = (patch: Partial<CatalogCard>): CatalogCard => ({ ...SHOW, ...patch });

function season(n: number, dates: string[]): SeasonDetails {
  return { number: n, name: '', airDate: '', overview: '', episodes: dates.map((d, i) => ({ n: i + 1, title: d ? 'Эпизод ' + (i + 1) : '', airDate: d, runtime: 0, overview: '' })) };
}

describe('tile labels', () => {
  it('films: a future digital date, else in cinemas within 60 days without a digital one, else nothing', () => {
    expect(tileLabel(film({ digital: '2026-11-12', theatrical: '2026-10-03' }), NOW)).toBe('в цифре 12 нояб.');
    expect(tileLabel(film({ theatrical: '2026-10-03' }), NOW)).toBe('в кино с 3 окт.');
    expect(tileLabel(film({ theatrical: '2026-08-08' }), NOW)).toBe('в кино с 8 авг.');
    // too long ago, already digital, not yet out, unknown
    expect(tileLabel(film({ theatrical: '2026-08-01' }), NOW)).toBe('');
    expect(tileLabel(film({ theatrical: '2026-09-01', digital: '2026-10-01' }), NOW)).toBe('');
    expect(tileLabel(film({ theatrical: '2026-12-01' }), NOW)).toBe('');
    expect(tileLabel(film({}), NOW)).toBe('');
    expect(tileLabel({ ...FILM, releases: undefined }, NOW)).toBe('');
    // the year is told when it is not this one
    expect(tileLabel(film({ digital: '2027-01-15' }), NOW)).toBe('в цифре 15 янв. 2027');
  });

  it('series: the next episode within 30 days, a season premiere as the season, else a future season', () => {
    expect(tileLabel(SHOW, NOW)).toBe('новая серия 8 окт.');
    expect(tileLabel(show({ nextEpisode: { season: 2, episode: 5, airDate: '2026-11-20' } }), NOW)).toBe('');
    const premiere = show({
      seasons: [{ number: 3, episodes: 8, year: 2026, aired: 0, airDate: '2026-10-20' }, ...SHOW.seasons],
      nextEpisode: { season: 3, episode: 1, airDate: '2026-10-20' },
    });
    expect(tileLabel(premiere, NOW)).toBe('3 сезон — 20 окт.');
    const later = show({ seasons: [{ number: 3, episodes: 8, year: 2026, aired: 0, airDate: '2026-11-15' }, ...SHOW.seasons], nextEpisode: null });
    expect(tileLabel(later, NOW)).toBe('3 сезон — 15 нояб.');
    expect(tileLabel(show({ nextEpisode: null }), NOW)).toBe('');
  });

  it('English', () => {
    applyLanguageSetting('en');
    expect(tileLabel(film({ digital: '2026-11-12' }), NOW)).toBe('digital Nov 12');
    expect(tileLabel(film({ theatrical: '2026-10-03' }), NOW)).toBe('in cinemas since Oct 3');
    expect(tileLabel(SHOW, NOW)).toBe('new episode Oct 8');
    expect(tileLabel(show({ seasons: [{ number: 3, episodes: 8, year: 2026, aired: 0, airDate: '2026-11-15' }], nextEpisode: null }), NOW)).toBe('season 3 — Nov 15');
  });
});

describe('card lines and helpers', () => {
  it('the film release line: known dates only, the ones to come marked', () => {
    expect(releaseParts(film({ theatrical: '2026-10-03', digital: '2026-11-12', physical: '2026-12-20' }), NOW)).toEqual([
      { text: 'Кино: 3 окт.', future: false },
      { text: 'Цифра: 12 нояб.', future: true },
      { text: 'Диск: 20 дек.', future: true },
    ]);
    expect(releaseParts(film({ digital: '2026-10-01' }), NOW)).toEqual([{ text: 'Цифра: 1 окт.', future: false }]);
    expect(releaseParts(film({}), NOW)).toEqual([]);
    expect(releaseParts(SHOW, NOW)).toEqual([]);
  });

  it('the next episodes: up to 3 dated from today, soonest first; the card next episode as a fallback', () => {
    const s2 = season(2, ['2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '', '2026-10-29']);
    expect(nextEpisodeSeasons(SHOW, NOW)).toEqual([2]);
    expect(upcomingEpisodes(SHOW, [s2], NOW)).toEqual([
      { season: 2, episode: 5, title: 'Эпизод 5', airDate: '2026-10-08' },
      { season: 2, episode: 6, title: 'Эпизод 6', airDate: '2026-10-15' },
      { season: 2, episode: 8, title: 'Эпизод 8', airDate: '2026-10-29' },
    ]);
    expect(upcomingEpisodes(SHOW, [], NOW)).toEqual([{ season: 2, episode: 5, title: '', airDate: '2026-10-08' }]);
    expect(upcomingEpisodes(show({ nextEpisode: null }), [], NOW)).toEqual([]);
    expect(nextEpisodeSeasons(show({ nextEpisode: null, seasons: [{ number: 3, episodes: 8, year: 2026, aired: 0, airDate: '2026-11-15' }] }), NOW)).toEqual([3]);
    expect(nextEpisodeSeasons(FILM, NOW)).toEqual([]);
  });

  it('day headers and episode codes', () => {
    expect(dayHeader('2026-10-06', NOW)).toBe('Сегодня');
    expect(dayHeader('2026-10-07', NOW)).toBe('Завтра');
    expect(dayHeader('2026-10-05', NOW)).toBe('Вчера');
    expect(dayHeader('2026-10-08', NOW)).toBe('Чт 8 окт.');
    expect(dayHeader('2026-10-03', NOW)).toBe('Сб 3 окт.');
    expect(episodeCode(2, 7)).toBe('S02E07');
    expect(episodeCode(12, 105)).toBe('S12E105');
    applyLanguageSetting('en');
    expect(dayHeader('2026-10-08', NOW)).toBe('Thu, Oct 8');
    expect(dayHeader('2026-10-06', NOW)).toBe('Today');
  });
});

// --- screens

let el: HTMLElement;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}
async function flush() {
  for (let r = 0; r < 3; r++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

function fake(card: CatalogClient['card'], seasonFn?: CatalogClient['season']) {
  const c = {
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(card),
    season: vi.fn(seasonFn || (() => Promise.reject(new Error('catalog:bad')))),
  };
  setCatalogClientForTests(c);
  return c;
}

let observers: { cb: IntersectionObserverCallback; el: Element | null }[] = [];
class FakeObserver {
  entry: { cb: IntersectionObserverCallback; el: Element | null };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, el: null };
    observers.push(this.entry);
  }
  observe(e: Element) { this.entry.el = e; }
  unobserve() { this.entry.el = null; }
  disconnect() { this.entry.el = null; }
  takeRecords() { return []; }
}

beforeEach(() => {
  localStorage.clear();
  torrents.value = [];
  observers = [];
  resetTileCards();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetTo({ name: 'library' });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  setCatalogClientForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('title card dates', () => {
  it('a film shows its release line, past dates plain and future ones accented', async () => {
    navigate({ name: 'title', kind: 'movie', id: 11 });
    fake(() => Promise.resolve(film({ theatrical: '2026-10-03', digital: '2026-11-12' })));
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    const line = el.querySelector('.m-tc-releases')!;
    expect(line.textContent).toBe('Кино: 3 окт. · Цифра: 12 нояб.');
    const parts = Array.from(line.querySelectorAll('[data-future]')).map((x) => x.textContent);
    expect(parts).toEqual(['Цифра: 12 нояб.']);
  });

  it('a film without known dates has no line', async () => {
    navigate({ name: 'title', kind: 'movie', id: 11 });
    fake(() => Promise.resolve(film({})));
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Полуночный архив');
    expect(el.querySelector('.m-tc-releases')).toBeNull();
  });

  it('a series lists «Ближайшие серии» from the next episode season', async () => {
    navigate({ name: 'title', kind: 'tv', id: 21 });
    const s2 = season(2, ['2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    const c = fake(() => Promise.resolve(SHOW), (_id, n) => Promise.resolve(n === 2 ? s2 : season(n, [])));
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(c.season).toHaveBeenCalledWith(21, 2);
    const next = el.querySelector('.m-tc-next')!;
    expect(next.querySelector('h2')!.textContent).toBe('Ближайшие серии');
    expect(Array.from(next.querySelectorAll('.m-tc-next-row')).map((r) => r.textContent)).toEqual([
      'S02E05 · Эпизод 58 окт.', 'S02E06 · Эпизод 615 окт.', 'S02E07 · Эпизод 722 окт.',
    ]);
  });

  it('a series with nothing to come has no such section', async () => {
    navigate({ name: 'title', kind: 'tv', id: 21 });
    fake(() => Promise.resolve(show({ nextEpisode: null, status: 'ended' })), (_id, n) => Promise.resolve(season(n, [])));
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Ледяной перевал');
    expect(el.querySelector('.m-tc-next')).toBeNull();
  });
});

describe('«Обзор» tile labels', () => {
  it('the card is fetched once the tile is in view, then the label shows', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const c = fake((kind) => Promise.resolve(kind === 'movie' ? film({ digital: '2026-11-12' }) : SHOW));
    mount(
      <div>
        <button class="m-disc-tile"><TileWhen kind="movie" id={11} /></button>
        <button class="m-disc-tile"><TileWhen kind="tv" id={21} /></button>
      </div>,
    );
    await flush();
    expect(c.card).not.toHaveBeenCalled();
    expect(Array.from(el.querySelectorAll('.m-disc-when')).map((x) => x.textContent)).toEqual(['', '']);
    await act(async () => {
      observers.forEach((o) => o.cb([{ isIntersecting: true, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    });
    await flush();
    expect(c.card).toHaveBeenCalledTimes(2);
    expect(Array.from(el.querySelectorAll('.m-disc-when')).map((x) => x.textContent)).toEqual(['в цифре 12 нояб.', 'новая серия 8 окт.']);
  });

  it('at most 2 cards are asked at a time', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const waiting: (() => void)[] = [];
    const c = fake(() => new Promise<CatalogCard>((res) => waiting.push(() => res(film({}))))) ;
    mount(
      <div>
        {[1, 2, 3, 4].map((id) => (
          <button key={id} class="m-disc-tile"><TileWhen kind="movie" id={id} /></button>
        ))}
      </div>,
    );
    await act(async () => {
      observers.forEach((o) => o.cb([{ isIntersecting: true, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    });
    await flush();
    expect(c.card).toHaveBeenCalledTimes(2);
    await act(async () => {
      waiting.splice(0).forEach((f) => f());
    });
    await flush();
    expect(c.card).toHaveBeenCalledTimes(4);
  });
});
