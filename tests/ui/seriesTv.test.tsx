import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/progress', async (orig) => ({
  ...(await orig<typeof import('../../src/store/progress')>()),
  markWatched: vi.fn(),
}));

import { SeriesScreen } from '../../src/screens/Series';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { dispatchKey } from '../../src/ui/keys';
import { markWatched, saveProgress } from '../../src/store/progress';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesKey } from '../../src/lib/seriesGroups';

const files = (n: number) =>
  [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S0' + n + 'E0' + e + '.1080p.mkv', length: 2e9 }));
const season = (n: number) => ({
  hash: 's' + n,
  title: 'Тёмная материя / Dark Matter / Сезон: ' + n + ' / Серии: 1-2 из 9 (2024) WEB-DL 1080p',
  category: 'tv',
  timestamp: n,
  torrent_size: 4e9,
  file_stats: files(n),
});
const fixture = [
  season(1),
  season(2),
  { hash: 'f1', title: 'Quiet Signal (2024) 2160p', category: 'movie', timestamp: 9, file_stats: [{ id: 1, path: 'Quiet.Signal.2024.mkv', length: 1 }] },
];

const card = {
  id: 1,
  kind: 'tv',
  title: 'Тёмная материя',
  original: 'Dark Matter',
  year: 2024,
  poster: '',
  rating: 7.6,
  backdrop: 'http://img/backdrop.jpg',
  genres: ['фантастика'],
  runtime: 50,
  overview: 'Обзор сериала',
  cast: [],
  airing: true,
  status: 'returning',
  seasons: [
    { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
    { number: 2, episodes: 10, year: 2026, aired: 2, airDate: '2026-01-01' },
    { number: 3, episodes: 0, year: 2099, aired: 0, airDate: '2099-01-01' },
  ],
  // the pill reads «Выходит» only with a next episode: without one, the future season 3 makes it «Скоро новый сезон»
  nextEpisode: { season: 3, episode: 1, airDate: '2099-01-01' },
};
const stub: any = {
  search: () => Promise.resolve({ items: [{ id: 1, kind: 'tv', title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
  card: () => Promise.resolve(card),
  season: (_id: number, n: number) =>
    Promise.resolve({
      number: n,
      name: '',
      airDate: '',
      overview: '',
      episodes: [
        { n: 1, title: 'Пилот', airDate: '2024-05-08', runtime: 50, overview: '' },
        { n: 2, title: 'Второй', airDate: '2024-05-15', runtime: 50, overview: '' },
      ],
    }),
};

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let key = '';
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  resetLibrary();
  resetSeriesMatches();
  resetEpisodeNames();
  setCatalogProvider(() => Promise.resolve(stub));
  torrents.value = fixture as any;
  key = seriesKey(fixture[0] as any);
  routeStack.value = [{ name: 'library' }, { name: 'series', key }];
  (markWatched as any).mockClear();
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setCatalogProvider(null);
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};

async function mount(season?: number) {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h(SeriesScreen, { seriesKey: key, season }), host); });
  await flush();
  return host;
}

const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

describe('TV series screen', () => {
  it('shows the TMDB title and the status pill', async () => {
    const host = await mount();
    expect(text(host.querySelector('.series-hero h1'))).toBe('Тёмная материя');
    expect(text(host.querySelector('.series-hero .series-pill'))).toContain('Выходит');
    expect(host.querySelector('.series-backdrop img')!.getAttribute('src')).toBe('http://img/backdrop.jpg');
  });

  it('has a chip per library season and a dashed chip for the season to come', async () => {
    const host = await mount();
    const chips = host.querySelectorAll('.season-chip');
    expect(chips).toHaveLength(3);
    expect(text(chips[0].querySelector('.chip-name'))).toBe('Сезон 1');
    expect(text(chips[1].querySelector('.chip-name'))).toBe('Сезон 2');
    expect(chips[2].classList.contains('chip-future')).toBe(true);
    expect(text(chips[2].querySelector('.chip-name'))).toBe('Сезон 3');
  });

  it('lists the chosen season with TMDB episode names', async () => {
    const host = await mount(2);
    const rows = host.querySelectorAll('.ep-row');
    expect(rows).toHaveLength(2);
    expect(text(rows[0].querySelector('.ep')) + ' ' + text(rows[0].querySelector('.name'))).toBe('S02E01 Пилот');
    expect(text(rows[1].querySelector('.ep')) + ' ' + text(rows[1].querySelector('.name'))).toBe('S02E02 Второй');
  });

  it('plays the next episode without a start position (the player asks where to start)', async () => {
    const host = await mount(2);
    act(() => setFocus('series-watch'));
    await flush();
    const btn = host.querySelector('[data-fk="series-watch"]')!;
    expect(text(btn)).toContain('S02E01');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(ev, 'keyCode', { get: () => 13 });
    Object.defineProperty(ev, 'which', { get: () => 13 });
    act(() => { window.dispatchEvent(ev); });
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(up, 'keyCode', { get: () => 13 });
    Object.defineProperty(up, 'which', { get: () => 13 });
    act(() => { window.dispatchEvent(up); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('player');
    expect(r.startAt).toBeUndefined();
    expect(r.queue[r.index].hash).toBe('s2');
    expect(r.queue[r.index].fileIndex).toBe(1);
  });

  it('opens the only torrent of the season from «Раздачи · 1»', async () => {
    const host = await mount(2);
    const btn = host.querySelector('[data-fk="series-releases"]') as HTMLElement;
    expect(text(btn)).toBe('Раздачи · 1');
    act(() => { btn.click(); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('torrent');
    expect(r.hash).toBe('s2');
  });

  it('marks the focused episode watched on the red key', async () => {
    const host = await mount(2);
    const row = host.querySelectorAll('.ep-row')[1] as HTMLElement;
    act(() => setFocus(row.getAttribute('data-fk')!));
    await flush();
    act(() => { dispatchKey('red', new KeyboardEvent('keydown')); });
    await flush();
    expect(markWatched).toHaveBeenCalledWith('s2', 2);
  });

  it('shows one row per episode when two torrents hold the same season', async () => {
    const other = { ...season(2), hash: 's2b', timestamp: 5 };
    torrents.value = (fixture as any[]).concat(other) as any;
    // S02E01 watched in the older release: that copy stays; S02E02 comes from the newer one
    saveProgress('s2', 1, 100, 100);
    const host = await mount(2);
    const rows = host.querySelectorAll('.ep-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-fk')).toBe('ep-s2-1');
    expect(rows[1].getAttribute('data-fk')).toBe('ep-s2b-2');
    const chip = host.querySelector('[data-fk="season-2"]')!;
    expect(text(chip.querySelector('.chip-sub'))).toBe('1 из 2');
    const watch = host.querySelector('[data-fk="series-watch"]') as HTMLElement;
    expect(text(watch)).toContain('S02E02');
    act(() => { watch.click(); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('player');
    expect(r.queue[r.index].hash).toBe('s2b');
    expect(r.queue[r.index].fileIndex).toBe(2);
  });

  it('keeps the chosen season when focus moves into the seasons row', async () => {
    const host = await mount(2);
    act(() => setFocus('series-watch'));
    await flush();
    act(() => setFocus('SERIES-SEASONS'));
    await flush();
    expect(host.querySelector('.season-chip.focused')!.getAttribute('data-fk')).toBe('season-2');
    expect(host.querySelector('.season-chip.on')!.getAttribute('data-fk')).toBe('season-2');
    expect(text(host.querySelector('.ep-row .ep'))).toBe('S02E01');
  });
});
