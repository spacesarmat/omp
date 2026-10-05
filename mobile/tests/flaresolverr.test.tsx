import { applyLanguageSetting } from '../../src/i18n';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FlareSolverr, addressRemoved } from '../src/screens/FlareSolverr';
import { Sources } from '../src/screens/Sources';
import { currentRoute, resetTo } from '../src/nav';
import { FLARESOLVERR_Q } from '../src/faq';
import { flareSolverrUrl, setFlareSolverrUrl } from '../../src/sources/flareStore';
import { flareIntro, flareNoWifi, flareNotAnswering, flareNotFound, setFlareStatus } from '../../src/sources/flaresolverr';
import type { LanScan } from '../../src/sources/indexerDiscovery';
import type { HttpResponse, SourceContext } from '../../src/sources/types';
import type { IndexerEnv } from '../src/screens/SourcesIndexers';

const READY = JSON.stringify({ msg: 'FlareSolverr is ready!', version: '3.4.0' });

let el: HTMLElement;
let calls: string[];
let up: { [url: string]: boolean };
let hits: { ip: string; port: number }[] | null;

const ctx = (): SourceContext => ({
  http: {
    get: (url) => {
      calls.push(url);
      if (up[url]) return Promise.resolve({ status: 200, url, text: READY } as HttpResponse);
      return Promise.reject(new Error('Сайт не отвечает'));
    },
    post: () => Promise.reject(new Error('x')),
    clearCookies: () => Promise.resolve(),
  },
  client: null,
});

const scan = (): LanScan => () => Promise.resolve(hits);

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<FlareSolverr ctx={ctx} scan={scan} />, el));
  await flush();
}

