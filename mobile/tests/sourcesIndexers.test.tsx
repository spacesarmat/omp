import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { applyLanguageSetting } from '../../src/i18n';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Sources } from '../src/screens/Sources';
import { foundCardState, keyNote, type IndexerEnv } from '../src/screens/SourcesIndexers';
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

  it('a LAN find without a key offers «Ввести ключ»; the sheet checks and connects (mockup 6)', async () => {
    await mount();
    expect(scans).toBe(1);
    const found = el.querySelector('[data-candidate="192.168.1.7:9696"]') as HTMLElement;
    expect(found.textContent).toContain('Prowlarr · 192.168.1.7');
    expect(found.querySelector('.m-src-note')!.textContent).toBe('в сети · нужен ключ');
    expect(btn('Подключить', found)).toBeUndefined();
    await click(btn('Ввести ключ', found)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain('Нашлось в сети и в настройках TorrServer:');
    expect(sheet.textContent).toContain('API-ключ (Prowlarr → Settings → General)');
    expect(sheet.textContent).toContain(keyNote());
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

  it('a Torznab entry with a key in the TorrServer settings: «ключ из TorrServer», «Подключить» connects in place; the same Jackett hides Torznab (TorrServer)', async () => {
    settings = { EnableTorznabSearch: true, TorznabUrls: [{ Host: 'http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab', Key: TS_KEY }] };
    await mount();
    const found = el.querySelector('[data-candidate="192.168.1.5:9117"]') as HTMLElement;
    expect(found.querySelector('.m-src-note')!.textContent).toBe('ключ из TorrServer');
    expect(el.textContent).not.toContain(torznabHidden());
    expect(found.innerHTML).not.toContain(TS_KEY);
    await click(btn('Подключить', found)!);
    // no sheet: the key was known, the check ran and the connection is saved
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    const conn = indexerConnections()[0];
    expect(conn).toMatchObject({ kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true });
    expect(secrets[indexerKeyName(conn.id)]).toBe(TS_KEY);
    expect(card(conn.id)).toBeTruthy();
    expect(el.querySelector('[data-candidate="192.168.1.5:9117"]')).toBeNull();
    expect(el.textContent).toContain(torznabHidden());
    expect(el.querySelector('[role="switch"][aria-label="Jackett / Prowlarr (Torznab)"]')).toBeNull();
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(TS_KEY);
  });

  it('a key from TorrServer that fails: the reason on the card, then «Ввести ключ» opens the sheet without that key', async () => {
    settings = { EnableTorznabSearch: true, TorznabUrls: [{ Host: 'http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab', Key: 'test0only0wrong' }] };
    await mount();
    const found = () => el.querySelector('[data-candidate="192.168.1.5:9117"]') as HTMLElement;
    await click(btn('Подключить', found())!);
    expect(indexerConnections()).toEqual([]);
    expect(found().querySelector('.m-src-note.bad')).toBeTruthy();
    expect(btn('Подключить', found())).toBeUndefined();
    await click(btn('Ввести ключ', found())!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect((sheet.querySelector('#m-idx-url') as HTMLInputElement).value).toBe('http://192.168.1.5:9117');
    expect((sheet.querySelector('#m-idx-key') as HTMLInputElement).placeholder).toBe('');
  });

  it('the found card states: key known → «Подключить»; none → where it was found and «Ввести ключ»', () => {
    expect(foundCardState({ torrserver: true, tsKey: 'k' })).toEqual({ note: 'ключ из TorrServer', tone: 'ok', connects: true, button: 'Подключить' });
    expect(foundCardState({ torrserver: true })).toEqual({ note: 'из TorrServer · нужен ключ', tone: 'warn', connects: false, button: 'Ввести ключ' });
    expect(foundCardState({ torrserver: false })).toEqual({ note: 'в сети · нужен ключ', tone: 'warn', connects: false, button: 'Ввести ключ' });
    expect(foundCardState({ torrserver: true, tsKey: 'k' }, 'Неверный API-ключ')).toEqual({ note: 'Неверный API-ключ', tone: 'bad', connects: false, button: 'Ввести ключ' });
  });

  it('the page spaces its sections like «Настройки»; an opaque scrim under the status bar', () => {
    const css = readFileSync('mobile/src/mobile.css', 'utf8') as string;
    const rule = (sel: string) => {
      const i = css.indexOf('\n' + sel + ' {');
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };
    const gap = (sel: string) => (/gap:\s*(\d+)px/.exec(rule(sel)) || [])[1];
    expect(rule(".m-screen[data-route='sources']")).toMatch(/flex-direction:\s*column/);
    expect(gap(".m-screen[data-route='sources']")).toBe(gap(".m-screen[data-route='settings']"));
    expect(rule('body::before')).toMatch(/background:\s*var\(--bg\)/);
  });

  it('text links («Как установить FlareSolverr», «Открыть настройки NNM-Club») use the accent, not faint grey', () => {
    const css = (readFileSync('mobile/src/mobile.css', 'utf8') as string).replace(/\r\n/g, '\n');
    const i = css.indexOf('\n.m-link {');
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toMatch(/color:\s*var\(--accent\)/);
    expect(rule).not.toMatch(/var\(--muted\)/);
  });

  it('the network scan shows inside the add button, not as a loose line between the cards', async () => {
    let finish: (v: { ip: string; port: number }[]) => void = () => undefined;
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    const slow = (): IndexerEnv => ({ scan: () => new Promise((r) => (finish = r)), readSettings: () => Promise.resolve(settings), now: () => NOW });
    act(() => render(<Sources ctx={ctx} indexerEnv={slow} />, el));
    await flush();
    const add = el.querySelector('.m-idx-add-btn') as HTMLElement;
    expect(add.querySelector('.m-idx-add-scan')!.textContent).toBe('Ищу Jackett и Prowlarr в сети…');
    expect(add.getAttribute('aria-busy')).toBe('true');
    const section = el.querySelector('[data-section="indexers"]')!;
    expect(Array.from(section.children).some((n) => n.classList.contains('m-note'))).toBe(false);
    finish([]);
    await flush();
    expect(el.querySelector('.m-idx-add-scan')).toBeNull();
    expect((el.querySelector('.m-idx-add-btn') as HTMLElement).textContent).toBe('Добавить Jackett или Prowlarr');
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

describe('phone indexers in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  // «Трекер N» are the fake Prowlarr tracker names (tracker data)
  const noCyrillic = (n: Element) => expect((n.textContent || '').replace(/Трекер \d/g, '')).not.toMatch(/[А-Яа-яЁё]/);

  it('a connection card: line, trackers, buttons and the removal question', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    await mount();
    expect(el.querySelector('[data-section="indexers"] .m-set-label')!.textContent).toBe('Indexers');
    const c = card(id);
    expect(c.textContent).toContain('Jackett · 192.168.1.5');
    expect(c.textContent).toContain('direct · 2 trackers, 1 working');
    await click(c.querySelector('[aria-expanded]')!);
    expect(c.textContent).toContain('Checked just now');
    for (const b of ['Check', 'Change the key', 'Delete']) expect(btn(b, c), b).toBeTruthy();
    await click(btn('Delete', c)!);
    expect(c.textContent).toContain('Remove the connection? The key will also be deleted from the phone.');
    expect(btn('Cancel', c)).toBeTruthy();
    noCyrillic(c);
  });

  it('a key asked for, the add sheet, the check and the result', async () => {
    const id = saveJackett(true);
    await mount();
    const c = card(id);
    expect(c.textContent).toContain('API key needed');
    await click(btn('Enter the key', c)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.getAttribute('aria-label')).toBe('Connect an indexer');
    expect(sheet.querySelector('.m-sheet-title')!.textContent).toBe('Connect an indexer');
    expect(sheet.textContent).toContain('API key (Jackett → main page, the API Key field)');
    expect(sheet.textContent).toContain('The key is kept in the phone’s encrypted storage and is not included in the backup.');
    expect(sheet.querySelector('label[for=m-idx-url]')!.textContent).toBe('Address');
    expect((sheet.querySelector('#m-idx-key') as HTMLInputElement).placeholder).toBe('leave empty to keep it');
    await click(btn('Check and connect', sheet)!);
    expect(sheet.querySelector('[role=alert]')!.textContent).toBe('Enter the API key');
    (sheet.querySelector('#m-idx-key') as HTMLInputElement).value = KEY;
    await click(btn('Check and connect', sheet)!);
    expect(sheet.querySelector('[role=status]')!.textContent).toBe('Jackett · 2 trackers, 1 working');
    expect(btn('Done', sheet)).toBeTruthy();
    noCyrillic(sheet);
  });

  it('a LAN find: the card, the candidates in the sheet and the scan buttons', async () => {
    await mount();
    const found = el.querySelector('[data-candidate="192.168.1.7:9696"]') as HTMLElement;
    expect(found.textContent).toContain('Prowlarr · 192.168.1.7');
    expect(found.textContent).toContain('on the network · needs a key');
    expect(btn('Add Jackett or Prowlarr')).toBeTruthy();
    await click(btn('Enter the key', found)!);
    const sheet = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain('Found on the network and in the TorrServer settings:');
    expect(sheet.textContent).toContain('API key (Prowlarr → Settings → General)');
    expect(sheet.querySelector('.m-idx-pick')!.textContent).toContain('needs a key');
    expect(btn('Search the network', sheet)).toBeTruthy();
    noCyrillic(sheet);
  });

  it('mobile data asks for Wi-Fi; a Torznab key from TorrServer is offered', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    settings = { EnableTorznabSearch: true, TorznabUrls: [{ Host: 'http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab', Key: TS_KEY }] };
    const off = (): IndexerEnv => ({ scan: () => Promise.resolve(null), readSettings: () => Promise.resolve(settings), now: () => NOW });
    act(() => render(<Sources ctx={ctx} indexerEnv={off} />, el));
    await flush();
    const found = el.querySelector('[data-candidate="192.168.1.5:9117"]') as HTMLElement;
    expect(found.textContent).toContain('key from TorrServer');
    expect(btn('Connect', found)).toBeTruthy();
    // the add sheet offers the same key for that address
    await click(btn('Add Jackett or Prowlarr')!);
    await click(el.querySelector('[role=dialog] [data-candidate="192.168.1.5:9117"]')!);
    expect((el.querySelector('[role=dialog] #m-idx-key') as HTMLInputElement).placeholder).toBe('key from the TorrServer settings');
    await click(btn('Search the network')!);
    expect(el.textContent).toContain('Connect to Wi‑Fi to find Jackett and Prowlarr on the network');
    noCyrillic(el);
  });
});
