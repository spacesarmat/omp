// «Аудиокниги»: the section, «Мои книги», the book card, and the search that asks for audiobooks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { Audiobooks } from '../src/audiobooks/Audiobooks';
import { AudiobookSearch, resetAudiobookSearch } from '../src/audiobooks/Search';
import { MyBooks } from '../src/audiobooks/MyBooks';
import { Book } from '../src/audiobooks/Book';
import { AudioPlayer } from '../src/audiobooks/Player';
import { audioLaunch, audioNow, setAudioBridge, setAudioLaunch, type AudioBridge } from '../src/audiobooks/launch';
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
  setAudioBridge(null);
  resetAudiobookSearch();
  audioNow.value = null;
  audioLaunch.value = null;
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
    expect(playEmbedded).not.toHaveBeenCalled();
    expect(currentRoute.value.name).toBe('audiobookPlayer');
    const q = audioLaunch.value;
    expect(q && q.start).toBe(2);
    expect(q && q.items.map((item) => item.fileId)).toEqual([4, 3, 2, 1]);
    expect(q && q.items[2].url).toContain('index=2');
    expect(q && q.items[2].title).toBe('01');
    expect(q && q.positionMs).toBe(0);
    expect(q && q.items.every((item) => item.startMs === 0 && item.endMs === 0)).toBe(true);
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
    const q = audioLaunch.value;
    expect(q && q.positionMs).toBe(90000);
    expect(q && q.start).toBe(1);
    expect(q && q.items.map((item) => item.title)).toEqual(['Пролог', 'Глава первая']);
    expect(q && q.items[1].startMs).toBe(90000);
    expect(q && q.items[1].endMs).toBe(200000);
    expect(q && q.items[1].url).toContain('index=3');
    expect(currentRoute.value.name).toBe('audiobookPlayer');
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

  it('the player screen speaks Russian and sends ±30s, speed and the sleep timer', async () => {
    const calls: { cmd: string; ms?: number; speed?: number; sleep?: string }[] = [];
    const bridge: AudioBridge = {
      prepare: () => Promise.resolve(),
      play: () => Promise.resolve(null),
      control: (c) => {
        calls.push(c);
        return Promise.resolve({
          active: true,
          playing: c.cmd === 'toggle' || c.cmd === 'play',
          index: 0,
          positionMs: 1000,
          durationMs: 60000,
          speed: c.speed || 1,
          sleep: c.sleep || 'off',
          sleepLeftMs: c.sleep === '30' ? 90000 : 0,
          count: 1,
          title: '01',
          book: 'Мастер',
          hash: HASH,
          fileId: 4,
        });
      },
      state: () => Promise.resolve(null),
      onState: () => () => undefined,
    };
    setAudioBridge(bridge);
    const q = setAudioLaunch({
      hash: HASH,
      book: 'Мастер и Маргарита',
      start: 0,
      positionMs: 0,
      items: [{ url: 'http://127.0.0.1:8090/stream/2.flac?index=4&play', title: '2', fileId: 4, startMs: 0, endMs: 0 }],
    });
    resetTo({ name: 'audiobookPlayer', hash: HASH, token: q.token });
    mount(<AudioPlayer hash={HASH} token={q.token} />);
    await flush();
    expect(el.querySelector('[data-audio-place]')!.textContent).toBe('Трек 1 из 1');
    expect(el.querySelector('[data-audio-title]')!.textContent).toBe('2');
    expect(el.querySelector('[data-audio-row="chapters"]')).toBeTruthy();
    expect(el.querySelector('[data-audio-row="main"] [data-audio="toggle"]')).toBeTruthy();
    expect(el.querySelector('[data-audio-speed] button')!.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('[data-audio-speed] [aria-checked="true"]')!.textContent).toBe('1×');
    expect(el.textContent).toContain('−30 с');
    expect(el.textContent).toContain('Скорость');
    expect(el.textContent).toContain('Таймер сна');
    expect(el.textContent).toContain('До конца главы');
    await act(async () => {
      (el.querySelector('[data-audio="forward"]') as HTMLButtonElement).click();
      (el.querySelector('[data-audio-speed] button') as HTMLButtonElement).click();
      (el.querySelector('[data-sleep="30"]') as HTMLButtonElement).click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(calls.map((c) => c.cmd)).toEqual(['seek', 'speed', 'sleep']);
    expect(calls[0].ms).toBe(30000);
    expect(calls[1].speed).toBe(0.5);
    expect(calls[2].sleep).toBe('30');
    expect(el.querySelector('[data-sleep="30"]')!.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-sleep-label]')!.textContent).toContain('1:30');
  });

  it('a missing file list asks to retry and does not remove the torrent', async () => {
    torrents.value = [bookTorrent({ file_stats: undefined, stat: 1, stat_string: 'Torrent getting info' })];
    const get = vi.spyOn(TorrServerClient.prototype, 'get').mockRejectedValue(new Error('timeout'));
    const loadInfo = vi.spyOn(TorrServerClient.prototype, 'loadInfo');
    const remove = vi.spyOn(TorrServerClient.prototype, 'remove').mockResolvedValue();
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue(bookTorrent());
    mount(<Book hash={HASH} />);
    await flush();
    expect(loadInfo).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(el.querySelector('[data-files="timeout"]')!.textContent).toContain('Не удалось получить список файлов — мало сидов');
    expect(el.textContent).not.toContain('В раздаче нет звуковых файлов');
    get.mockResolvedValue(bookTorrent());
    act(() => {
      (el.querySelector('[data-files="retry"]') as HTMLButtonElement).click();
    });
    await flush();
    await flush();
    expect(add).toHaveBeenCalled();
    expect(get.mock.calls.length).toBeGreaterThan(1);
    expect(el.querySelector('[data-track="Автор/CD1/2.flac"]')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    expect(loadInfo).not.toHaveBeenCalled();
  });

  it('a list that really has no audio says so, and sizes use МБ', async () => {
    torrents.value = [bookTorrent({ file_stats: undefined, stat: 5 })];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(
      bookTorrent({
        stat: 3,
        file_stats: files([{ id: 1, path: 'cover.jpg', length: 5 * 1024 * 1024 }]),
      }),
    );
    mount(<Book hash={HASH} />);
    await flush();
    expect(el.querySelector('[data-empty="audio"]')!.textContent).toBe('В раздаче нет звуковых файлов');
    torrents.value = [
      bookTorrent({
        file_stats: files([{ id: 4, path: 'Автор/CD1/2.flac', length: 5 * 1024 * 1024 }]),
      }),
    ];
    mount(<Book hash={HASH} />);
    await flush();
    expect(el.textContent).toContain('МБ');
    expect(el.textContent).not.toContain('MB');
  });

  it('highlights the playing track and opens it again without a new queue', async () => {
    torrents.value = [bookTorrent()];
    const launch = setAudioLaunch({
      hash: HASH,
      book: 'Мастер',
      start: 0,
      positionMs: 5000,
      items: [{ url: 'http://127.0.0.1:8090/a', title: '2', fileId: 4, startMs: 0, endMs: 0 }],
    });
    audioNow.value = { hash: HASH, token: launch.token, index: 0, fileId: 4, startMs: 0, active: true };
    const play = vi.fn();
    setAudioBridge({
      prepare: () => Promise.resolve(),
      play,
      control: () => Promise.resolve(null),
      state: () => Promise.resolve(null),
      onState: () => () => undefined,
    });
    mount(<Book hash={HASH} />);
    await flush();
    const row = el.querySelector('[data-track="Автор/CD1/2.flac"]') as HTMLButtonElement;
    expect(row.hasAttribute('data-playing')).toBe(true);
    await act(async () => {
      row.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(play).not.toHaveBeenCalled();
    expect(audioLaunch.value && audioLaunch.value.token).toBe(launch.token);
    expect(currentRoute.value).toEqual({ name: 'audiobookPlayer', hash: HASH, token: launch.token });
  });

  it('keeps the audiobook search after leaving the book card', async () => {
    const title = 'Сапковский Анджей - Ведьмак (аудиокнига)';
    registerSource({
      id: 'fake-audio',
      name: 'Фейк',
      kind: 'builtin',
      search: () => Promise.resolve([
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
      ]),
    });
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
    expect(el.querySelector('.m-result')!.getAttribute('data-title')).toBe(title);
    const phone = el.querySelector('[aria-label^="Добавить и слушать на телефоне"]') as HTMLButtonElement;
    expect(phone.classList.contains('m-rc-btn-tv')).toBe(true);
    act(() => render(null, el));
    mount(<AudiobookSearch />);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('ведьмак');
    expect(el.querySelector('.m-result')!.getAttribute('data-title')).toBe(title);
  });

  it('Слушать after an error asks the player to prepare again', async () => {
    const calls: string[] = [];
    setAudioBridge({
      prepare: () => Promise.resolve(),
      play: () => Promise.resolve({
        active: true,
        playing: false,
        index: 0,
        positionMs: 0,
        durationMs: 0,
        speed: 1.5,
        sleep: 'off',
        sleepLeftMs: 0,
        count: 1,
        title: '2',
        book: 'Мастер',
        hash: HASH,
        fileId: 4,
        error: 'Не удалось воспроизвести',
      }),
      control: (c) => {
        calls.push(c.cmd);
        return Promise.resolve(null);
      },
      state: () => Promise.resolve(null),
      onState: () => () => undefined,
    });
    const q = setAudioLaunch({
      hash: HASH,
      book: 'Мастер',
      start: 0,
      positionMs: 0,
      items: [{ url: 'http://127.0.0.1:8090/a', title: '2', fileId: 4, startMs: 0, endMs: 0 }],
    });
    mount(<AudioPlayer hash={HASH} token={q.token} />);
    await flush();
    await act(async () => {
      (el.querySelector('[data-audio="toggle"]') as HTMLButtonElement).click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(calls).toEqual(['play']);
  });

  it('opening the current item does not start the queue again', async () => {
    const play = vi.fn().mockResolvedValue(null);
    const state = vi.fn().mockResolvedValue({
      active: true,
      playing: true,
      index: 0,
      positionMs: 40000,
      durationMs: 60000,
      speed: 1.5,
      sleep: '30',
      sleepLeftMs: 1000,
      count: 1,
      title: '2',
      book: 'Мастер',
      hash: HASH,
      fileId: 4,
    });
    setAudioBridge({
      prepare: () => Promise.resolve(),
      play,
      control: () => Promise.resolve(null),
      state,
      onState: () => () => undefined,
    });
    const q = setAudioLaunch({
      hash: HASH,
      book: 'Мастер',
      start: 0,
      positionMs: 0,
      items: [{ url: 'http://127.0.0.1:8090/a', title: '2', fileId: 4, startMs: 0, endMs: 0 }],
    });
    audioNow.value = { hash: HASH, token: q.token, index: 0, fileId: 4, startMs: 0, active: true };
    mount(<AudioPlayer hash={HASH} token={q.token} />);
    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(state).toHaveBeenCalled();
  });
});
