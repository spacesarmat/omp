// «Аудиокниги»: the section, «Мои книги», the book card, and the search that asks for audiobooks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { Audiobooks } from '../src/audiobooks/Audiobooks';
import { AudiobookSearch } from '../src/audiobooks/Search';
import { MyBooks } from '../src/audiobooks/MyBooks';
import { Book } from '../src/audiobooks/Book';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import { addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { setWatchActions } from '../src/watch';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { applyLanguageSetting } from '../../src/i18n';
import type { SourceContext } from '../../src/sources/types';
import type { Torrent } from '../../src/api/types';

const HASH = 'ab'.repeat(20);

function files(list: { id: number; path: string; length?: number }[]) {
  return list.map((f) => ({ id: f.id, path: f.path, length: f.length || 1000 }));
}

const bookTorrent = (over: Partial<Torrent> = {}): Torrent => ({
  hash: HASH,
  title: 'Булгаков Михаил - Мастер и Маргарита',
  category: 'audiobook',
  stat: 3,
  timestamp: 5,
  file_stats: files([
    { id: 1, path: 'Автор/Диск 2/03.mp3' },
    { id: 2, path: 'Автор/Диск 2/01.mp3' },
    { id: 3, path: 'Автор/CD1/10.flac' },
    { id: 4, path: 'Автор/CD1/2.flac' },
    { id: 5, path: 'Автор/cover.jpg' },
  ]),
  ...over,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
const playEmbedded = vi.fn();

function mount(node: VNode) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

beforeEach(() => {
  localStorage.clear();
  applyLanguageSetting('ru');
  reloadSourcePrefs();
  resetHealth();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [];
  resetTo({ name: 'audiobooks' });
  playEmbedded.mockReset().mockResolvedValue({ returned: false });
  setWatchActions({
    embedded2160: async () => true,
    playEmbedded2160: playEmbedded,
    player2160: async () => null,
    recordWatch: vi.fn().mockResolvedValue(undefined),
    phoneName: async () => 'Pixel',
    remoteDelayMs: 0,
  });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(bookTorrent());
  vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockResolvedValue(bookTorrent());
  vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake-audio');
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('«Аудиокниги»', () => {
  it('opens from «Настройки» and offers search and «Мои книги»', () => {
    resetTo({ name: 'settings' });
    mount(<Settings />);
    const row = el.querySelector('[data-row="audiobooks"]') as HTMLButtonElement;
    expect(row.textContent).toContain('Аудиокниги');
    act(() => row.click());
    expect(currentRoute.value).toEqual({ name: 'audiobooks' });
    mount(<Audiobooks />);
    expect(el.querySelector('[data-row="audiobook-search"]')!.textContent).toContain('Найти');
    expect(el.querySelector('[data-row="audiobook-mine"]')!.textContent).toContain('Мои книги');
    act(() => (el.querySelector('[data-row="audiobook-mine"]') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'audiobookMine' });
  });

  it('«Мои книги» lists audiobook torrents and opens the book', () => {
    torrents.value = [
      { hash: 'mov', title: 'Дюна (2021)', category: 'movie', stat: 3, timestamp: 9 },
      bookTorrent(),
    ];
    mount(<MyBooks />);
    const rows = Array.from(el.querySelectorAll('[data-book]'));
    expect(rows.map((r) => r.getAttribute('data-book'))).toEqual([HASH]);
    expect(rows[0].textContent).toContain('Мастер и Маргарита');
    act(() => (rows[0] as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'audiobook', hash: HASH });
  });

  it('says when there are no books yet', () => {
    mount(<MyBooks />);
    expect(el.querySelector('[data-empty="mine"]')!.textContent).toBe('Пока нет аудиокниг');
  });

  it('lists audio files in listening order and plays the tapped track', async () => {
    torrents.value = [bookTorrent()];
    mount(<Book hash={HASH} />);
    await flush();
    expect(TorrServerClient.prototype.probe).not.toHaveBeenCalled();
    const tracks = Array.from(el.querySelectorAll('[data-track]')).map((n) => n.getAttribute('data-track'));
    expect(tracks).toEqual(['Автор/CD1/2.flac', 'Автор/CD1/10.flac', 'Автор/Диск 2/01.mp3', 'Автор/Диск 2/03.mp3']);
    expect(el.textContent).toContain('CD1');
    expect(el.textContent).toContain('Диск 2');
    expect(el.textContent).not.toContain('cover.jpg');
    await act(async () => {
      (el.querySelector('[data-track="Автор/Диск 2/01.mp3"]') as HTMLButtonElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(playEmbedded).toHaveBeenCalled();
    const opts = playEmbedded.mock.calls[0][0];
    expect(opts.items[opts.start].url).toContain('index=2');
    expect(opts.fromStart).toBe(true);
  });

  it('lists chapters of a single m4b from ffprobe and starts the player at the chapter', async () => {
    const m4b = bookTorrent({
      file_stats: files([
        { id: 3, path: 'Book/Мастер.m4b', length: 50000000 },
        { id: 4, path: 'Book/cover.jpg' },
      ]),
    });
    torrents.value = [m4b];
    vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({
      streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }],
      chapters: [
        { start_time: '0', end_time: '90', tags: { title: 'Пролог' } },
        { start_time: '90', end_time: '200', tags: { title: 'Глава первая' } },
      ],
    });
    mount(<Book hash={HASH} />);
    await flush();
    expect(el.querySelector('[data-chapters]')!.textContent).toContain('Пролог');
    expect(el.querySelector('[data-chapters]')!.textContent).toContain('Глава первая');
    expect(el.querySelector('[data-chapters]')!.textContent).toContain('с 1:30');
    await act(async () => {
      (Array.from(el.querySelectorAll('[data-chapters] button'))[1] as HTMLButtonElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    const opts = playEmbedded.mock.calls[0][0];
    expect(opts.positionMs).toBe(90000);
    expect(opts.fromStart).toBe(false);
    expect(opts.items[opts.start].url).toContain('index=3');
  });

  it('searches with searchMode audiobook and files an added book as an audiobook', async () => {
    const modes: string[] = [];
    const title = 'Сапковский Анджей - Ведьмак (аудиокнига)';
    registerSource({
      id: 'fake-audio',
      name: 'Фейк',
      kind: 'builtin',
      search: (_q: string, ctx: SourceContext) => {
        modes.push(ctx.searchMode || '');
        return Promise.resolve([
          {
            Title: title,
            Categories: '3030',
            Size: '500 MB',
            CreateDate: '',
            Tracker: 'rutracker',
            Link: '',
            Magnet: 'magnet:?xt=urn:btih:' + HASH,
            Hash: HASH,
            Peer: 1,
            Seed: 4,
            source: 'fake-audio',
          },
          {
            Title: 'Дюна (2021) BDRip',
            Categories: '',
            Size: '10 GB',
            CreateDate: '',
            Tracker: 'rutor',
            Link: '',
            Magnet: 'magnet:?xt=urn:btih:' + 'c'.repeat(40),
            Hash: 'c'.repeat(40),
            Peer: 1,
            Seed: 30,
            source: 'fake-audio',
          },
        ]);
      },
    });
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH, title, category: 'audiobook' } as Torrent);
    mount(<AudiobookSearch />);
    const input = el.querySelector('input') as HTMLInputElement;
    act(() => {
      input.value = 'ведьмак';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(modes).toEqual(['audiobook']);
    const titles = Array.from(el.querySelectorAll('.m-result')).map((n) => n.getAttribute('data-title'));
    expect(titles).toEqual([title]);
    await act(async () => {
      (el.querySelector('[aria-label^="Добавить на сервер"]') as HTMLButtonElement).click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(add).toHaveBeenCalled();
    expect(add.mock.calls[0][0]).toMatchObject({ category: 'audiobook' });
  });
});
