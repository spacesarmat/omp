import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen } from '../../src/screens/Sources';
import { reloadIndexers } from '../../src/sources/indexerStore';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { flareSolverrUrl, setFlareSolverrUrl } from '../../src/sources/flareStore';
import { setFlareStatus, TV_FLARE_NONE, TV_FLARE_OK } from '../../src/sources/flaresolverr';
import type { LanScan } from '../../src/sources/indexerDiscovery';
import type { HttpResponse, SourceContext } from '../../src/sources/types';

const NOW = 1_800_000_000_000;
const READY = JSON.stringify({ msg: 'FlareSolverr is ready!', version: '3.4.0' });
let host: HTMLElement;
let up: { [url: string]: boolean };
let scans: number;

const ctx = (): SourceContext => ({
  http: {
    get: (url) => (up[url] ? Promise.resolve({ status: 200, url, text: READY } as HttpResponse) : Promise.reject(new Error('Сайт не отвечает'))),
    post: () => Promise.reject(new Error('x')),
    clearCookies: () => Promise.resolve(),
  },
  client: null,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(scan: LanScan | null) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(SourcesScreen, { ctx, now: () => NOW, server: () => null, scan: () => scan }), host));
  await flush();
}

const block = () => host.querySelector('[data-flare]') as HTMLElement;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
  reloadSourcePrefs();
  resetHealth();
  setFlareStatus(null);
  up = {};
  scans = 0;
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
});

describe('Android TV «Источники поиска»: FlareSolverr block (mockup 1, left)', () => {
  it('the saved address with its version and state', async () => {
    setFlareSolverrUrl('http://192.168.1.191:8191');
    up['http://192.168.1.191:8191/'] = true;
    await mount(null);
    const b = block();
    expect(b.textContent).toContain('FlareSolverr');
    expect(b.textContent).toContain('192.168.1.191:8191 · версия 3.4');
    expect(b.querySelector('.src-note-ok')!.textContent).toBe(TV_FLARE_OK);
  });

  it('a silent FlareSolverr', async () => {
    setFlareSolverrUrl('http://192.168.1.191:8191');
    await mount(null);
    expect(block().querySelector('.src-note-bad')).toBeTruthy();
  });

  it('none saved: searched on the LAN (once a day) and the found one is kept', async () => {
    up['http://192.168.1.40:8191/'] = true;
    const scan: LanScan = () => {
      scans++;
      return Promise.resolve([{ ip: '192.168.1.40', port: 8191 }]);
    };
    await mount(scan);
    expect(flareSolverrUrl()).toBe('http://192.168.1.40:8191');
    expect(block().textContent).toContain('192.168.1.40:8191 · версия 3.4');
    expect(scans).toBe(1);
  });

  it('none saved and none found', async () => {
    await mount(() => Promise.resolve([]));
    expect(block().textContent).toContain(TV_FLARE_NONE);
    expect(flareSolverrUrl()).toBeNull();
  });
});
