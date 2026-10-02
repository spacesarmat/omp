import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Torrent } from '../src/screens/Torrent';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent as T } from '../../src/api/types';

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
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
const launch = vi.fn();
const open = vi.fn();
const copy = vi.fn();

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
  setWatchActions({ launchOnTv: launch, openExternal: open, copyText: copy, remoteDelayMs: 0 });
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: 'abc' });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
});

afterEach(() => {
  act(() => render(null, el));
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
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 3, t: 1394 });
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
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'abc', file: 4, t: 500 });
    expect(el.querySelector('.m-status-ok')!.textContent).toContain('Запустил на LG OLED — пульт уже открыт');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(currentRoute.value.name).toBe('remote');
  });

  it('shows TV errors in the sheet and stays', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    launch.mockRejectedValue(new Error('На телевизоре нет OMP'));
    mount();
    await flush();
    click(el.querySelectorAll('.m-ep')[0]);
    click(el.querySelectorAll('.m-opt')[0]);
    await flush();
    expect(el.querySelector('.m-status-err')!.textContent).toBe('На телевизоре нет OMP');
    expect(currentRoute.value.name).toBe('torrent');
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
});
