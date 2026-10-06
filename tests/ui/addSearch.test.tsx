import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { AddScreen } from '../../src/screens/Add';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { ipBanError } from '../../src/sources/ipBan';
import type { SearchResult } from '../../src/api/types';
import { routeStack } from '../../src/ui/nav';
import type { SourceResult } from '../../src/sources/types';

const w = window as unknown as { Capacitor?: unknown };
const HASH = 'a'.repeat(40);
const MAG = 'magnet:?xt=urn:btih:' + 'c'.repeat(40);
let host: HTMLElement;

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

const tsRow: SearchResult = { Title: 'Starbound Frontier S01 1080p', Categories: '', Size: '17 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 1, Seed: 88 };

function fakeRow(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Северный ветер 2160p', Categories: '', Size: '42 GB', CreateDate: '', Tracker: 'Фейк', Link: '', Magnet: '', Hash: '', Peer: 2, Seed: 300, source: 'fake', detailUrl: 'https://f.example/t=1', ...p };
}

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(AddScreen, {}), host));
}

function typeQuery(v: string) {
  const inputs = host.querySelectorAll('input');
  const q = inputs[0] as HTMLInputElement;
  act(() => {
    q.value = v;
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (label: string) => Array.prototype.slice.call(host.querySelectorAll('.button')).filter((b: HTMLElement) => b.textContent === label)[0] as HTMLElement;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
});

afterEach(() => {
  delete w.Capacitor;
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  unregisterSource('fake');
  vi.restoreAllMocks();
});

describe('TV search', () => {
  it('a route with a query and run prefills the search and starts it at once', async () => {
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([tsRow]);
    routeStack.value = [{ name: 'library' }, { name: 'add', query: 'Starbound 1 сезон', run: true }];
    mount();
    await flush();
    expect((host.querySelectorAll('input')[0] as HTMLInputElement).value).toBe('Starbound 1 сезон');
    expect(s).toHaveBeenCalledWith('Starbound 1 сезон', 'rutor');
    expect(host.querySelectorAll('.list-item')).toHaveLength(1);
    routeStack.value = [{ name: 'connect' }];
  });

  it('LG without a phone: TorrServer rutor and Torznab, the no-phone line, built-ins untouched', async () => {
    const fake = vi.fn(() => Promise.resolve([fakeRow({})]));
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: fake });
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([tsRow]);
    mount();
    expect(host.querySelector('.choice-row')).toBeNull();
    expect(host.querySelector('h1')!.textContent).toBe('Найти раздачу');
    typeQuery('starbound');
    act(() => button('Искать').click());
    await flush();
    expect(s).toHaveBeenCalledWith('starbound', 'rutor');
    expect(s).toHaveBeenCalledWith('starbound', 'torznab');
    expect(fake).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.list-item')).toHaveLength(1);
    expect(host.querySelector('.search-note')!.textContent).toBe(
      'Сайты ищет телефон с OMP — подключите его к этому телевизору. Сейчас ищем через TorrServer',
    );
    expect(host.querySelector('.search-by')!.textContent).toBe('Ищет TorrServer · ');
  });

  it('Android TV: unified search with source badges and the progress line', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    let late: (v: SourceResult[]) => void = () => {};
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => new Promise((r) => (late = r)) });
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([tsRow]);
    mount();
    expect(host.querySelector('.choice-row')).toBeNull();
    typeQuery('ветер');
    act(() => button('Искать').click());
    await flush();
    expect(s).toHaveBeenCalledWith('ветер', 'rutor');
    expect(s).toHaveBeenCalledWith('ветер', 'torznab');
    expect(host.querySelectorAll('.list-item')).toHaveLength(1);
    expect(host.querySelector('.search-progress')!.textContent).toBe('Найдено 1 · 2 из 3 источников ответили · ещё ищу в Фейк…');
    late([fakeRow({})]);
    await flush();
    const items = host.querySelectorAll('.list-item');
    expect(items).toHaveLength(2);
    // most seeds first
    expect(items[0].querySelector('.src-badge')!.textContent).toBe('Фейк');
    expect(items[1].querySelector('.src-badge')!.textContent).toBe('rutor (TorrServer)');
    expect(items[1].textContent).toContain('ещё на Torznab');
    expect(host.querySelector('.search-by')!.textContent).toBe('Ищут источники · ');
    expect(host.querySelector('.search-progress')!.textContent).toBe('Найдено 2 · 3 из 3 источников ответили');
  });

  it('Android TV: a row without a magnet takes it from the release page', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    let give: (v: string) => void = () => {};
    const magnet = vi.fn(() => new Promise<string>((r) => (give = r)));
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => Promise.resolve([fakeRow({})]), magnet });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH, title: 'x', stat: 1 } as any);
    mount();
    typeQuery('ветер');
    act(() => button('Искать').click());
    await flush();
    act(() => (host.querySelector('.list-item') as HTMLElement).click());
    await flush();
    expect(magnet).toHaveBeenCalledWith('https://f.example/t=1', expect.anything());
    expect(host.textContent).toContain('Получаем ссылку…');
    give(MAG);
    await flush();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ link: MAG, title: 'Северный ветер 2160p' }));
  });
});

