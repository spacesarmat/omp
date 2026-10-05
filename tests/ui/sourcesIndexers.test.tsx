import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen, NO_INDEXERS, INTRO } from '../../src/screens/Sources';
import { registerSource, unregisterSource, builtinSources } from '../../src/sources/registry';
import { indexerConnections, indexerKeyName, reloadIndexers, setTorznabHosts } from '../../src/sources/indexerStore';
import { startIndexerSources } from '../../src/sources/indexer';
import { resetIndexerStatus } from '../../src/sources/indexerStatus';
import { isSourceOn, reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import type { HttpResponse, SourceContext } from '../../src/sources/types';

// test-only key
const KEY = 'test0only0key0000000000000000abc';
const NOW = 1_800_000_000_000;
let host: HTMLElement;
let secrets: { [k: string]: string };
let calls: string[];

const XML =
  '<indexers><indexer id="rutor" configured="true"><title>RuTor</title></indexer>' +
  '<indexer id="rustorka" configured="true"><title>Rustorka</title></indexer>' +
  '<indexer id="torrentby" configured="true"><title>Torrent.by</title></indexer></indexers>';
const ERRORS = JSON.stringify([
  { id: 'rutor', last_error: '' },
  { id: 'rustorka', last_error: 'Cloudflare challenge' },
  { id: 'torrentby', last_error: 'Request timed out' },
]);

function respond(url: string): HttpResponse {
  if (url.indexOf('/results/torznab/api') > 0) return { status: 200, url, text: XML };
  if (url.indexOf('/api/v2.0/indexers?') > 0) return { status: 200, url, text: ERRORS };
  return { status: 404, url, text: '' };
}

const ctx = (): SourceContext => ({
  http: {
    get: (url) => {
      calls.push(url);
      return Promise.resolve(respond(url));
    },
    post: () => Promise.reject(new Error('x')),
    clearCookies: () => Promise.resolve(),
  },
  client: null,
  secrets: {
    get: (k) => Promise.resolve(Object.prototype.hasOwnProperty.call(secrets, k) ? secrets[k] : null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  },
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(SourcesScreen, { ctx, now: () => NOW }), host));
  await flush();
}

const row = (id: string) => host.querySelector('[data-indexer="' + id + '"]') as HTMLElement;
const click = async (n: Element) => {
  act(() => (n as HTMLElement).click());
  await flush();
};

function saveJackett() {
  localStorage.setItem('tsp.indexers', JSON.stringify([{ kind: 'jackett', url: 'http://192.168.1.191:9117', keySet: true }]));
  reloadIndexers();
  return indexerConnections()[0].id;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
  reloadSourcePrefs();
  resetHealth();
  resetIndexerStatus();
  secrets = {};
  calls = [];
  registerSource({ id: 'fake-open', name: 'nnmclub', kind: 'builtin', search: () => Promise.resolve([]) });
  startIndexerSources();
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  unregisterSource('fake-open');
  builtinSources()
    .filter((s) => s.kind === 'indexer')
    .forEach((s) => unregisterSource(s.id));
});

describe('Android TV «Источники поиска» indexers (mockup 1)', () => {
  it('the Индексаторы group: a row with its summary that expands into the trackers', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    await mount();
    expect(host.textContent).toContain(INTRO);
    const groups = Array.from(host.querySelectorAll('.src-group')).map((g) => g.textContent);
    expect(groups).toEqual(['Индексаторы', 'Через TorrServer', 'Встроенные']);
    const r = row(id);
    expect(r.textContent).toContain('Jackett · 192.168.1.191');
    expect(r.textContent).toContain('напрямую · 3 трекера, 1 работает');
    expect(r.querySelector('.src-trackers')).toBeNull();
    await click(r.querySelector('.src-row')!);
    const trackers = Array.from(r.querySelectorAll('.src-tracker')).map((t) => t.textContent);
    expect(trackers).toEqual(['RuTorработает', 'RustorkaCloudflare', 'Torrent.byошибка: не отвечает']);
    expect(r.textContent).toContain('Проверено только что');
    // the indexer is not listed with the built-in sites
    expect(host.querySelector('[data-source="indexer-' + id + '"]')).toBeNull();
    expect(host.innerHTML).not.toContain(KEY);
  });

  it('the on/off button and the hidden Torznab note', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    setTorznabHosts(['192.168.1.191:9117']);
    await mount();
    expect(host.textContent).toContain('Torznab (TorrServer) скрыт: тот же Jackett подключён напрямую.');
    const onBtn = Array.from(row(id).querySelectorAll('.focusable')).find((n) => n.textContent === 'вкл')!;
    await click(onBtn);
    expect(isSourceOn({ id: 'indexer-' + id })).toBe(false);
    expect(host.textContent).not.toContain('Torznab (TorrServer) скрыт');
    expect(host.textContent).toContain('Jackett / Prowlarr (Torznab)');
  });

  it('the TV reads the TorrServer Torznab hosts (loopback = the server) for the note; unknown hosts give the plain reason', async () => {
    const id = saveJackett();
    secrets[indexerKeyName(id)] = KEY;
    act(() =>
      render(
        h(SourcesScreen, {
          ctx,
          now: () => NOW,
          server: () => ({ read: () => Promise.resolve({ TorznabUrls: [{ Host: 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab' }] }), host: '192.168.1.191' }),
        }),
        (host = document.body.appendChild(document.createElement('div'))),
      ),
    );
    await flush();
    expect(host.textContent).toContain('Torznab (TorrServer) скрыт: тот же Jackett подключён напрямую.');
    act(() => render(null, host));
    setTorznabHosts(undefined);
    await mount();
    expect(host.textContent).toContain('Torznab (TorrServer) скрыт: поиск идёт через Jackett/Prowlarr напрямую.');
  });

  it('a connection without its key on the TV says to send it from the phone', async () => {
    const id = saveJackett();
    await mount();
    expect(row(id).textContent).toContain('нужен API-ключ — передайте с телефона');
    expect(calls).toHaveLength(0);
  });

  it('no connections: how to add one', async () => {
    await mount();
    expect(host.textContent).toContain(NO_INDEXERS);
  });
});
