import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { DialogHost, confirmDialog } from '../../src/ui/dialog';
import { Focusable } from '../../src/ui/components';
import { nextRowKey, focusAfterClose } from '../../src/ui/focus';
import { dispatchKey } from '../../src/ui/keys';
import { OnboardingScreen } from '../../src/ui/OnboardingScreen';
import { LibraryScreen } from '../../src/screens/Library';
import { TorrentScreen } from '../../src/screens/Torrent';
import { scrollStep } from '../../src/screens/Faq';
import { posterImageSize, backdropImageSize } from '../../src/catalog/tmdb';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, resetLibrary } from '../../src/store/library';
import { routeStack } from '../../src/ui/nav';
import { TorrServerClient } from '../../src/api/torrserver';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { mockFetch } from '../helpers/fetchMock';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('settings D-pad rows', () => {
  const rows = [
    ['set-subBackground'],
    ['set-server', 'set-pair'],
    ['set-sources'],
    ['set-live-seeds'],
    ['set-update-check'],
    ['set-update', 'set-addHbRepo', 'set-faq', 'set-advanced'],
    ['set-onboarding'],
  ];

  it('moves to the neighbour in the same column, both ways', () => {
    expect(nextRowKey(rows, 'set-subBackground', 'down')).toBe('set-server');
    expect(nextRowKey(rows, 'set-update-check', 'down')).toBe('set-update');
    expect(nextRowKey(rows, 'set-update', 'up')).toBe('set-update-check');
    expect(nextRowKey(rows, 'set-update', 'right')).toBe('set-addHbRepo');
    expect(nextRowKey(rows, 'set-advanced', 'left')).toBe('set-faq');
    expect(nextRowKey(rows, 'set-pair', 'down')).toBe('set-sources');
    expect(nextRowKey(rows, 'set-subBackground', 'right')).toBeNull();
    expect(nextRowKey(rows, 'set-onboarding', 'down')).toBeUndefined();
    expect(nextRowKey(rows, 'set-subBackground', 'up')).toBeUndefined();
  });
});

describe('confirm dialog', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(DialogHost, {}), host));
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  it('focuses Cancel and paints the action as danger; Back cancels', async () => {
    let result: boolean | 'pending' = 'pending';
    act(() => { confirmDialog('Выйти из приложения?').then((v) => { result = v; }); });
    await flush();
    const danger = host.querySelector('.dialog-option.danger') as HTMLElement;
    expect((danger.textContent || '').trim()).toBe('Да');
    expect(host.querySelector('.dialog-option.current')!.textContent).toContain('Отмена');
    expect(getCurrentFocusKey()).toBe('dialog-opt-1');
    await act(async () => { dispatchKey('back', new KeyboardEvent('keydown')); });
    await flush();
    expect(result).toBe(false);
    expect(host.querySelector('.dialog-backdrop')).toBeNull();
  });
});

describe('focus after an overlay closes', () => {
  let host: HTMLElement;
  function mount(tour: boolean) {
    act(() => render(h('div', { class: 'screen-host' },
      h('div', { class: 'screen' },
        h(Focusable, { focusKey: 'set-onboarding' }, 'tour'),
        h(Focusable, { focusKey: 'set-faq' }, 'faq'),
      ),
      tour ? h(OnboardingScreen, {}) : null,
    ), host));
  }
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  it('returns to the preferred key', async () => {
    mount(false);
    await flush();
    setFocus('set-faq');
    focusAfterClose('set-onboarding');
    await tick();
    expect(getCurrentFocusKey()).toBe('set-onboarding');
  });

  it('returns to the settings tour button when the tour unmounts', async () => {
    mount(false);
    await flush();
    setFocus('set-onboarding');
    mount(true);
    await flush();
    expect(host.querySelector('.onboarding-host')).not.toBeNull();
    mount(false);
    await tick();
    expect(host.querySelector('.onboarding-host')).toBeNull();
    expect(getCurrentFocusKey()).toBe('set-onboarding');
  });
});

