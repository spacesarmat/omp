import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { applyLanguageSetting } from '../../src/i18n';
import { ConnectScreen } from '../../src/screens/Connect';
import { LibraryScreen } from '../../src/screens/Library';
import { TorrentScreen } from '../../src/screens/Torrent';
import { SettingsScreen } from '../../src/screens/Settings';
import { UpdateScreen } from '../../src/screens/Update';
import { SourcesScreen } from '../../src/screens/Sources';
import { AddScreen } from '../../src/screens/Add';
import { PlaylistScreen } from '../../src/screens/Playlist';
import { SeriesScreen } from '../../src/screens/Series';
import { FaqScreen } from '../../src/screens/Faq';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesKey } from '../../src/lib/seriesGroups';
import { PairPhoneScreen } from '../../src/screens/PairPhone';
import { MarksDialog } from '../../src/ui/MarksDialog';
import { UpdateDialog } from '../../src/ui/UpdateDialog';
import { WhatsNewDialog } from '../../src/ui/WhatsNewDialog';
import { TrackerLoginDialog } from '../../src/ui/TrackerLoginDialog';
import { EditServerDialog } from '../../src/screens/connect/EditServerDialog';
import { DialogHost, confirmDialog } from '../../src/ui/dialog';
import { TopBar } from '../../src/ui/TopBar';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { resetSettings } from '../../src/store/settings';
import { updatePrompt, latestUpdate } from '../../src/store/updates';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { routeStack } from '../../src/ui/nav';
import { TitleCardScreen } from '../../src/screens/TitleCard';
import { libraryTab } from '../../src/store/library';
import { resetDiscoverState } from '../../src/store/discover';
import { wantList } from '../../src/store/wantList';
import { TorrServerClient } from '../../src/api/torrserver';
import { mockFetch } from '../helpers/fetchMock';
import { PhoneSourcesScreen } from '../../src/screens/PhoneSources';
import { setRpcTransport, phoneStatus } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
import { resetSourceNames } from '../../src/sources/sourceNames';
import { resetTo } from '../../src/ui/nav';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { newsSeg, resetNewsCache } from '../../src/screens/library/NewsTv';
import { newsUnseen } from '../../src/phone/monitor';
import type { Source } from '../../src/sources/types';

const CYR = /[А-Яа-яЁё]/;
const noRussian = (host: HTMLElement) => (host.textContent || '').replace(/Русский/g, '');
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const buttons = (host: HTMLElement) => Array.prototype.map.call(host.querySelectorAll('.button'), (b: Element) => b.textContent) as string[];
let host: HTMLElement;

function mount(node: any) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(node, host));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  routeStack.value = [{ name: 'library' }];
  mockFetch(() => ({ body: '[]' }));
  applyLanguageSetting('en');
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  resetSettings();
  updatePrompt.value = null;
  latestUpdate.value = null;
  closeWhatsNew();
  applyLanguageSetting('ru');
  vi.restoreAllMocks();
});

