import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Sources } from '../src/screens/Sources';
import { KEY_NOTE, type IndexerEnv } from '../src/screens/SourcesIndexers';
import { torznabHidden } from '../../src/sources/indexerStore';
import { resetTo } from '../src/nav';
import { indexerConnections, indexerKeyName, reloadIndexers } from '../../src/sources/indexerStore';
import { resetIndexerStatus } from '../../src/sources/indexerStatus';
import { startIndexerSources } from '../../src/sources/indexer';
import { builtinSources, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import type { HttpOptions, HttpResponse, SourceContext } from '../../src/sources/types';

// test-only keys
const KEY = 'test0only0key0000000000000000abc';
const TS_KEY = 'test0only0key0000000000000000tsk';
const NOW = 1_800_000_000_000;

const INDEXERS_XML =
  '<indexers><indexer id="rutor" configured="true"><title>RuTor</title></indexer>' +
  '<indexer id="kinozal" configured="true"><title>Kinozal</title></indexer></indexers>';
const ERRORS = JSON.stringify([
  { id: 'rutor', last_error: '' },
  { id: 'kinozal', last_error: 'Login failed' },
]);

let secrets: { [k: string]: string };
let calls: { url: string; opts?: HttpOptions }[];
let scans: number;
let el: HTMLElement;

function respond(url: string): HttpResponse {
  const r = (text: string, status = 200, final = url): HttpResponse => ({ status, url: final, text });
  if (url === 'http://192.168.1.7:9696/') return r('<title>Prowlarr</title>');
  if (url.indexOf('http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab/api') === 0) {
    return url.indexOf('apikey=' + KEY) > 0 || url.indexOf('apikey=' + TS_KEY) > 0 ? r(INDEXERS_XML) : r('<error code="100" description="Invalid API Key"/>');
  }
  if (url.indexOf('http://192.168.1.5:9117/api/v2.0/indexers?') === 0) return r(ERRORS);
  if (url === 'http://192.168.1.7:9696/api/v1/system/status') return r(JSON.stringify({ version: '2.1.0.1' }));
  if (url === 'http://192.168.1.7:9696/api/v1/indexer')
    return r(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: 'Трекер ' + (i + 1), enable: true, protocol: 'torrent' }))));
  if (url === 'http://192.168.1.7:9696/api/v1/indexerstatus') return r(JSON.stringify([{ indexerId: 9, mostRecentFailure: new Date(NOW).toISOString() }]));
  return r('', 404);
}

function ctx(): SourceContext {
  return {
    http: {
      get: (url, opts) => {
        calls.push({ url, opts });
        return Promise.resolve(respond(url));
      },
      post: () => Promise.reject(new Error('net')),
      clearCookies: () => Promise.resolve(),
    },
    client: null,
    secrets: {
      get: (k) => Promise.resolve(Object.prototype.hasOwnProperty.call(secrets, k) ? secrets[k] : null),
      set: (k, v) => {
        secrets[k] = v;
        return Promise.resolve();
      },
      delete: (k) => {
        delete secrets[k];
        return Promise.resolve();
      },
    },
  };
}

let settings: unknown;
const env = (): IndexerEnv => ({
  scan: () => {
    scans++;
    return Promise.resolve([{ ip: '192.168.1.7', port: 9696 }]);
  },
  readSettings: () => Promise.resolve(settings),
  now: () => NOW,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Sources ctx={ctx} indexerEnv={env} />, el));
  await flush();
}

const btns = (t: string, root: Element = el) => Array.from(root.querySelectorAll('button')).filter((b) => b.textContent === t) as HTMLButtonElement[];
const btn = (t: string, root?: Element) => btns(t, root)[0];
const click = async (n: Element) => {
  act(() => (n as HTMLElement).click());
  await flush();
};
const card = (id: string) => el.querySelector('[data-indexer="' + id + '"]') as HTMLElement;
function type(input: HTMLInputElement, v: string) {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function saveJackett(keySet = true) {
  localStorage.setItem('tsp.indexers', JSON.stringify([{ kind: 'jackett', url: 'http://192.168.1.5:9117', keySet }]));
  reloadIndexers();
  return indexerConnections()[0].id;
}

beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
  reloadSourcePrefs();
  resetHealth();
  resetIndexerStatus();
  resetTo({ name: 'sources' });
  secrets = {};
  calls = [];
  scans = 0;
  settings = { CacheSize: 1 };
  startIndexerSources();
});

