import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen, okHint } from '../../src/screens/Torrent';
import { LibraryScreen } from '../../src/screens/Library';
import { HistoryGrid } from '../../src/screens/library/HistoryGrid';
import { DialogHost } from '../../src/ui/dialog';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary, libraryTab } from '../../src/store/library';
import { routeStack } from '../../src/ui/nav';
import { TorrServerClient } from '../../src/api/torrserver';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { resetCleanNames } from '../../src/lib/cleanNames';
import { resetDiscoverState } from '../../src/store/discover';
import { wantList } from '../../src/store/wantList';
import { usePlayerHeading, itemHeading } from '../../src/player/heading';
import { dispatchKey } from '../../src/ui/keys';
import { mockFetch } from '../helpers/fetchMock';
import type { Torrent } from '../../src/api/types';
import type { PlayItem } from '../../src/player/types';

const files = (...paths: string[]) => paths.map((p, i) => ({ id: i + 1, path: p, length: 1258291200 }));
const withData = (t: Torrent): Torrent => ({ ...t, data: JSON.stringify({ TorrServer: { Files: t.file_stats } }) });

const AVATAR_RAW = 'Аватар: Пламя и Пепел / Avatar: Fire and Ash (Джеймс Кэмерон) [2025, фантастика, боевик, WEB-DL 2160p, HDR10, Dolby Vision] [Hybrid] 3x Dub + 4x MVO + Original (Eng) + Sub (Rus, Ukr, Eng)';
const avatar: Torrent = withData({
  hash: 'a'.repeat(40), title: AVATAR_RAW, category: 'movie', stat: 3, stat_string: 'Torrent working',
  torrent_size: 13314398618, download_speed: 0, active_peers: 0, total_peers: 285,
  file_stats: files('Avatar.Fire.and.Ash.2025.2160p.mkv'),
});
const darkMatter: Torrent = withData({
  hash: 'd'.repeat(40), title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 [2026, США, WEB-DL 1080p]', category: 'tv', stat: 5,
  file_stats: files('Dark.Matter.S02E01.1080p.WEB-DL.RGzsRutracker.mkv', 'Dark.Matter.S02E02.1080p.WEB-DL.RGzsRutracker.mkv'),
});
const ahs: Torrent = withData({
  hash: 'e'.repeat(40), title: 'American Horror Story · Сезон 13', category: 'tv', stat: 5,
  file_stats: files('AHS/American.Horror.Story.S13E01.mkv', 'AHS/American.Horror.Story.S13E02.mkv'),
});
const spirit: Torrent = withData({
  hash: 'f'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]', category: 'tv', stat: 5,
  file_stats: files('Yu_Ling_Shi_[10]_[HEVC].mkv', 'Yu_Ling_Shi_[11]_[HEVC].mkv'),
});

/** TMDB in Russian: the shows of the LG library and the second season of «Тёмная материя». */
const catalog = {
  search: vi.fn((q: string) => {
    const low = q.toLowerCase();
    if (low.indexOf('american horror story') >= 0) return Promise.resolve({ items: [{ kind: 'tv', id: 1, title: 'Американская история ужасов', original: 'American Horror Story', year: 2011, poster: '', rating: 7 }], pages: 1 });
    if (low.indexOf('dark matter') >= 0 || low.indexOf('материя') >= 0) return Promise.resolve({ items: [{ kind: 'tv', id: 2, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7 }], pages: 1 });
    return Promise.resolve({ items: [], pages: 1 });
  }),
  card: vi.fn((_k: string, id: number) => Promise.resolve({ kind: 'tv', id: id, title: id === 1 ? 'Американская история ужасов' : 'Тёмная материя', original: '', year: 2011, seasons: [], cast: [] })),
  season: vi.fn((_id: number, n: number) => Promise.resolve({ episodes: n === 2 ? [{ n: 1, title: 'Спокойная жизнь' }] : n === 13 ? [{ n: 1, title: 'Начало' }] : [] })),
  discover: vi.fn(),
};

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const hosts: HTMLElement[] = [];
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  resetSeriesMatches();
  resetEpisodeNames();
  resetCleanNames();
  setCatalogProvider(() => Promise.resolve(catalog as any));
});
afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setCatalogProvider(null);
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let i = 0; i < 30; i++) await act(() => Promise.resolve());
};
const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