describe('TV screens in English', () => {
  it('Connect, the history and the edit dialog', async () => {
    addServer({ url: '192.168.1.191:5665', name: 'Home' });
    mount(h(ConnectScreen, {}));
    let text = host.textContent || '';
    expect(text).toContain('TorrServer address');
    expect(buttons(host)).toContain('Connect');
    expect(buttons(host)).toContain('Find on network');
    expect(text).toContain('Server history');
    expect(text).toContain('Back — exit');
    expect(text).not.toMatch(CYR);
    (host.querySelector('.history-btn') as HTMLElement).click();
    await flush();
    expect(host.textContent).toContain('OK — connect · Back — close the list');
    (host.querySelector('.hist-card .button') as HTMLElement).click();
    await flush();
    text = host.textContent || '';
    expect(host.querySelector('.edit-server .dialog-title')!.textContent).toBe('Edit server');
    expect(text).toContain('Save');
    expect(text).toContain('Delete');
    expect(text).not.toMatch(CYR);
  });

  it('EditServerDialog confirms the removal in English', async () => {
    const s = addServer({ url: '10.0.0.1:8090', name: 'Cabin' });
    mount(h('div', {}, h(EditServerDialog, { server: s, onClose: () => undefined }), h(DialogHost, {})));
    act(() => (Array.prototype.filter.call(host.querySelectorAll('.button'), (b: Element) => b.textContent === 'Delete')[0] as HTMLElement).click());
    await flush();
    expect(host.textContent).toContain('Delete the server "Cabin"?');
    expect(host.textContent).not.toMatch(CYR);
  });

  it('Library: catalog, empty state and the top bar', async () => {
    setActiveServer(addServer({ url: '10.0.0.2' }).id);
    torrents.value = [];
    mount(h(LibraryScreen, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('No torrents. Add them via "Add" or the TorrServer web interface on the phone.');
    expect(text).toContain('OK — open');
    expect(text).toContain('Back — exit');
    expect(text).not.toMatch(CYR);
    expect(host.querySelector('[aria-label="Add"]') || host.textContent).toBeTruthy();
  });

  it('Library: the offline catalog', async () => {
    setActiveServer(addServer({ url: '10.0.0.2' }).id);
    torrents.value = [];
    mockFetch(() => ({ status: 500, body: 'x' }));
    mount(h(LibraryScreen, {}));
    await flush();
    await flush();
    const text = host.textContent || '';
    expect(text).toMatch(/Catalog unavailable|No torrents/);
    expect(text).not.toMatch(CYR);
  });

  it('TopBar labels', () => {
    mount(h(TopBar, { tab: 'all', onTab: () => undefined, view: 'large', sort: 'new', searchOpen: false, onSearch: () => undefined, onView: () => undefined, onSort: () => undefined, onFocused: () => undefined }));
    const labels = Array.prototype.map.call(host.querySelectorAll('.icon-button'), (e: Element) => e.getAttribute('aria-label')).join('|');
    expect(labels).toContain('Search');
    expect(labels).toContain('Find a release');
    expect(labels).toContain('Playlists');
    expect(labels).toContain('Settings');
    expect(labels).not.toMatch(CYR);
    expect(host.textContent).not.toMatch(CYR);
  });

  it('Torrent card', async () => {
    const H = 'e'.repeat(40);
    const tor = { hash: H, title: 'Starbound Frontier S02 1080p', stat: 3, file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })) };
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = [tor as any];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor as any);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({ streams: [] } as any);
    mount(h(TorrentScreen, { hash: H }));
    await flush();
    const text = host.textContent || '';
    expect(buttons(host).some((b) => (b || '').indexOf('Watch') === 0)).toBe(true);
    expect(buttons(host)).toContain('Reset progress');
    expect(buttons(host)).toContain('Delete');
    expect(text).toContain('Skip');
    expect(text).toContain('Skip the intro automatically');
    expect(text).toContain('Intro and credits');
    expect(text).toContain('Season 2');
    expect(text).toContain('OK — watch');
    expect(text).toContain('Back — to the library');
    expect(text).not.toMatch(CYR);
  });

  it('Series screen', async () => {
    const seasonT = (n: number) => ({
      hash: 'q' + n, title: 'Dark Matter S0' + n + ' 1080p WEB-DL', category: 'tv', timestamp: n, torrent_size: 4e9,
      file_stats: [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S0' + n + 'E0' + e + '.1080p.mkv', length: 2e9 })),
    });
    const fixture = [seasonT(1), seasonT(2)];
    const card = {
      id: 1, kind: 'tv', title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6, backdrop: '',
      genres: ['Sci-Fi'], runtime: 50, overview: 'A show', cast: [], airing: true, status: 'returning',
      seasons: [
        { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
        { number: 2, episodes: 10, year: 2026, aired: 2, airDate: '2026-01-01' },
        { number: 3, episodes: 0, year: 2099, aired: 0, airDate: '2099-01-01' },
      ],
      nextEpisode: { season: 3, episode: 1, airDate: '2099-01-01' },
    };
    const stub: any = {
      search: () => Promise.resolve({ items: [{ id: 1, kind: 'tv', title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
      card: () => Promise.resolve(card),
      season: (_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes: [
        { n: 1, title: 'Pilot', airDate: '2024-05-08', runtime: 50, overview: '' },
        { n: 2, title: 'Second', airDate: '2024-05-15', runtime: 50, overview: '' },
      ] }),
    };
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
    resetSeriesMatches();
    resetEpisodeNames();
    setCatalogProvider(() => Promise.resolve(stub));
    torrents.value = fixture as any;
    const key = seriesKey(fixture[0] as any);
    routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    mount(h(SeriesScreen, { seriesKey: key }));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Dark Matter');
    expect(text).toContain('Airing');
    expect(text).toContain('Season 1');
    expect(text).toContain('Torrents · 1');
    expect(text).toContain('Watch S02E01');
    expect(text).toContain('next episode');
    expect(text).not.toMatch(CYR);
    setCatalogProvider(null);
  });

  it('Series screen: missing and announced seasons', async () => {
    const tor = {
      hash: 'q2', title: 'Dark Matter S02 1080p WEB-DL', category: 'tv', timestamp: 2, torrent_size: 4e9,
      file_stats: [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S02E0' + e + '.1080p.mkv', length: 2e9 })),
    };
    const card = {
      id: 1, kind: 'tv', title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6, backdrop: '',
      genres: ['Sci-Fi'], runtime: 50, overview: 'A show', cast: [], airing: false, status: 'returning',
      seasons: [
        { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
        { number: 2, episodes: 10, year: 2026, aired: 10, airDate: '2026-01-01' },
        { number: 3, episodes: 0, year: 0, aired: 0 },
      ],
    };
    const stub: any = {
      search: () => Promise.resolve({ items: [{ id: 1, kind: 'tv', title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
      card: () => Promise.resolve(card),
      season: (_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes: [] }),
    };
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify([tor]) : '[]' }));
    resetSeriesMatches();
    resetEpisodeNames();
    setCatalogProvider(() => Promise.resolve(stub));
    torrents.value = [tor] as any;
    const key = seriesKey(tor as any);
    routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    mount(h(SeriesScreen, { seriesKey: key }));
    await flush();
    expect(host.textContent || '').toContain('+ Season 1');
    expect(host.textContent || '').toContain('not in the library');
    expect(host.textContent || '').toContain('soon');
    await act(async () => { setFocus('season-1'); });
    await flush();
    expect(host.textContent || '').toContain('This season is not in the library');
    expect(buttons(host)).toContain('Find torrents');
    await act(async () => { setFocus('season-3'); });
    await flush();
    expect(host.textContent || '').toContain('The release date is not known yet');
    expect(noRussian(host)).not.toMatch(CYR);
    setCatalogProvider(null);
  });

  it('Library: the discover tab', async () => {
    setActiveServer(addServer({ url: '10.0.0.2' }).id);
    torrents.value = [];
    resetDiscoverState();
    wantList.value = [];
    libraryTab.value = 'discover';
    const stub: any = {
      discover: () => Promise.resolve({ items: [{ kind: 'tv', id: 1, title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
      search: () => Promise.resolve({ items: [], pages: 1 }),
    };
    setCatalogProvider(() => Promise.resolve(stub));
    try {
      mount(h(LibraryScreen, {}));
      await flush();
      const text = host.textContent || '';
      expect(host.querySelectorAll('.disc-tile').length).toBe(1);
      expect(text).toContain('Dark Matter');
      expect(text).toContain('2024 · Series');
      expect(text).toContain('OK — details');
      expect(text).not.toMatch(CYR);
      const aria = Array.prototype.map.call(host.querySelectorAll('[aria-label]'), (e: Element) => e.getAttribute('aria-label')).join('|');
      expect(aria).not.toMatch(CYR);
    } finally {
      libraryTab.value = 'all';
      setCatalogProvider(null);
    }
  });

  it('Title card', async () => {
    setActiveServer(addServer({ url: '10.0.0.2' }).id);
    torrents.value = [];
    resetDiscoverState();
    const card = {
      kind: 'tv', id: 1, title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6, backdrop: '',
      genres: ['Sci-Fi'], runtime: 50, overview: 'A show', airing: true, status: 'returning',
      cast: [{ name: 'Jane Roe', photo: '', role: 'Captain' }],
      seasons: [
        { number: 2, episodes: 10, year: 2026, aired: 2, airDate: '2026-01-01' },
        { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
        { number: 3, episodes: 0, year: 0, aired: 0 },
      ],
      nextEpisode: { season: 2, episode: 3, airDate: '2099-01-01' },
    };
    setCatalogProvider(() => Promise.resolve({ card: () => Promise.resolve(card), discover: () => Promise.resolve({ items: [], pages: 1 }) } as any));
    routeStack.value = [{ name: 'library' }, { name: 'title', kind: 'tv', id: 1 }];
    try {
      mount(h(TitleCardScreen as any, { kind: 'tv', id: 1 }));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('Dark Matter');
      expect(text).toContain('Jane Roe');
      expect(text).toContain('Season 1');
      expect(text).toContain('Find torrents');
      expect(text).toContain('Want to watch');
      expect(noRussian(host)).not.toMatch(CYR);
      const aria = Array.prototype.map.call(host.querySelectorAll('[aria-label]'), (e: Element) => e.getAttribute('aria-label')).join('|');
      expect(aria).not.toMatch(CYR);
    } finally {
      setCatalogProvider(null);
    }
  });

  it('Better quality dialog', async () => {
    const H = 'a'.repeat(40);
    const film = { hash: H, title: 'Dune: Part Two (2024) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 8.9e9, file_stats: [{ id: 1, path: 'Dune.Part.Two.2024.1080p.WEB-DL.mkv', length: 8.9e9 }] };
    const res = (title: string, seed: number, hash: string) => ({ Title: title, Categories: 'Movies', Size: '20 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + hash, Hash: hash, Peer: 0, Seed: seed });
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = [film as any];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(film as any);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({ streams: [] } as any);
    vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation((_q: string, src: string) =>
      Promise.resolve(src === 'rutor' ? [res('Dune: Part Two (2024) UHD BDRemux 2160p HDR', 42, 'd'.repeat(40))] : []) as any);
    setCatalogProvider(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
    try {
      mount(h('div', {}, h(TorrentScreen, { hash: H }), h(DialogHost, {})));
      await flush();
      const find = Array.prototype.filter.call(host.querySelectorAll('.button'), (b: Element) => b.textContent === 'Find in better quality')[0] as HTMLElement;
      expect(find).toBeTruthy();
      act(() => find.click());
      await flush();
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      await flush();
      expect(host.querySelector('.better-dialog .dialog-title')!.textContent).toBe('In better quality');
      expect(host.querySelectorAll('.better-row').length).toBe(1);
      expect(noRussian(host)).not.toMatch(CYR);
    } finally {
      setCatalogProvider(null);
    }
  });

  it('Help (FAQ)', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    const text = host.textContent || '';
    expect(host.querySelectorAll('.faq-list .faq-q').length).toBeGreaterThan(0);
    expect(text).toContain('Help');
    expect(text).toContain('Installation');
    expect(text).toContain('◀ ▶ — section');
    expect(host.querySelector('.hints')!.textContent).toBe('▲ ▼ — question · ◀ ▶ — section · Back — to settings');
    expect(text).not.toMatch(CYR);
  });

  it('Settings', async () => {
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    vi.spyOn(TorrServerClient.prototype, 'getSettings').mockResolvedValue({ CacheSize: 64 * 1024 * 1024, PreloadCache: 50, ReaderReadAHead: 95, ConnectionsLimit: 25, DownloadRateLimit: 0, UploadRateLimit: 0, TorrentDisconnectTimeout: 30, TrackTimecode: false } as any);
    mount(h(SettingsScreen, {}));
    await flush();
    const text = noRussian(host);
    expect(text).toContain('Settings');
    expect(text).toContain('Playback');
    expect(text).toContain('Audio language');
    expect(text).toContain('Save on the server');
    expect(text).toContain('Check for updates');
    expect(text).toContain('Reset the app settings');
    expect(text).not.toMatch(CYR);
  });

  it('Settings without a server', async () => {
    mount(h(SettingsScreen, {}));
    await flush();
    expect(host.textContent).toContain('No server selected');
  });

  it('Update screen (LG)', async () => {
    mount(h(UpdateScreen, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('OMP update');
    expect(buttons(host)).toContain('Check for updates');
    expect(buttons(host)).toContain('What’s new');
    expect(text).toContain('Via Homebrew Channel');
    expect(text).toContain('From a computer');
    expect(text).not.toMatch(CYR);
  });

  it('Search sources', async () => {
    reloadSourcePrefs();
    resetHealth();
    const tracker: Source = { id: 'fake-tracker', name: 'rutracker', kind: 'builtin', needsLogin: true, search: () => Promise.resolve([]), login: () => Promise.resolve(), logout: () => Promise.resolve(), loggedIn: () => Promise.resolve(false) };
    registerSource(tracker);
    try {
      mount(h(SourcesScreen, { now: Date.now }));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('Search sources');
      expect(text).toContain('Via TorrServer');
      expect(text).toContain('rutor (TorrServer search)');
      expect(text).toContain('Nothing has been sent from the phone yet');
      expect(Array.prototype.map.call(host.querySelectorAll('.focusable'), (n: Element) => n.textContent)).toContain('Sign in');
      expect(text).not.toMatch(CYR);
    } finally {
      unregisterSource('fake-tracker');
    }
  });

  it('Tracker login dialog', async () => {
    const src: Source = { id: 'fake-t', name: 'rutracker', kind: 'builtin', needsLogin: true, search: () => Promise.resolve([]), login: () => Promise.resolve() };
    mount(h(TrackerLoginDialog, { source: src, ctx: () => ({}) as any, onClose: () => undefined, onDone: () => undefined }));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Sign in to rutracker');
    expect(text).toContain('Login');
    expect(text).toContain('Password');
    expect(buttons(host)).toContain('Cancel');
    expect(buttons(host)).toContain('Sign in');
    expect(text).not.toMatch(CYR);
  });

  it('Add', async () => {
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    mount(h(AddScreen, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Find a release');
    expect(buttons(host)).toContain('Search');
    expect(buttons(host)).toContain('Magnet or link');
    expect(buttons(host)).toContain('Sources');
    expect(text).toContain('OK — add and watch');
    expect(text).not.toMatch(CYR);
  });

  describe('search through the phone', () => {
    const PH = { url: 'http://192.168.1.20:8097', token: 'a'.repeat(32), name: 'Pixel' };
    const row = { key: '1', Title: 'Dune 2021 2160p HDR', Size: '10 GB', Seed: 50, Peer: 3, Tracker: 'RuTracker', CreateDate: '2024-03-01', date: '01.03.2024', Categories: '', Magnet: '', Hash: '', source: 'rutracker' };
    const typeAndSearch = async () => {
      const q = host.querySelector('input') as HTMLInputElement;
      act(() => {
        q.value = 'Dune';
        q.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const go = Array.prototype.slice.call(host.querySelectorAll('.button')).filter((b: HTMLElement) => b.textContent === 'Search')[0] as HTMLElement;
      act(() => go.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    };
    afterEach(() => {
      setRpcTransport(null);
      forgetPhoneLink();
      phoneStatus.value = 'unknown';
      resetSourceNames();
      vi.useRealTimers();
    });

    it('the search screen: the phone path', async () => {
      vi.useFakeTimers();
      setActiveServer(addServer({ url: 'http://srv:8090' }).id);
      savePhoneLink(PH);
      setRpcTransport((_u, body) => {
        const m = JSON.parse(body).method;
        const result = m === 'search'
          ? { handle: 'h1', sourceIds: ['rutracker'] }
          : { rev: 1, done: true, pending: [], answered: ['rutracker'], failed: [], results: [row] };
        return Promise.resolve(JSON.stringify({ ok: true, result }));
      });
      mount(h(AddScreen, {}));
      await typeAndSearch();
      const text = host.textContent || '';
      expect(text).toContain('Pixel');
      expect(host.querySelector('.search-result')).not.toBeNull();
      expect(text).toContain('Sort: quality');
      expect(text.replace(/Dune 2021 2160p HDR/g, '')).not.toMatch(CYR);
    });

    it('the search screen: the phone does not answer', async () => {
      vi.useFakeTimers();
      setActiveServer(addServer({ url: 'http://srv:8090' }).id);
      savePhoneLink(PH);
      setRpcTransport(() => Promise.reject(new Error('network')));
      mount(h(AddScreen, {}));
      await typeAndSearch();
      const note = host.querySelector('.search-note-warn');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain('The phone does not answer');
      expect(host.textContent).not.toMatch(CYR);
    });

    it('PhoneSourcesScreen: online', async () => {
      savePhoneLink(PH);
      resetTo({ name: 'settings' });
      setRpcTransport(() => Promise.resolve(JSON.stringify({ ok: true, result: { sources: [
        { id: 'rutracker', name: 'RuTracker', on: true, state: 'loggedIn' },
        { id: 'kinozal', name: 'Kinozal', on: true, state: 'cloudflare' },
        { id: 'nnmclub', name: 'NNM-Club', on: false, state: 'off' },
      ] } })));
      mount(h(PhoneSourcesScreen, {}));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('Sites are searched by phone Pixel');
      expect(text).toContain('connected');
      expect(text).toContain('signed in');
      expect(text).toContain('Rutor, Jackett');
      expect(text).not.toMatch(CYR);
    });

    it('PhoneSourcesScreen: no phone', async () => {
      resetTo({ name: 'settings' });
      mount(h(PhoneSourcesScreen, {}));
      await flush();
      expect(host.textContent).toContain('Rutor, Jackett');
      expect(host.textContent).not.toMatch(CYR);
    });
  });

  describe('the «New» tab', () => {
    const PH = { url: 'http://192.168.1.20:8097', token: 'a'.repeat(32), name: 'Pixel' };
    const res = (key: string, Title: string) => ({ key, Title, Size: '8 GB', Seed: 30, Peer: 2, Tracker: 'rutracker', CreateDate: '', Categories: '', Magnet: '', Hash: '', source: 'rutracker' });
    const findings = [
      { subId: 'episodes', key: 'a:1', kind: 'episodes', at: 300, seen: false, title: 'Foundation', result: res('a:1', 'Foundation S02 1080p'), episodes: { torrentHash: 'd'.repeat(40), season: 2, to: 5 } },
      { subId: 's1', key: 'k7', kind: 'sub', at: 100, seen: true, title: 'Dune', result: res('k7', 'Dune Prophecy 720p') },
      { subId: 'better', key: 'b:3', kind: 'better', at: 200, seen: false, title: 'Dune Part Two', result: res('b:3', 'Dune Part Two 2160p'), better: { torrentHash: 'a'.repeat(40), have: '1080p', got: '4K' } },
    ];
    const subs = [
      { id: 's1', query: 'Dune', quality: '1080p', notify: true, better: false, unseen: 2, checking: false },
      { id: 's2', query: 'Severance', quality: 'any', notify: false, better: true, unseen: 0, checking: false },
    ];
    const useRpc = () => setRpcTransport((_u, body) => {
      const m = JSON.parse(body).method;
      const result = m === 'feed' ? { findings, lastRun: 1 } : m === 'subs' ? { subs } : { ok: true };
      return Promise.resolve(JSON.stringify({ ok: true, result }));
    });
    beforeEach(() => {
      setActiveServer(addServer({ url: '10.0.0.2' }).id);
      torrents.value = [];
      resetNewsCache();
      newsSeg.value = 'feed';
      newsUnseen.value = 0;
      libraryTab.value = 'news';
    });
    afterEach(() => {
      libraryTab.value = 'all';
      newsSeg.value = 'feed';
      setRpcTransport(null);
      forgetPhoneLink();
      phoneStatus.value = 'unknown';
      resetNewsCache();
    });

    it('findings segment', async () => {
      savePhoneLink(PH);
      useRpc();
      mount(h(LibraryScreen, {}));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('Findings');
      expect(text).toContain('Subscriptions');
      expect(text).toContain('Phone Pixel');
      expect(text).toContain('New episode S02E05');
      expect(text).toContain('Better quality: 1080p → 4K');
      expect(text).toContain('Subscription «Dune»');
      expect(text).toContain('OK — watch');
      expect(text).not.toMatch(CYR);
    });

    it('subscriptions segment', async () => {
      savePhoneLink(PH);
      useRpc();
      newsSeg.value = 'subs';
      mount(h(LibraryScreen, {}));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('Dune');
      expect(text).toContain('Severance');
      expect(text).toContain('2 new');
      expect(text).toContain('any quality');
      expect(text).toContain('Notify');
      expect(text).toContain('In better quality');
      expect(text).toContain('Check now');
      expect(text).toContain('Remove');
      expect(text).toContain('Find a subscription');
      expect(text).toContain('OK — toggle or choose');
      expect(text).not.toMatch(CYR);
    });

    it('no phone', async () => {
      mount(h(LibraryScreen, {}));
      await flush();
      const text = host.textContent || '';
      expect(text).toContain('run by OMP on the phone');
      expect(text).not.toMatch(CYR);
    });
  });

  it('Playlist', async () => {
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    mount(h(PlaylistScreen as any, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Playlist');
    expect(buttons(host)).toContain('Open');
    expect(buttons(host)).toContain('All server torrents');
    expect(text).not.toMatch(CYR);
  });

  it('Pair a phone', async () => {
    const s = addServer({ url: '192.168.1.191:5665', name: 'Home' });
    setActiveServer(s.id);
    mount(h(PairPhoneScreen, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Connect a phone');
    expect(buttons(host)).toContain('Done');
    expect(text).toContain('Scan QR from the TV');
    expect(text).not.toMatch(CYR);
  });

  it('Pair a phone without a server', () => {
    mount(h(PairPhoneScreen, {}));
    expect(host.textContent).toContain('Connect to a server first');
  });

  it('Marks dialog', async () => {
    mount(h(MarksDialog, { subtitle: 'Starbound Frontier', prefs: { mi: null, mc: null }, onSave: () => Promise.resolve(), onClose: () => undefined }));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Intro and credits');
    expect(text).toContain('Intro from');
    expect(text).toContain('Credits: last');
    expect(buttons(host)).toContain('Reset');
    expect(buttons(host)).toContain('Save');
    expect(text).not.toMatch(CYR);
    const aria = Array.prototype.map.call(host.querySelectorAll('[aria-label]'), (e: Element) => e.getAttribute('aria-label')).join('|');
    expect(aria).toContain('5 seconds less');
    expect(aria).not.toMatch(CYR);
  });

  it('Update dialog', async () => {
    updatePrompt.value = { version: '9.9.9', ipkUrl: 'https://x/a.ipk', ipkHash: 'd'.repeat(64), ipkSize: 0, notes: ['A'], releaseUrl: 'https://x/r' } as any;
    mount(h(UpdateDialog, {}));
    await flush();
    const text = host.textContent || '';
    expect(text).toContain('Version 9.9.9 available');
    expect(buttons(host)).toContain('Update');
    expect(buttons(host)).toContain('Later');
    expect(buttons(host)).toContain('Skip this version');
    expect(text).not.toMatch(CYR);
  });

  it("What's new dialog without entries", async () => {
    whatsNew.value = { title: 'What’s new', auto: false, entries: [] };
    mount(h(WhatsNewDialog, {}));
    await flush();
    expect(host.textContent).toContain('The list of changes is unavailable');
    expect(host.textContent).not.toMatch(CYR);
  });

  it('confirmDialog defaults', async () => {
    mount(h(DialogHost, {}));
    act(() => { confirmDialog('Sure?'); });
    await flush();
    const opts = Array.prototype.map.call(host.querySelectorAll('.dialog-option'), (o: Element) => (o.textContent || '').trim());
    expect(opts).toEqual(['Yes', 'Cancel']);
  });
});
