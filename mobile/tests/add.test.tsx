import { TV_NO_OMP } from '../src/tv/tvClient';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Add, normalizeLink } from '../src/screens/Add';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

const HASH = 'a'.repeat(40);
const results = [
  { Title: 'Starbound Frontier S02', Categories: '', Size: '18 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 3, Seed: 152 },
  { Title: 'Starbound Frontier S01', Categories: '', Size: '17 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: 'b'.repeat(40), Peer: 1, Seed: 88 },
];

let el: HTMLElement;
const launch = vi.fn();

function mount(link?: string) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Add link={link} />, el));
}

function type(sel: string, v: string) {
  const i = el.querySelector(sel) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const byLabel = (l: string) => Array.from(el.querySelectorAll('button')).filter((b) => b.getAttribute('aria-label') === l);
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;
const click = (n: Element) => act(() => (n as HTMLElement).click());
const search = (q: string) => {
  type('input[aria-label="Поиск на сервере"]', q);
  act(() => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  toast.value = '';
  launch.mockReset().mockResolvedValue(undefined);
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
  resetTo({ name: 'add' });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('normalizeLink', () => {
  it('accepts magnet and bare hash only', () => {
    expect(normalizeLink(' magnet:?xt=urn:btih:abc ')).toBe('magnet:?xt=urn:btih:abc');
    expect(normalizeLink(HASH)).toBe('magnet:?xt=urn:btih:' + HASH);
    expect(normalizeLink('hello')).toBeNull();
  });
});

describe('Add', () => {
  it('prefills the incoming link and adds it, then opens the torrent', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount('magnet:?xt=urn:btih:' + HASH);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('magnet:?xt=urn:btih:' + HASH);
    click(byText('Добавить'));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: HASH });
    expect(toast.value).toBe('Добавлено');
  });

  it('rejects garbage input', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add');
    mount();
    type('input', 'nope');
    click(byText('Добавить'));
    await flush();
    expect(add).not.toHaveBeenCalled();
    expect(el.querySelector('.m-error')).toBeTruthy();
  });

  it('search renders results with the selected source', async () => {
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    mount();
    click(byText('Torznab'));
    search('starbound');
    await flush();
    expect(s).toHaveBeenCalledWith('starbound', 'torznab');
    expect(el.querySelectorAll('.m-result').length).toBe(2);
    expect(el.querySelector('.m-result')!.textContent).toContain('152 сид.');
  });

  it('«Добавить и смотреть на ТВ» adds then launches', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('starbound');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH });
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: HASH });
    expect(toast.value).toBe('Запустил на LG OLED');
  });

  it('plain «Добавить на сервер» does not launch', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect(toast.value).toBe('Добавлено на сервер');
  });

  it('double tap on a row adds and launches once', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    let resolveAdd: (v: any) => void = () => {};
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(() => new Promise((r) => (resolveAdd = r)));
    mount();
    search('x');
    await flush();
    const b = byLabel('Добавить и смотреть на ТВ')[0];
    click(b);
    click(b);
    expect((b as HTMLButtonElement).disabled).toBe(true);
    resolveAdd({ hash: HASH });
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('add errors from a row show under the search', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockRejectedValue(new Error('сервер упал'));
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(el.querySelector('.m-error')!.textContent).toContain('сервер упал');
  });

  it('drops out-of-order search responses and clears results on source change', async () => {
    const resolvers: Array<(v: any) => void> = [];
    vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation(() => new Promise((r) => resolvers.push(r)));
    mount();
    search('first');
    search('second');
    resolvers[1]([results[1]]);
    await flush();
    resolvers[0]([results[0]]);
    await flush();
    const rows = el.querySelectorAll('.m-result');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('S01');
    click(byText('Torznab'));
    expect(el.querySelectorAll('.m-result').length).toBe(0);
    search('third');
    click(byText('Встроенный'));
    resolvers[2]([results[0]]);
    await flush();
    expect(el.querySelectorAll('.m-result').length).toBe(0);
  });

  it('does not jump to the remote after unmount', async () => {
    vi.useFakeTimers();
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 1000 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    act(() => render(null, el));
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentRoute.value.name).toBe('add');
    vi.useRealTimers();
  });

  it('«Добавить и смотреть на ТВ» with no OMP offers the install guide', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: vi.fn().mockRejectedValue(new Error(TV_NO_OMP)), remoteDelayMs: 0 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(el.textContent).toContain('Как установить OMP на телевизор');
  });
});

describe('Add TV launch with report', () => {
  it('«Добавить и смотреть на ТВ» sends the report url and no file', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => '0.8.0', reportUrl: async () => 'http://192.168.1.9:8123/p', launchOnTv: launch, remoteDelayMs: 0 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: HASH, report: 'http://192.168.1.9:8123/p' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    // no file: nothing plays yet, land on the remote as in v0.7
    expect(currentRoute.value.name).toBe('remote');
  });
});