function mountNode(node: any): HTMLElement {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(node, host); });
  return host;
}

function server(list: Torrent[]) {
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(list) : '[]' }));
  setActiveServer(addServer({ url: '10.0.0.2' }).id);
  resetLibrary();
  torrents.value = list;
}

describe('TV torrent screen: clean header, status, hints and the action row', () => {
  async function open(tor: Torrent) {
    server([tor]);
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    const host = mountNode(h(TorrentScreen, { hash: tor.hash }));
    await flush();
    return host;
  }

  it('shows the clean title with the raw release name small under it', async () => {
    const host = await open(avatar);
    expect(text(host.querySelector('h1'))).toBe('Аватар: Пламя и Пепел');
    expect(text(host.querySelector('.torrent-raw'))).toBe(AVATAR_RAW);
  });

  it('names a matched series by its TMDB name', async () => {
    const host = await open(darkMatter);
    expect(text(host.querySelector('h1'))).toBe('Тёмная материя');
  });

  it('shows the TorrServer state in Russian with localized units', async () => {
    const host = await open(avatar);
    expect(text(host.querySelector('.torrent-status'))).toBe('12,4 ГБ · Работает · 0 Б/с · пиры 0/285');
    expect(text(host.querySelector('.torrent-status'))).not.toMatch(/Torrent|B\/s/);
  });

  it('makes the hint follow the focused area: «OK — переключить» on a skip switch', async () => {
    const host = await open(darkMatter);
    const hint = () => text(host.querySelector('.hints'));
    expect(hint()).toContain('OK — смотреть');
    await act(async () => { setFocus('skip-intro'); await new Promise((r) => setTimeout(r, 20)); });
    expect(hint()).toContain('OK — переключить');
    expect(hint()).not.toContain('смотреть');
    await act(async () => { setFocus('skip-status'); await new Promise((r) => setTimeout(r, 20)); });
    expect(hint()).toContain('OK — задать метки');
    await act(async () => { setFocus('file-1'); await new Promise((r) => setTimeout(r, 20)); });
    expect(hint()).toContain('OK — смотреть');
    await act(async () => { setFocus('torrent-rename'); await new Promise((r) => setTimeout(r, 20)); });
    expect(hint()).toContain('OK — выбрать');
    expect(okHint('skip')).toBe('OK — переключить');
  });

  it('scrolls the action row back to the start when the focus leaves it', async () => {
    const host = await open(darkMatter);
    const box = host.querySelector('.torrent-actions') as HTMLElement;
    let scroll = 0;
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => scroll, set: (v: number) => { scroll = v; } });
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 600 });
    const row = host.querySelector('.torrent-actions-row') as HTMLElement;
    Array.prototype.forEach.call(row.querySelectorAll('[data-fk]'), (el: HTMLElement, i: number) => {
      Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => i * 316 });
      Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 300 });
    });
    await act(async () => { setFocus('torrent-delete'); await new Promise((r) => setTimeout(r, 20)); });
    expect(scroll).toBeGreaterThan(0);
    await act(async () => { setFocus('skip-intro'); await new Promise((r) => setTimeout(r, 20)); });
    expect(scroll).toBe(0);
  });
});

