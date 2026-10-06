import { wantList } from '../../src/store/wantList';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { TitleCardScreen, initials } from '../../src/screens/TitleCard';
import { LibraryScreen } from '../../src/screens/Library';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary, libraryTab } from '../../src/store/library';
import { currentRoute, routeStack, goBack, routeKey } from '../../src/ui/nav';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetDiscoverState } from '../../src/store/discover';
import { torrentQuery } from '../../src/catalog/tmdb';
import { seriesKey } from '../../src/lib/seriesGroups';

const fixture = [
  { hash: 's2', title: 'Тёмная материя / Dark Matter / Сезон: 2 / Серии: 1-2 из 10 (2026) WEB-DL 1080p', category: 'tv', timestamp: 2 },
  { hash: 'f1', title: 'Тихий сигнал / Quiet Signal (2024) 2160p', category: 'movie', timestamp: 1 },
];

const person = (i: number) => ({ name: 'Актёр Номер' + i, photo: i === 0 ? 'http://img/a0.jpg' : '', role: 'Роль ' + i });

const film = {
  kind: 'movie', id: 7, title: 'Тихий сигнал', original: 'Quiet Signal', year: 2024, poster: 'http://img/p.jpg', rating: 7.84,
  backdrop: 'http://img/b.jpg', genres: ['драма', 'триллер'], runtime: 118, overview: 'Обзор фильма', airing: false,
  cast: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(person), seasons: [],
};
const otherFilm = { ...film, id: 8, title: 'Другой фильм', original: 'Another Film', year: 2023, cast: [] };

const series = {
  kind: 'tv', id: 1, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6,
  backdrop: '', genres: ['фантастика'], runtime: 50, overview: 'Обзор сериала', cast: [], airing: true, status: 'returning',
  seasons: [
    { number: 3, episodes: 0, year: 2099, aired: 0, airDate: '2099-01-01' },
    { number: 2, episodes: 10, year: 2026, aired: 2, airDate: '2026-01-01' },
    { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
  ],
  nextEpisode: { season: 3, episode: 1, airDate: '2099-01-01' },
};

const cards: { [k: string]: unknown } = { 'movie:7': film, 'movie:8': otherFilm, 'tv:1': series };
let stub: any;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  resetLibrary();
  resetDiscoverState();
  stub = {
    card: vi.fn((kind: string, id: number) => Promise.resolve(cards[kind + ':' + id])),
    discover: vi.fn(() => Promise.resolve({ items: [
      { kind: 'movie', id: 8, title: 'Другой фильм', original: 'Another Film', year: 2023, poster: '', rating: 6 },
      { kind: 'movie', id: 7, title: 'Тихий сигнал', original: 'Quiet Signal', year: 2024, poster: '', rating: 7.8 },
    ], pages: 1 })),
  };
  setCatalogProvider(() => Promise.resolve(stub));
  torrents.value = fixture as any;
  routeStack.value = [{ name: 'library' }];
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

const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};

async function mount(kind: string, id: number, extra: Record<string, unknown> = {}) {
  routeStack.value = [{ name: 'library' }, { name: 'title', kind: kind as any, id: id }];
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h('div', { class: 'screen-host' }, h(TitleCardScreen as any, { kind, id, ...extra })), host); });
  await flush();
  return host;
}

