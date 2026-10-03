import { TV_NO_OMP } from '../src/tv/tvClient';
import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Torrent } from '../src/screens/Torrent';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { launchedAt, launching, setPlayerLinkDeps } from '../src/tv/playerLink';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent as T } from '../../src/api/types';
import { addFindings, findingsOf } from '../../src/monitor/subs';

const EPS = ['Show.S02E01.mkv', 'Show.S02E02.mkv', 'Show.S02E03.mkv', 'Show.S02E04.mkv'];
const tor: T = {
  hash: 'abc',
  title: 'Starbound Frontier S02 1080p WEB-DL',
  category: 'tv',
  stat: 3,
  torrent_size: 18 * 1024 ** 3,
  total_peers: 12,
  file_stats: EPS.map((p, i) => ({ id: i + 1, path: p, length: 1900000000 })),
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
const launch = vi.fn();
const open = vi.fn();
const copy = vi.fn();
const record = vi.fn();

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Torrent hash="abc" />, el));
}

function click(sel: string | Element | undefined | null) {
  const n = typeof sel === 'string' ? el.querySelector(sel) : sel;
  if (!n) throw new Error('missing ' + sel);
  act(() => (n as HTMLElement).click());
}

const byText = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text));

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [tor];
  serverViewed.value = [];
  toast.value = '';
  launch.mockReset().mockResolvedValue(undefined);
  open.mockReset().mockResolvedValue(undefined);
  copy.mockReset().mockResolvedValue(undefined);
  record.mockReset().mockResolvedValue(undefined);
  setWatchActions({ recordWatch: record, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, openExternal: open, copyText: copy, remoteDelayMs: 0 });
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: 'abc' });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
});