describe('TV «История»: clean names, never a file name', () => {
  const entry = (tor: Torrent, fileIndex: number) => ({
    torrent: tor, fileIndex: fileIndex, progress: { time: 60, duration: 3000, updated: 1 }, source: { src: 'tv' as const, at: 0 },
  });

  it('shows the TMDB series name and «Сезон 13 · Серия 1 · Начало»', async () => {
    torrents.value = [ahs, spirit];
    const pathOf = (e: any) => e.torrent.file_stats.filter((f: any) => f.id === e.fileIndex)[0].path;
    const host = mountNode(h(HistoryGrid as any, { entries: [entry(ahs, 1), entry(spirit, 2)], filePath: pathOf, onOpen: vi.fn(), onFocused: vi.fn() }));
    await flush();
    const cards = host.querySelectorAll('.hcard');
    expect(text(cards[0].querySelector('.hcard-title'))).toBe('Американская история ужасов');
    expect(text(cards[0].querySelector('.hcard-ep'))).toBe('Сезон 13 · Серия 1 · Начало');
    expect(text(cards[1].querySelector('.hcard-title'))).toBe('Повелитель духов');
    expect(text(cards[1].querySelector('.hcard-ep'))).toBe('Серия 11');
    expect(text(host)).not.toMatch(/Yu_Ling_Shi|\.mkv|AniLiberty/);
  });
});

describe('TV player title bar', () => {
  function Heading(p: { item: PlayItem }) {
    return h('div', { class: 'heading' }, usePlayerHeading(p.item));
  }

  it('shows «Тёмная материя · S02E01 · Спокойная жизнь» instead of the file name', async () => {
    torrents.value = [darkMatter, avatar];
    const item: PlayItem = { url: 'u', title: 'Dark.Matter.S02E01.1080p.WEB-DL.RGzsRutracker.mkv', hash: darkMatter.hash, fileIndex: 1, torrentTitle: darkMatter.title };
    expect(itemHeading(item)).toBe('Темная материя · S02E01');
    const host = mountNode(h(Heading, { item: item }));
    await flush();
    expect(text(host.querySelector('.heading'))).toBe('Тёмная материя · S02E01 · Спокойная жизнь');
  });

  it('shows the film title for a film', async () => {
    torrents.value = [darkMatter, avatar];
    const item: PlayItem = { url: 'u', title: AVATAR_RAW, hash: avatar.hash, fileIndex: 1, torrentTitle: AVATAR_RAW };
    const host = mountNode(h(Heading, { item: item }));
    await flush();
    expect(text(host.querySelector('.heading'))).toBe('Аватар: Пламя и Пепел');
  });
});

describe('TV library tiles: the TMDB name in the UI language (the cause of «American Horror Story»)', () => {
  it('names a lone series tile by its Russian TMDB name once matched, like the phone', async () => {
    server([ahs, avatar]);
    routeStack.value = [{ name: 'library' }];
    libraryTab.value = 'all';
    const host = mountNode(h(LibraryScreen, {}));
    await flush();
    const titles = Array.prototype.map.call(host.querySelectorAll('.tile-title'), (e: Element) => text(e)) as string[];
    expect(titles).toContain('Американская история ужасов');
    expect(titles).not.toContain('American Horror Story · Сезон 13');
    expect(titles).toContain('Аватар: Пламя и Пепел');
  });
});