describe('TV title card', () => {
  it('shows a film with its rating and overview and searches for it', async () => {
    const host = await mount('movie', 7);
    expect(stub.card).toHaveBeenCalledWith('movie', 7);
    expect(text(host.querySelector('.series-info h1'))).toBe('Тихий сигнал');
    expect(text(host.querySelector('.tc-original'))).toBe('Quiet Signal');
    expect(text(host.querySelector('.tc-rating'))).toBe('★ 7,8');
    expect(text(host.querySelector('.tc-meta'))).toContain('2024');
    expect(text(host.querySelector('.tc-meta'))).toContain('1 ч 58 мин');
    expect(text(host.querySelector('.series-overview'))).toBe('Обзор фильма');
    expect(host.querySelector('.series-backdrop img')!.getAttribute('src')).toBe('http://img/b.jpg');
    expect(host.querySelector('.series-seasons')).toBeNull();
    expect(getCurrentFocusKey()).toBe('title-find');
    await click(host.querySelector('[data-fk="title-find"]')!);
    expect(currentRoute.value).toEqual({ name: 'add', query: torrentQuery(film as any), run: true });
  });

  it('opens a film from the library only when the library has it', async () => {
    let host = await mount('movie', 7);
    const open = host.querySelector('[data-fk="title-open"]')!;
    expect(text(open)).toBe('Открыть в медиатеке');
    await click(open);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'f1' });

    host = await mount('movie', 8);
    expect(host.querySelector('[data-fk="title-open"]')).toBeNull();
  });

  it('lists the cast: up to 8, with a photo or the initials', async () => {
    const host = await mount('movie', 7);
    const people = host.querySelectorAll('.tc-person');
    expect(people).toHaveLength(8);
    expect(people[0].querySelector('img')!.getAttribute('src')).toBe('http://img/a0.jpg');
    expect(text(people[1].querySelector('.tc-initials'))).toBe('АН');
    expect(text(people[1].querySelector('.tc-person-name'))).toBe('Актёр Номер1');
    expect(text(people[1].querySelector('.tc-person-role'))).toBe('Роль 1');
    expect(initials('Сидни Чандлер')).toBe('СЧ');
  });

  it('shows a series with its pill and the seasons in their states', async () => {
    const host = await mount('tv', 1);
    expect(text(host.querySelector('.tc-meta .series-pill'))).toContain('Выходит');
    expect(text(host.querySelector('.tc-meta'))).toContain('3 сезона');
    const chips = Array.prototype.slice.call(host.querySelectorAll('.tc-chip')) as HTMLElement[];
    expect(chips.map((c) => text(c.querySelector('.chip-name')))).toEqual(['Сезон 1 · 2024', 'Сезон 2 · 2026', 'Сезон 3 · 2099']);
    expect(chips[0].className).toContain('tc-chip-missing');
    expect(text(chips[0].querySelector('.chip-sub'))).toBe('9 серий · найти раздачи');
    expect(chips[1].className).toContain('tc-chip-library');
    expect(text(chips[1].querySelector('.chip-sub'))).toBe('выходит: 2 из 10 · в медиатеке');
    expect(chips[2].className).toContain('chip-future');
    expect(text(chips[2].querySelector('.chip-sub'))).toContain('выйдет');

    await click(chips[0]);
    expect(currentRoute.value).toEqual({ name: 'add', query: torrentQuery(series as any, 1), run: true });
  });

  it('opens the series screen on a season of the library, and the series from the hero', async () => {
    const key = seriesKey(fixture[0] as any);
    let host = await mount('tv', 1);
    await click(host.querySelectorAll('.tc-chip')[1]);
    expect(currentRoute.value).toEqual({ name: 'series', key: key, season: 2 });
    host = await mount('tv', 1);
    await click(host.querySelector('[data-fk="title-open"]')!);
    expect(currentRoute.value).toEqual({ name: 'series', key: key });
  });

  it('leaves «Хочу посмотреть» to the list hooks', async () => {
    const onWant = vi.fn();
    let host = await mount('movie', 7, { onWant: onWant });
    const want = host.querySelector('[data-fk="title-want"]')!;
    expect(text(want)).toBe('★ Хочу посмотреть');
    await click(want);
    expect(onWant).toHaveBeenCalledWith(film);
    host = await mount('movie', 7, { wanted: () => true });
    expect(text(host.querySelector('[data-fk="title-want"]'))).toBe('В списке');
  });

  it('shows the offline text with «Повторить»', async () => {
    stub.card = vi.fn(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
    const host = await mount('movie', 7);
    expect(text(host.querySelector('.disc-error'))).toContain('TMDB не отвечает');
    expect(text(host.querySelector('.disc-error'))).not.toContain('Мои'); // the TV has no «Мои» tab
    stub.card = vi.fn(() => Promise.resolve(film));
    await click(host.querySelector('[data-fk="title-retry"]')!);
    expect(text(host.querySelector('.series-info h1'))).toBe('Тихий сигнал');
  });

  it('Back returns to «Обзор» with the same poster focused', async () => {
    libraryTab.value = 'discover';
    function Host() {
      const r = currentRoute.value;
      return h('div', { class: 'screen-host', key: routeKey(r) },
        r.name === 'title' ? h(TitleCardScreen, { kind: r.kind, id: r.id }) : h(LibraryScreen, {}));
    }
    const host = document.createElement('div');
    hosts.push(host);
    document.body.appendChild(host);
    act(() => { render(h(Host, {}), host); });
    await flush();
    await act(() => { setFocus('disc-movie-7'); });
    await click(host.querySelector('[data-fk="disc-movie-7"]')!);
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'movie', id: 7 });
    expect(text(host.querySelector('.series-info h1'))).toBe('Тихий сигнал');
    await act(() => { goBack(); });
    await flush();
    expect(currentRoute.value).toEqual({ name: 'library' });
    expect(stub.discover).toHaveBeenCalledTimes(1);
    expect(getCurrentFocusKey()).toBe('disc-movie-7');
  });

  it('toggles the TV list by default: «Хочу посмотреть» <-> «В списке»', async () => {
    wantList.value = [];
    const host = await mount('movie', 7);
    const label = () => text(host.querySelector('[data-fk="title-want"]'));
    expect(label()).toBe('★ Хочу посмотреть');
    await click(host.querySelector('[data-fk="title-want"]')!);
    expect(label()).toBe('В списке');
    expect(wantList.value.map((w) => w.id)).toEqual([7]);
    await click(host.querySelector('[data-fk="title-want"]')!);
    expect(label()).toBe('★ Хочу посмотреть');
    wantList.value = [];
  });
});