describe('library search covers every category', () => {
  let host: HTMLElement;
  beforeEach(async () => {
    localStorage.clear();
    resetLibrary();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: '10.0.0.5' }).id);
    const items = [
      { hash: 'm1', title: 'Alpha movie', category: 'movie', timestamp: 2 },
      { hash: 'b1', title: 'Quiet book', category: 'audiobook', timestamp: 1 },
    ] as any;
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(items);
    mockFetch(() => ({ body: '[]' }));
    torrents.value = items;
    libraryTab.value = 'music';
    librarySearchOpen.value = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(LibraryScreen, {}), host));
    await flush();
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    resetLibrary();
    vi.restoreAllMocks();
  });

  it('finds a film while «Музыка» is open and names the query when nothing matches', async () => {
    libraryQuery.value = 'alpha';
    await flush();
    const count = host.querySelector('.search-count')!.textContent || '';
    expect(count).toContain('Найдено: 1');
    expect(count).toContain('вся библиотека');
    expect(host.textContent).toContain('Alpha movie');
    libraryQuery.value = 'zzzz';
    await flush();
    expect(host.querySelector('.empty')!.textContent).toBe('Ничего не найдено по запросу «zzzz»');
    libraryQuery.value = '';
    await flush();
    expect(host.querySelector('.empty')!.textContent).toBe('В этой категории пока ничего нет');
    expect(host.querySelector('.search-count')!.textContent).not.toContain('вся библиотека');
  });
});

describe('play label and skip panel', () => {
  let host: HTMLElement;
  const book: Torrent = {
    hash: 'book1',
    title: 'Тихий голос / Quiet Voice',
    category: 'audiobook',
    stat: 3,
    file_stats: [{ id: 1, path: 'voice.mp3', length: 1e6 }],
  };
  beforeEach(() => {
    localStorage.clear();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    routeStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'book1' }];
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(book);
    setCatalogProvider(() => Promise.resolve({ search: () => Promise.resolve({ items: [], pages: 0 }), card: () => Promise.resolve(null) } as any));
    torrents.value = [book];
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    setCatalogProvider(null);
    vi.restoreAllMocks();
  });

  it('an audiobook says Listen and has no intro/credits panel', async () => {
    act(() => render(h(TorrentScreen, { hash: 'book1' }), host));
    await flush();
    const play = host.querySelector('[data-fk="torrent-play"]');
    expect(play).not.toBeNull();
    expect((play!.textContent || '').trim()).toBe('Слушать');
    expect(host.querySelector('.skip-block')).toBeNull();
    expect(host.querySelector('.hints')!.textContent).toContain('OK — слушать');
  });
});

describe('FAQ answer scroll', () => {
  it('steps until the edge, then lets the remote move on', () => {
    expect(scrollStep(0, 200, 200, 'down')).toBeNull();
    expect(scrollStep(0, 200, 800, 'down')).toBe(160);
    expect(scrollStep(600, 200, 800, 'down')).toBeNull();
    expect(scrollStep(160, 200, 800, 'up')).toBe(0);
    expect(scrollStep(0, 200, 800, 'up')).toBeNull();
  });
});

describe('TMDB image sizes', () => {
  it('uses w500 and w1280 at 1080p, and the larger files on a 4K panel', () => {
    expect(posterImageSize(1)).toBe('w500');
    expect(posterImageSize(2)).toBe('w780');
    expect(backdropImageSize(1)).toBe('w1280');
    expect(backdropImageSize(2)).toBe('original');
  });
});

describe('TV audit stylesheet', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  it('keeps the sofa-distance sizes, the danger confirm and the safe padding', () => {
    expect(css).toContain('.dialog-option.danger.focused');
    expect(css).toContain('.player-error .error-view .message { font-size: 44px;');
    expect(css).toContain('.player-error .details { font-size: 28px;');
    expect(css).toContain('.screen.library { padding-left: 96px; padding-right: 96px; }');
    expect(css).toContain('.torrent-actions-row { flex-wrap: wrap; }');
    expect(css).toContain('.screen.settings { padding: 48px 96px 180px; }');
    expect(css).toContain('.tile-small .tile-title { font-size: 28px;');
    expect(css).toContain('.connect-body { width: 980px;');
    expect(css).toContain('.faq-body-scroll { height: 100%; overflow-y: auto;');
  });
});
