import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Add, resetAddSearch } from '../src/screens/Add';
import { resetTo } from '../src/nav';
import { addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import type { Source, SourceResult } from '../../src/sources/types';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

const Q = 'Американская история ужасов 11 сезон';
const row = (Title: string, n: string): SourceResult => ({
  Title,
  Categories: '',
  Size: '10 GB',
  CreateDate: '',
  Tracker: 'anidub',
  Link: 'http://example/' + n,
  Magnet: '',
  Hash: '',
  Peer: 1,
  Seed: 4,
  source: 'fake-anidub',
});

let el: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetAddSearch();
  resetTo({ name: 'add' });
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake-anidub');
  vi.restoreAllMocks();
});

describe('search relevance on the phone', () => {
  it('«Американская история ужасов 11 сезон» hides unrelated Anidub rows and keeps a weak match collapsed', async () => {
    const fake: Source = {
      id: 'fake-anidub',
      name: 'Anidub',
      kind: 'builtin',
      search: () => Promise.resolve([
        row('Бесконечный мир / Mugen no Sekai [Anidub]', 'a'),
        row('Ресторан Ужасов / Restaurant of Horrors [Anidub]', 'b'),
        row('Ресторан Ужасов 2 [Anidub]', 'c'),
        row('Мрачный Санта / Grim Santa [Anidub]', 'd'),
        row('Американская история ужасов / American Horror Story S11 1080p', 'e'),
      ]),
    };
    registerSource(fake);
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Add />, el));
    const input = el.querySelector('input[aria-label="Поиск по источникам"]') as HTMLInputElement;
    act(() => {
      input.value = Q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    const main = Array.from(el.querySelectorAll('.m-results')[0].querySelectorAll('[data-title]')).map((n) => n.getAttribute('data-title'));
    expect(main).toEqual(['Американская история ужасов / American Horror Story S11 1080p']);
    const similar = el.querySelector('[data-similar]') as HTMLDetailsElement;
    expect(similar.open).toBe(false);
    expect(similar.querySelector('summary')!.textContent).toContain('Похожие результаты');
    const weak = Array.from(similar.querySelectorAll('[data-title]')).map((n) => n.getAttribute('data-title'));
    expect(weak.some((t) => t!.indexOf('Ресторан Ужасов') >= 0)).toBe(true);
    expect(weak.some((t) => t!.indexOf('Бесконечный мир') >= 0)).toBe(false);
    expect(weak.some((t) => t!.indexOf('Мрачный Санта') >= 0)).toBe(false);
  });

  it('an empty list when nothing is relevant, with no junk in the main results', async () => {
    const fake: Source = {
      id: 'fake-anidub',
      name: 'Anidub',
      kind: 'builtin',
      search: () => Promise.resolve([
        row('Бесконечный мир', 'a'),
        row('Мрачный Санта', 'b'),
      ]),
    };
    registerSource(fake);
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Add />, el));
    const input = el.querySelector('input[aria-label="Поиск по источникам"]') as HTMLInputElement;
    act(() => {
      input.value = Q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(el.querySelector('[data-empty="all"]')!.textContent).toContain('Ничего не найдено');
    expect(el.querySelector('.m-results [data-title]')).toBeNull();
    expect(el.querySelector('[data-similar]')).toBeNull();
  });
});