afterEach(() => {
  act(() => render(null, el));
  setPlayerLinkDeps(null);
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('Torrent', () => {
  it('shows header meta and an episode row per file', async () => {
    mount();
    await flush();
    expect(el.querySelector('.m-thead-title')!.textContent).toBe('Starbound Frontier');
    expect(el.querySelector('.m-thead-meta')!.textContent).toBe('Сезон 2 · 4 серии · 18.0 GB · 12 пиров');
    const rows = el.querySelectorAll('.m-ep');
    expect(rows.length).toBe(4);
    expect(rows[2].textContent).toContain('S02E03');
  });

  it('main button resumes the last position', async () => {
    saveProgress('abc', 3, 1394, 3600);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    await flush();
    const main = el.querySelector('.m-btn-primary') as HTMLElement;
    expect(main.textContent).toContain('Продолжить на ТВ · S02E03 с 23:14');
    click(main);
    await flush();
    click(byText('Продолжить с 23:14'));
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 3, t: 1394, from: 'Телефон' });
    // watch journal: one entry for this phone after the launch, with the chosen position
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][2]).toEqual({ f: 3, t: 1394, d: 3600, src: 'phone', name: 'Телефон' });
  });

  it('main button says «Смотреть на ТВ» with no history', async () => {
    mount();
    await flush();
    expect(el.querySelector('.m-btn-primary')!.textContent).toContain('Смотреть на ТВ');
  });

  it('tapping an episode opens the sheet with three options', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[3]);
    expect(el.querySelector('[role=dialog]')).toBeTruthy();
    const opts = el.querySelectorAll('.m-opt');
    expect(opts.length).toBe(3);
    expect(opts[0].textContent).toContain('На телевизоре LG OLED');
    expect(opts[1].textContent).toContain('На телефоне');
    expect(opts[2].textContent).toContain('Скопировать ссылку на поток');
  });

  it('«На телевизоре» launches with watch params and then opens the remote', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    saveProgress('abc', 4, 500, 3000);
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[3]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
    click(byText('Продолжить с 8:20'));
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 500, from: 'Телефон' });
    expect(el.querySelector('.m-status-ok')!.textContent).toBe('Запустил на LG OLED');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(currentRoute.value.name).toBe('nowPlaying');
  });

  it('shows TV errors in the sheet and stays', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    launch.mockRejectedValue(new Error('На телевизоре нет OMP'));
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[0]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
    expect(el.querySelector('.m-status-err')!.textContent).toContain('На телевизоре нет OMP');
    expect(currentRoute.value.name).toBe('torrent');
    expect(record).not.toHaveBeenCalled();
  });

  it('without a TV the first option leads to the TV screen', async () => {
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[0]);
    click(el.querySelectorAll('.m-opt')[0]);
    expect(launch).not.toHaveBeenCalled();
    expect(currentRoute.value.name).toBe('tv');
  });

  it('phone option opens the external player with the stream URL', async () => {
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[1]);
    click(el.querySelectorAll('.m-opt')[1]);
    await flush();
    expect(open).toHaveBeenCalledWith('http://srv:8090/stream/Show.S02E02.mkv?link=abc&index=2&play', 'video/*');
    // watch journal: started on this phone
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1]).toBe('abc');
    expect(record.mock.calls[0][2]).toEqual({ f: 2, t: 0, d: 0, src: 'phone', name: 'Телефон' });
  });

  it('copy option writes the stream URL to the clipboard and toasts', async () => {
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[1]);
    click(el.querySelectorAll('.m-opt')[2]);
    await flush();
    expect(copy).toHaveBeenCalledWith('http://srv:8090/stream/Show.S02E02.mkv?link=abc&index=2&play');
    expect(toast.value).toBe('Ссылка скопирована');
  });

  it('«Смотреть на телефоне» opens the external player', async () => {
    mount();
    await flush();
    click(byText('Смотреть на телефоне'));
    await flush();
    expect(open).toHaveBeenCalledWith('http://srv:8090/stream/Show.S02E01.mkv?link=abc&index=1&play', 'video/*');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][2]).toMatchObject({ f: 1, src: 'phone' });
  });

  it('no journal entry when the external player fails to open', async () => {
    open.mockRejectedValueOnce(new Error('Нет плеера'));
    mount();
    await flush();
    click(byText('Смотреть на телефоне'));
    await flush();
    expect(record).not.toHaveBeenCalled();
  });

  it('delete asks for confirmation, removes and goes back', async () => {
    const rem = vi.spyOn(TorrServerClient.prototype, 'remove').mockResolvedValue(undefined);
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    mount();
    await flush();
    click('[aria-label="Удалить раздачу"]');
    expect(rem).not.toHaveBeenCalled();
    click('[aria-label="Удалить раздачу"]');
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(rem).toHaveBeenCalledWith('abc');
    expect(currentRoute.value.name).toBe('library');
  });

  it('delete drops the «Новые серии» card of that torrent', async () => {
    vi.spyOn(TorrServerClient.prototype, 'remove').mockResolvedValue(undefined);
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const r = { Title: 'x', Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 1, source: 'rutor' };
    addFindings([{ subId: 'episodes', key: 'abc:1:10', at: 1, result: r, episodes: { torrentHash: 'abc', torrentTitle: 't', season: 1, haveTo: 8, to: 10 } }]);
    mount();
    await flush();
    click('[aria-label="Удалить раздачу"]');
    await flush();
    expect(findingsOf('episodes')).toEqual([]);
  });

  it('back button returns', async () => {
    mount();
    await flush();
    click('[aria-label="Назад"]');
    expect(currentRoute.value.name).toBe('library');
  });

  it('skips the remote jump when the user left the screen', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[0]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
    act(() => navigate({ name: 'settings' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(currentRoute.value.name).toBe('settings');
  });

  it('ignores repeated taps while a launch is in flight', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    let release!: () => void;
    launch.mockReturnValue(new Promise<void>((r) => (release = r)));
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[0]);
    const btn = el.querySelectorAll('.m-opt')[0];
    click(btn);
    click(btn);
    await flush();
    expect(launch).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it('warns about credentials and offers a link without them', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090', user: 'u', password: 'p' }).id);
    torrents.value = [tor];
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[1]);
    const opts = el.querySelectorAll('.m-opt');
    expect(opts.length).toBe(4);
    expect(opts[2].textContent).toContain('Ссылка содержит логин и пароль сервера');
    expect(opts[3].textContent).toContain('Скопировать без пароля');
    click(opts[2]);
    await flush();
    expect(copy).toHaveBeenLastCalledWith('http://u:p@srv:8090/stream/Show.S02E02.mkv?link=abc&index=2&play');
    expect(toast.value).toBe('Ссылка скопирована (с логином и паролем)');
    click(el.querySelectorAll('.m-ep')[1]);
    click(el.querySelectorAll('.m-opt')[3]);
    await flush();
    expect(copy).toHaveBeenLastCalledWith('http://srv:8090/stream/Show.S02E02.mkv?link=abc&index=2&play');
  });

  it('delete failure toasts and stays', async () => {
    vi.spyOn(TorrServerClient.prototype, 'remove').mockRejectedValue(new Error('boom'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();
    click('[aria-label="Удалить раздачу"]');
    await flush();
    expect(toast.value).toContain('boom');
    expect(currentRoute.value.name).toBe('torrent');
    expect(torrents.value.length).toBe(1);
  });

  it('delete does not go back if the user already left', async () => {
    let done!: () => void;
    vi.spyOn(TorrServerClient.prototype, 'remove').mockReturnValue(new Promise<void>((r) => (done = r)));
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();
    click('[aria-label="Удалить раздачу"]');
    act(() => navigate({ name: 'settings' }));
    done();
    await flush();
    expect(currentRoute.value.name).toBe('settings');
  });

  it('shows the install guide button when the TV has no OMP', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    launch.mockRejectedValueOnce(new Error(TV_NO_OMP));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[3]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
    const b = byText('Как установить OMP на телевизор')!;
    expect(b).toBeTruthy();
    click(b);
    expect(open).toHaveBeenCalledWith('https://github.com/spacesarmat/omp#readme', '_system');
    open.mockRestore();
  });

  it('main button error with no OMP offers the guide too', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    launch.mockRejectedValueOnce(new Error(TV_NO_OMP));
    mount();
    await flush();
    click(el.querySelector('.m-btn-primary')!);
    await flush();
    expect(byText('Как установить OMP на телевизор')).toBeTruthy();
  });
});

