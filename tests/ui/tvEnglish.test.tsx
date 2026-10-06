import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
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
import { TorrServerClient } from '../../src/api/torrserver';
import { mockFetch } from '../helpers/fetchMock';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
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
    expect(labels).toContain('Add');
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
    expect(text).toContain('Add a torrent');
    expect(buttons(host)).toContain('Add');
    expect(buttons(host)).toContain('Search');
    expect(text).toContain('Source');
    expect(text).not.toMatch(CYR);
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
