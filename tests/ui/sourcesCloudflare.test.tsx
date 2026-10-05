import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen } from '../../src/screens/Sources';
import { DialogHost } from '../../src/ui/dialog';
import { reloadIndexers } from '../../src/sources/indexerStore';
import { getHealth, isCloudflareBypassOn, reloadSourcePrefs, resetHealth, setCloudflareBypass, setHealth, setSourceOn } from '../../src/sources/store';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { setFlareStatus } from '../../src/sources/flaresolverr';
import { cfInteractive } from '../../src/sources/cloudflare';
import { bypassWarning, setCloudflareChecker } from '../../src/sources/cloudflareCheck';
import type { Source, SourceContext } from '../../src/sources/types';

const NOW = new Date(2026, 9, 4, 20, 0).getTime();
let host: HTMLElement;
let checks: { name: string; url: string }[];
let clearances: { [url: string]: number | null };

const site = (id: string, name: string): Source => ({
  id,
  name,
  kind: 'builtin',
  cloudflare: true,
  siteUrl: 'https://' + id + '.example/',
  search: () => Promise.resolve([]),
});

const ctx = (): SourceContext => ({
  http: { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() },
  client: null,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  const clearance = (url: string) => Promise.resolve(clearances[url] === undefined ? null : clearances[url]);
  act(() => render(h('div', {}, h(SourcesScreen, { ctx, now: () => NOW, server: () => null, scan: () => null, clearance }), h(DialogHost, {})), host));
  await flush();
}

const row = (id: string) => host.querySelector('[data-cf-site="' + id + '"]') as HTMLElement;
const click = async (n: Element) => {
  act(() => (n as HTMLElement).click());
  await flush();
};

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
  checks = [];
  clearances = {};
  registerSource(site('kinozal', 'Kinozal'));
  registerSource(site('rustorka', 'rustorka'));
  setCloudflareChecker((s) => {
    checks.push(s);
    return Promise.resolve('solved');
  });
});
afterEach(() => {
  setCloudflareChecker(null);
  unregisterSource('kinozal');
  unregisterSource('rustorka');
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
});

describe('Android TV «Источники поиска»: «Сайты за Cloudflare» (mockup Main)', () => {
  it('lists the sites with their notes', async () => {
    setCloudflareBypass('kinozal', true);
    setCloudflareBypass('rustorka', true);
    clearances['https://kinozal.example/'] = new Date(2026, 9, 4, 22, 40).getTime();
    setHealth('rustorka', { state: 'error', at: NOW, message: cfInteractive() });
    await mount();
    expect(host.textContent).toContain('Сайты за Cloudflare');
    expect(row('kinozal').textContent).toContain('обход Cloudflare · проверка пройдена · действует до 22:40');
    expect(row('kinozal').querySelector('.src-act')!.textContent).toBe('вкл');
    expect(row('rustorka').querySelector('.src-note-warn')!.textContent).toBe('нужна проверка — пройдите на телефоне');
  });

  it('OK on a site waiting for a check opens it; once passed the note clears', async () => {
    setCloudflareBypass('rustorka', true);
    setHealth('rustorka', { state: 'error', at: NOW, message: cfInteractive() });
    await mount();
    clearances['https://rustorka.example/'] = NOW + 30 * 60000;
    await click(row('rustorka').querySelector('.src-row')!);
    expect(checks).toEqual([{ name: 'rustorka', url: 'https://rustorka.example/' }]);
    expect(getHealth('rustorka')).toBeNull();
    expect(row('rustorka').textContent).toContain('проверка пройдена · действует до 20:30');
  });

  it('a check closed without passing lets the next OK switch the site off', async () => {
    setCloudflareBypass('rustorka', true);
    setHealth('rustorka', { state: 'error', at: NOW, message: cfInteractive() });
    setCloudflareChecker((s) => {
      checks.push(s);
      return Promise.resolve('cancelled');
    });
    await mount();
    await click(row('rustorka').querySelector('.src-row')!);
    expect(checks.length).toBe(1);
    expect(row('rustorka').textContent).not.toContain('нужна проверка');
    await click(row('rustorka').querySelector('.src-row')!);
    expect(checks.length).toBe(1);
    expect(isCloudflareBypassOn(site('rustorka', 'rustorka'))).toBe(false);
  });

  it('turning the switch on shows the warning first; off at once', async () => {
    setSourceOn('kinozal', false);
    await mount();
    expect(row('kinozal').textContent).toContain('выключен');
    await click(row('kinozal').querySelector('.src-row')!);
    expect(host.querySelector('.dialog-title')!.textContent).toBe(bypassWarning());
    const ok = Array.from(host.querySelectorAll('.dialog-option')).find((b) => b.textContent === 'Включить')!;
    await click(ok);
    expect(isCloudflareBypassOn(site('kinozal', 'Kinozal'))).toBe(true);
    expect(row('kinozal').querySelector('.src-act')!.textContent).toBe('вкл');
    await click(row('kinozal').querySelector('.src-row')!);
    expect(isCloudflareBypassOn(site('kinozal', 'Kinozal'))).toBe(false);
    expect(checks).toEqual([]);
  });

  it('no group without sites behind Cloudflare', async () => {
    unregisterSource('kinozal');
    unregisterSource('rustorka');
    await mount();
    expect(host.textContent).not.toContain('Сайты за Cloudflare');
  });
});