describe('TV «Обзор»: the sort hint, the chip bar and the poster window', () => {
  const tile = (i: number) => ({ kind: 'movie', id: 1000 + i, title: 'Фильм ' + i, original: 'Film ' + i, year: 2020, poster: 'http://img/' + i + '.jpg', rating: 7 });

  async function mount() {
    server([]);
    resetDiscoverState();
    wantList.value = [];
    const items: ReturnType<typeof tile>[] = [];
    for (let i = 0; i < 200; i++) items.push(tile(i));
    catalog.discover = vi.fn(() => Promise.resolve({ items: items, pages: 1 }));
    routeStack.value = [{ name: 'library' }];
    libraryTab.value = 'discover';
    const host = mountNode(h('div', {}, h(LibraryScreen, {}), h(DialogHost, {})));
    await flush();
    return host;
  }

  it('says «сортировка» for the blue key, which opens the sort dialog', async () => {
    const host = await mount();
    const hints = text(host.querySelector('.hints'));
    expect(hints).toContain('сортировка');
    expect(hints).not.toContain('фильтры');
    await act(async () => { setFocus('disc-movie-1000'); await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { dispatchKey('blue', new KeyboardEvent('keydown')); });
    await flush();
    expect(text(document.body.querySelector('.dialog'))).toContain('Сортировка');
  });

  it('keeps the bar in one row that scrolls to the focused chip («Хочу» at the right end)', async () => {
    const host = await mount();
    const box = host.querySelector('.disc-bar-box') as HTMLElement;
    expect(box && box.querySelector('.disc-bar')).toBeTruthy();
    let scroll = 0;
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => scroll, set: (v: number) => { scroll = v; } });
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 1760 });
    const want = host.querySelector('[data-fk="disc-kind-want"]') as HTMLElement;
    Object.defineProperty(want, 'offsetLeft', { configurable: true, get: () => 1800 });
    Object.defineProperty(want, 'offsetWidth', { configurable: true, get: () => 120 });
    await act(async () => { setFocus('disc-kind-want'); await new Promise((r) => setTimeout(r, 20)); });
    expect(scroll).toBe(1800 + 120 + 24 - 1760);
    const all = host.querySelector('[data-fk="disc-kind-all"]') as HTMLElement;
    Object.defineProperty(all, 'offsetLeft', { configurable: true, get: () => 4 });
    await act(async () => { setFocus('disc-kind-all'); await new Promise((r) => setTimeout(r, 20)); });
    expect(scroll).toBe(0);
  });

  it('lets go of the posters far from the focus and brings them back', async () => {
    const host = await mount();
    const imgs = () => host.querySelectorAll('.disc-poster img').length;
    const hasImg = (i: number) => !!host.querySelector('[data-fk="disc-movie-' + (1000 + i) + '"] img');
    expect(host.querySelectorAll('.disc-tile')).toHaveLength(200);
    // focus at the top: rows 0..9 (80 posters) are loaded
    expect(imgs()).toBe(80);
    await act(async () => { setFocus('disc-movie-1199'); await new Promise((r) => setTimeout(r, 20)); });
    expect(imgs()).toBe(80);
    expect(hasImg(0)).toBe(false);
    expect(hasImg(199)).toBe(true);
    // the tile keeps its poster box (the layout height stays)
    expect(host.querySelector('[data-fk="disc-movie-1000"] .disc-poster')).not.toBeNull();
    await act(async () => { setFocus('disc-movie-1000'); await new Promise((r) => setTimeout(r, 20)); });
    expect(hasImg(0)).toBe(true);
    expect(hasImg(199)).toBe(false);
  });
});

describe('TV library grid: the same poster window', () => {
  it('drops the posters of tiles far from the focus and restores them', async () => {
    const list: Torrent[] = [];
    for (let i = 0; i < 120; i++) list.push({ hash: 'h' + i, title: 'Film ' + i + ' (2020)', category: 'movie', stat: 5, poster: 'http://img/' + i + '.jpg', timestamp: 1000 - i });
    server(list);
    routeStack.value = [{ name: 'library' }];
    libraryTab.value = 'all';
    const host = mountNode(h(LibraryScreen, {}));
    await flush();
    // the large view (the default): 6 per row, rows of 560px, 6 rows kept on each side
    const imgs = () => host.querySelectorAll('.tile .art img').length;
    expect(host.querySelectorAll('.tile')).toHaveLength(120);
    expect(imgs()).toBe(7 * 6);
    await act(async () => { setFocus('torrent-h119'); await new Promise((r) => setTimeout(r, 20)); });
    expect(host.querySelector('[data-fk="torrent-h0"] img')).toBeNull();
    expect(host.querySelector('[data-fk="torrent-h119"] img')).not.toBeNull();
    await act(async () => { setFocus('torrent-h0'); await new Promise((r) => setTimeout(r, 20)); });
    expect(host.querySelector('[data-fk="torrent-h0"] img')).not.toBeNull();
  });
});