const input = () => el.querySelector('#flare-url') as HTMLInputElement;
const button = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
const click = async (b: Element) => {
  act(() => (b as HTMLElement).click());
  await flush();
};
const type = (v: string) => {
  act(() => {
    input().value = v;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  setFlareStatus(null);
  calls = [];
  up = {};
  hits = [];
  resetTo({ name: 'sources' });
});

afterEach(() => {
  act(() => render(null, el));
});

describe('FlareSolverr screen', () => {
  it('shows the mockup texts', async () => {
    await mount();
    expect(el.textContent).toContain(flareIntro());
    expect(el.textContent).toContain('Нет FlareSolverr?');
    expect(button('Найти в сети')).toBeTruthy();
    expect(button('Проверить')).toBeTruthy();
  });

  it('«Проверить» saves the address and shows the version and the answer time', async () => {
    up['http://192.168.1.191:8191/'] = true;
    await mount();
    type('192.168.1.191');
    await click(button('Проверить'));
    expect(flareSolverrUrl()).toBe('http://192.168.1.191:8191');
    expect(input().value).toBe('http://192.168.1.191:8191');
    const ok = el.querySelector('[data-flare-state="ok"]')!;
    expect(ok.textContent).toMatch(/^Работает · версия 3\.4 · ответ \d+,\d с$/);
  });

  it('a silent address is kept and the error shown', async () => {
    await mount();
    type('http://192.168.1.50:8191');
    await click(button('Проверить'));
    expect(flareSolverrUrl()).toBe('http://192.168.1.50:8191');
    expect(el.querySelector('[data-flare-state="error"]')!.textContent).toBe(flareNotAnswering());
  });

  it('an empty address forgets FlareSolverr', async () => {
    setFlareSolverrUrl('http://192.168.1.50:8191');
    await mount();
    // the saved address is checked on open
    expect(calls).toEqual(['http://192.168.1.50:8191/']);
    type('');
    await click(button('Проверить'));
    expect(flareSolverrUrl()).toBeNull();
    expect(el.textContent).toContain(addressRemoved());
  });

  it('«Найти в сети»: one found is filled in and checked', async () => {
    up['http://192.168.1.191:8191/'] = true;
    hits = [{ ip: '192.168.1.191', port: 8191 }];
    await mount();
    await click(button('Найти в сети'));
    expect(input().value).toBe('http://192.168.1.191:8191');
    expect(flareSolverrUrl()).toBe('http://192.168.1.191:8191');
    expect(el.querySelector('[data-flare-state="ok"]')).toBeTruthy();
  });

  it('«Найти в сети»: several — the user picks one', async () => {
    up['http://192.168.1.5:8191/'] = true;
    up['http://192.168.1.6:8191/'] = true;
    hits = [
      { ip: '192.168.1.5', port: 8191 },
      { ip: '192.168.1.6', port: 8191 },
    ];
    await mount();
    await click(button('Найти в сети'));
    expect(el.querySelector('[data-found="flare"]')).toBeTruthy();
    await click(button('192.168.1.6:8191'));
    expect(flareSolverrUrl()).toBe('http://192.168.1.6:8191');
  });

  it('«Найти в сети»: nothing found / not on Wi-Fi', async () => {
    await mount();
    await click(button('Найти в сети'));
    expect(el.textContent).toContain(flareNotFound());
    hits = null;
    await click(button('Найти в сети'));
    expect(el.textContent).toContain(flareNoWifi());
    expect(flareSolverrUrl()).toBeNull();
  });

  it('«Как установить FlareSolverr» opens the FAQ answer', async () => {
    await mount();
    await click(button('Как установить FlareSolverr'));
    expect(currentRoute.value).toEqual({ name: 'faq', q: FLARESOLVERR_Q });
  });
});

describe('entry in «Источники поиска»', () => {
  const env = (): IndexerEnv => ({ scan: null, readSettings: null, now: () => 0 });

  it('shows the state and opens the screen', async () => {
    up['http://192.168.1.191:8191/'] = true;
    setFlareSolverrUrl('192.168.1.191');
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Sources ctx={ctx} indexerEnv={env} />, el));
    await flush();
    const entry = el.querySelector('[data-entry="flaresolverr"]')!;
    expect(entry.textContent).toContain('FlareSolverr');
    expect(entry.textContent).toContain('192.168.1.191:8191 · работает');
    await click(entry.querySelector('button')!);
    expect(currentRoute.value).toEqual({ name: 'flaresolverr' });
  });

  it('without an address', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Sources ctx={ctx} indexerEnv={env} />, el));
    await flush();
    expect(el.querySelector('[data-entry="flaresolverr"]')!.textContent).toContain('не задан');
    expect(calls).toEqual([]);
  });
});

describe('FlareSolverr screen in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));

  it('texts, check result and removal of the address', async () => {
    up['http://192.168.1.191:8191/'] = true;
    await mount();
    expect(el.querySelector('h1')!.textContent).toBe('FlareSolverr');
    expect(el.querySelector('label[for=flare-url]')!.textContent).toBe('Address');
    expect(el.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(el.textContent).toContain('No FlareSolverr?');
    expect(button('Find on network')).toBeTruthy();
    type('192.168.1.191');
    await click(button('Check'));
    expect(el.querySelector('[data-flare-state="ok"]')!.textContent).toMatch(/^Working · version 3\.4 · answer \d+\.\d s$/);
    type('');
    await click(button('Check'));
    expect(el.textContent).toContain('Address removed: FlareSolverr is not used');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('a silent address and several found', async () => {
    await mount();
    type('http://192.168.1.50:8191');
    await click(button('Check'));
    expect(el.querySelector('[data-flare-state="error"]')!.textContent).toBe(flareNotAnswering());
    up['http://192.168.1.5:8191/'] = true;
    up['http://192.168.1.6:8191/'] = true;
    hits = [
      { ip: '192.168.1.5', port: 8191 },
      { ip: '192.168.1.6', port: 8191 },
    ];
    await click(button('Find on network'));
    expect(el.textContent).toContain('Several found — choose one:');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});
