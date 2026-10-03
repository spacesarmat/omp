import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { AddScreen } from '../../src/screens/Add';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import type { SearchResult } from '../../src/api/types';
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
  const q = inputs[1] as HTMLInputElement;
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
  it('LG: TorrServer search with the source choice, built-ins untouched', async () => {
    const fake = vi.fn(() => Promise.resolve([fakeRow({})]));
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: fake });
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([tsRow]);
    mount();
    expect(host.querySelector('.choice-row')).not.toBeNull();
    typeQuery('starbound');
    act(() => button('Искать').click());
    await flush();
    expect(s).toHaveBeenCalledTimes(1);
    expect(s).toHaveBeenCalledWith('starbound', 'rutor');
    expect(fake).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.list-item')).toHaveLength(1);
    expect(host.querySelector('.search-progress')).toBeNull();
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
    expect(items[1].textContent).toContain('ещё в Torznab');
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
    expect(host.textContent).toContain('Получаю ссылку…');
    give(MAG);
    await flush();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ link: MAG, title: 'Северный ветер 2160p' }));
  });
});