describe('Torrent poster button', () => {
  const btn = () => el.querySelector('button[aria-label="Найти обложку"]') as HTMLButtonElement | null;

  it('finds a poster on demand and the button goes away', async () => {
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'k' });
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
    const setPoster = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ poster_path: '/s.jpg' }] }))));
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    mount();
    await flush();
    click(btn());
    await flush();
    await flush();
    expect(setPoster).toHaveBeenCalledWith(expect.objectContaining({ hash: 'abc' }), 'https://imagetmdb.com/t/p/w300/s.jpg');
    expect(toast.value).toBe('Обложка найдена');
    expect(btn()).toBeNull();
  });

  it('asks for the TMDB key when the server has none', async () => {
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: '' });
    mount();
    await flush();
    click(btn());
    await flush();
    expect(toast.value).toBe('Задайте ключ TMDB в «Настройках сервера»');
  });

  it('is hidden when the torrent has a poster', async () => {
    torrents.value = [{ ...tor, poster: 'http://p/x.jpg' }];
    mount();
    await flush();
    expect(btn()).toBeNull();
  });
});

describe('Torrent not in the list yet', () => {
  it('asks the server and shows it', async () => {
    torrents.value = [];
    const get = vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
    mount();
    expect(el.textContent).toContain('Загружаю…');
    await flush();
    expect(get).toHaveBeenCalledWith('abc');
    expect(el.querySelector('.m-thead-title')!.textContent).toBe('Starbound Frontier');
  });

  it('loads the skip settings once the torrent is known', async () => {
    torrents.value = [];
    const withSkip = { ...tor, data: JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false } } }) };
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(withSkip);
    // the library list catches up only after the card asked the server for the torrent
    const list = vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    mount();
    expect(list).not.toHaveBeenCalled();
    list.mockResolvedValue([withSkip]);
    await flush();
    await flush();
    const sw = el.querySelector('button[role="switch"][aria-label="Пропускать заставку"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('says not found only when the server has no such torrent', async () => {
    torrents.value = [];
    vi.spyOn(TorrServerClient.prototype, 'get').mockRejectedValue(new Error('404'));
    mount();
    await flush();
    expect(el.textContent).toContain('Раздача не найдена');
  });
});

describe('TV launch flow', () => {
  const open1 = async () => {
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[3]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
  };

  it('launches an episode without a saved position straight away with t: 0 and the report url', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ recordWatch: record, ompVersion: async () => '0.8.0', reportUrl: async () => 'http://192.168.1.9:8123/p', launchOnTv: launch, remoteDelayMs: 0 });
    await open1();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 0, report: 'http://192.168.1.9:8123/p', from: 'Телефон' });
    expect(el.textContent).not.toContain('Откуда смотреть');
    expect(launchedAt.value).toBeGreaterThan(0);
    expect(launching.value).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(currentRoute.value.name).toBe('nowPlaying');
  });

  it('«Сначала» launches from the start', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    saveProgress('abc', 4, 500, 3000);
    await open1();
    const dlg = el.querySelectorAll('[role=dialog]')[1];
    expect(dlg.textContent).toContain('S02E04 · Show.S02E04 · на LG OLED');
    expect(dlg.textContent).toContain('Осталось 42 мин');
    click(byText('Сначала'));
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 0, from: 'Телефон' });
  });

  it('omits «Осталось» when the duration is unknown', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([{ hash: 'abc', file_index: 4, timecode: 500 } as any]);
    await open1();
    expect(el.textContent).toContain('Продолжить с 8:20');
    expect(el.textContent).not.toContain('Осталось');
  });

  it('«Отмена» launches nothing and frees the button', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    saveProgress('abc', 4, 500, 3000);
    await open1();
    click(byText('Отмена'));
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect((el.querySelectorAll('.m-opt')[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('an old TV shows the update dialog; «Всё равно запустить» continues', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ recordWatch: record, ompVersion: async () => '0.7.2', reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    await open1();
    expect(el.textContent).toContain('Обновите OMP на телевизоре');
    expect(el.textContent).toContain('На LG OLED стоит OMP 0.7.2.');
    expect(launch).not.toHaveBeenCalled();
    click(byText('Всё равно запустить'));
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 0, from: 'Телефон' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(currentRoute.value.name).toBe('remote');
    expect(launchedAt.value).toBe(0);
  });

  it('«Как обновить» opens the guide and keeps the dialog', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ recordWatch: record, ompVersion: async () => '0.7.2', reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    await open1();
    click(byText('Как обновить'));
    expect(win).toHaveBeenCalledWith(expect.stringContaining('github.com'), '_system');
    expect(launch).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Обновите OMP на телевизоре');
  });

  it('an old TV then the resume choice: both steps in order', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    saveProgress('abc', 4, 500, 3000);
    setWatchActions({ recordWatch: record, ompVersion: async () => '0.7.2', reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    await open1();
    click(byText('Всё равно запустить'));
    await flush();
    expect(el.textContent).toContain('Откуда смотреть');
    click(byText('Продолжить с 8:20'));
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 500, from: 'Телефон' });
  });
});