afterEach(() => {
  if (el) act(() => render(null, el));
  builtinSources()
    .filter((s) => s.kind === 'indexer')
    .forEach((s) => unregisterSource(s.id));
});

describe('phone «Индексаторы»', () => {
  it('a connection card expands into its trackers with the checked time; indexers are not «встроенные»', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    await mount();
    const c = card(id);
    expect(c.textContent).toContain('Jackett · 192.168.1.5');
    expect(c.textContent).toContain('напрямую · 2 трекера, 1 работает');
    expect(c.textContent).not.toContain('RuTor');
    await click(c.querySelector('[aria-expanded]')!);
    expect(c.textContent).toContain('RuTor');
    expect(c.textContent).toContain('Kinozal');
    expect(c.textContent).toContain('нужен вход');
    expect(c.textContent).toContain('Проверено только что');
    const builtin = Array.from(el.querySelectorAll('.m-set-group')).find((g) => (g.textContent || '').indexOf('Встроенные') >= 0);
    expect(builtin ? builtin.textContent : '').not.toContain('Jackett');
    // the key never reaches the page
    expect(el.innerHTML).not.toContain(KEY);
  });

  it('a restored «ключ задан» without the key asks for it instead of «неверный»', async () => {
    const id = saveJackett(true);
    await mount();
    const c = card(id);
    expect(c.textContent).toContain('нужен API-ключ');
    expect(c.textContent).not.toContain('неверный');
    expect(calls.some((x) => x.url.indexOf('192.168.1.5') >= 0)).toBe(false);
    await click(btn('Ввести ключ', c)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect((sheet.querySelector('#m-idx-url') as HTMLInputElement).value).toBe('http://192.168.1.5:9117');
    (sheet.querySelector('#m-idx-key') as HTMLInputElement).value = KEY;
    await click(btn('Проверить и подключить', sheet)!);
    expect(sheet.textContent).toContain('Jackett · 2 трекера, 1 работает');
    expect(secrets[indexerKeyName(id)]).toBe(KEY);
    expect((sheet.querySelector('#m-idx-key') as HTMLInputElement).value).toBe('');
    expect(card(id).textContent).toContain('напрямую');
  });

  it('a LAN find without a key offers «Подключить»; the sheet checks and connects (mockup 6)', async () => {
    await mount();
    expect(scans).toBe(1);
    const found = el.querySelector('[data-candidate="192.168.1.7:9696"]') as HTMLElement;
    expect(found.textContent).toContain('Prowlarr · 192.168.1.7');
    expect(found.textContent).toContain('найден в сети — нужен API-ключ');
    await click(btn('Подключить', found)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain('Нашлось в сети и в настройках TorrServer:');
    expect(sheet.textContent).toContain('API-ключ (Prowlarr → Settings → General)');
    expect(sheet.textContent).toContain(KEY_NOTE);
    await click(btn('Проверить и подключить', sheet)!);
    expect(sheet.textContent).toContain('Укажите API-ключ');
    (sheet.querySelector('#m-idx-key') as HTMLInputElement).value = KEY;
    await click(btn('Проверить и подключить', sheet)!);
    expect(sheet.querySelector('[role="status"]')!.textContent).toBe('Prowlarr 2.1 · 9 трекеров, 8 работают');
    const conn = indexerConnections()[0];
    expect(conn).toMatchObject({ kind: 'prowlarr', url: 'http://192.168.1.7:9696', keySet: true });
    expect(secrets[indexerKeyName(conn.id)]).toBe(KEY);
    // the key went in the header, never in a Prowlarr URL; nothing of it in localStorage
    expect(calls.some((c) => c.url.indexOf(KEY) >= 0)).toBe(false);
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(KEY);
    await click(btn('Готово', sheet)!);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(card(conn.id)).toBeTruthy();
    expect(el.querySelector('[data-candidate="192.168.1.7:9696"]')).toBeNull();
  });

  it('the automatic scan runs at most once a day, a tap any time', async () => {
    await mount();
    expect(scans).toBe(1);
    act(() => render(null, el));
    await mount();
    expect(scans).toBe(1);
    // the find is remembered between screens
    expect(el.querySelector('[data-candidate="192.168.1.7:9696"]')).toBeTruthy();
    await click(btn('Добавить Jackett или Prowlarr')!);
    await click(btn('Искать в сети')!);
    expect(scans).toBe(2);
  });

  it('a manual search on mobile data asks for Wi-Fi instead of saying nothing was found', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    const off = (): IndexerEnv => ({ scan: () => Promise.resolve(null), readSettings: () => Promise.resolve(settings), now: () => NOW });
    act(() => render(<Sources ctx={ctx} indexerEnv={off} />, el));
    await flush();
    await click(btn('Добавить Jackett или Prowlarr')!);
    await click(btn('Искать в сети')!);
    expect(el.textContent).toContain('Подключитесь к Wi‑Fi, чтобы найти Jackett и Prowlarr в сети');
    expect(el.textContent).not.toContain('не нашлись');
  });

  it('a Torznab entry with a key in the TorrServer settings is offered; the same Jackett hides Torznab (TorrServer)', async () => {
    settings = { EnableTorznabSearch: true, TorznabUrls: [{ Host: 'http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab', Key: TS_KEY }] };
    await mount();
    const found = el.querySelector('[data-candidate="192.168.1.5:9117"]') as HTMLElement;
    expect(found.textContent).toContain('в настройках TorrServer — ключ есть');
    expect(el.textContent).not.toContain(torznabHidden());
    await click(btn('Подключить', found)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect((sheet.querySelector('#m-idx-key') as HTMLInputElement).placeholder).toBe('ключ из настроек TorrServer');
    expect(sheet.innerHTML).not.toContain(TS_KEY);
    await click(btn('Проверить и подключить', sheet)!);
    expect(sheet.querySelector('[role="status"]')!.textContent).toBe('Jackett · 2 трекера, 1 работает');
    expect(secrets[indexerKeyName(indexerConnections()[0].id)]).toBe(TS_KEY);
    await click(btn('Готово', sheet)!);
    expect(el.textContent).toContain(torznabHidden());
    expect(el.querySelector('[role="switch"][aria-label="Jackett / Prowlarr (Torznab)"]')).toBeNull();
  });

  it('warns about a key over plain http outside the home network', async () => {
    await mount();
    await click(btn('Добавить Jackett или Prowlarr')!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    const url = sheet.querySelector('#m-idx-url') as HTMLInputElement;
    type(url, 'http://seedbox.example.com:9117');
    await flush();
    expect(sheet.querySelector('[data-warn="http"]')!.textContent).toContain('ключ передаётся без шифрования');
    type(url, 'http://192.168.1.5:9117');
    await flush();
    expect(sheet.querySelector('[data-warn="http"]')).toBeNull();
    type(url, 'https://seedbox.example.com');
    await flush();
    expect(sheet.querySelector('[data-warn="http"]')).toBeNull();
  });

  it('a wrong key is refused and nothing is saved', async () => {
    await mount();
    await click(btn('Добавить Jackett или Prowlarr')!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    type(sheet.querySelector('#m-idx-url') as HTMLInputElement, 'http://192.168.1.5:9117');
    (sheet.querySelector('#m-idx-key') as HTMLInputElement).value = 'wrong-key';
    await click(btn('Проверить и подключить', sheet)!);
    expect(sheet.textContent).toContain('Неверный API-ключ');
    expect(indexerConnections()).toHaveLength(0);
    expect(Object.keys(secrets)).toHaveLength(0);
  });

  it('switch, re-check and removal of a connection', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    await mount();
    const sw = card(id).querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await click(sw);
    expect(card(id).querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(card(id).textContent).toContain('выключен');
    await click(card(id).querySelector('[aria-expanded]')!);
    const before = calls.length;
    await click(btn('Проверить', card(id))!);
    expect(calls.length).toBeGreaterThan(before);
    await click(btn('Удалить', card(id))!);
    await click(btn('Удалить', card(id))!);
    expect(indexerConnections()).toHaveLength(0);
    expect(secrets[indexerKeyName(id)]).toBeUndefined();
  });
});