describe('TV search on Android TV: focus and stale searches', () => {
  const titleOfFocused = () => {
    const f = host.querySelector('.list-item.focused');
    return f ? f.querySelector('.title')!.textContent : null;
  };
  const enter = async () => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(ev, 'keyCode', { get: () => 13 });
    Object.defineProperty(ev, 'which', { get: () => 13 });
    act(() => {
      window.dispatchEvent(ev);
    });
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(up, 'keyCode', { get: () => 13 });
    Object.defineProperty(up, 'which', { get: () => 13 });
    act(() => {
      window.dispatchEvent(up);
    });
    await flush();
  };
  const focusRow = async (key: string) => {
    act(() => setFocus('res-' + key));
    await flush();
    expect(getCurrentFocusKey()).toBe('res-' + key);
  };

  afterEach(() => {
    unregisterSource('fake2');
    unregisterSource('fake3');
  });

  it('after a reorder Enter adds the highlighted row and every row stays reachable', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    let mid: (v: SourceResult[]) => void = () => {};
    let late: (v: SourceResult[]) => void = () => {};
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => Promise.resolve([fakeRow({ Title: 'Low', Seed: 3, Magnet: 'magnet:?xt=urn:btih:' + '1'.repeat(40), detailUrl: 'https://f.example/low' })]) });
    registerSource({ id: 'fake2', name: 'Фейк-2', kind: 'builtin', search: () => new Promise((r) => (mid = r)) });
    registerSource({ id: 'fake3', name: 'Фейк-3', kind: 'builtin', search: () => new Promise((r) => (late = r)) });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH, title: 'x', stat: 1 } as any);
    mount();
    typeQuery('x');
    act(() => button('Искать').click());
    await flush();
    await focusRow('https://f.example/low');
    expect(titleOfFocused()).toBe('Low');
    // a better row arrives while one source still searches: it goes below, nothing moves under the cursor
    mid([fakeRow({ source: 'fake2', Title: 'High', Seed: 900, Size: '1 GB', Magnet: 'magnet:?xt=urn:btih:' + '2'.repeat(40), detailUrl: 'https://g.example/high' })]);
    await flush();
    let titles = Array.prototype.map.call(host.querySelectorAll('.list-item .title'), (n: Element) => n.textContent);
    expect(titles).toEqual(['Low', 'High']);
    // the search ends: full sort, High moves above the focused row
    late([fakeRow({ source: 'fake3', Title: 'Mid', Seed: 50, Size: '2 GB', Magnet: 'magnet:?xt=urn:btih:' + '3'.repeat(40), detailUrl: 'https://h.example/mid' })]);
    await flush();
    titles = Array.prototype.map.call(host.querySelectorAll('.list-item .title'), (n: Element) => n.textContent);
    expect(titles).toEqual(['High', 'Mid', 'Low']);
    expect(titleOfFocused()).toBe('Low');
    // every row can be focused and shows the highlight on itself
    for (const [k, title] of [['https://g.example/high', 'High'], ['https://h.example/mid', 'Mid'], ['https://f.example/low', 'Low']]) {
      await focusRow(k);
      expect(titleOfFocused()).toBe(title);
    }
    await enter();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ link: 'magnet:?xt=urn:btih:' + '1'.repeat(40), title: 'Low' }));
  });

  it('a second search started before the first ends does not mix results', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const answers: ((v: SourceResult[]) => void)[] = [];
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => new Promise((r) => answers.push(r)) });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
    mount();
    typeQuery('first');
    act(() => button('Искать').click());
    typeQuery('second');
    act(() => button('Искать').click());
    await flush();
    answers[1]([fakeRow({ Title: 'Second', detailUrl: 'https://f.example/2' })]);
    await flush();
    answers[0]([fakeRow({ Title: 'First', detailUrl: 'https://f.example/1' })]);
    await flush();
    const titles = Array.prototype.map.call(host.querySelectorAll('.list-item .title'), (n: Element) => n.textContent);
    expect(titles).toEqual(['Second']);
    expect(host.querySelector('.search-progress')!.textContent).toBe('Найдено 1 · 3 из 3 источников ответили');
  });

  it('a Cloudflare block shows the Jackett hint', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    registerSource({ id: 'fake', name: 'rutracker', kind: 'builtin', search: () => Promise.reject(new Error('Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже')) });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
    mount();
    typeQuery('x');
    act(() => button('Искать').click());
    await flush();
    const hint = host.querySelector('.search-hint')!;
    expect(hint.textContent).toContain('rutracker: Сайт закрыт проверкой браузера (Cloudflare)');
    expect(hint.textContent).toContain('через Jackett, Prowlarr или FlareSolverr');
  });

  it('a site asking for a verification code says so and where to enter it', async () => {
    w.Capacitor = { getPlatform: () => 'android' };
    registerSource({ id: 'fake', name: 'torrent.by', kind: 'builtin', search: () => Promise.reject(ipBanError('torrent.by')) });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([]);
    mount();
    typeQuery('x');
    act(() => button('Искать').click());
    await flush();
    const hint = host.querySelector('[data-hint="ipban"]')!;
    expect(hint.textContent).toBe(
      'torrent.by просит ввести проверочный код. Введите код на телефоне (OMP → Источники поиска) или в любом браузере в этой же сети',
    );
    expect(host.querySelector('.search-hint:not([data-hint])')).toBeNull();
  });
});
