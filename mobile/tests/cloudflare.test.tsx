import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { handleTvRequest, installPhoneCloudflare, phoneChecker, resetTvRequests, watchTarget, type PhoneCloudflareDeps } from '../src/cloudflare';
import { SourceSite } from '../src/screens/SourceSite';
import { Sources } from '../src/screens/Sources';
import { currentRoute, resetTo } from '../src/nav';
import type { SavedTv } from '../src/tv/tvStore';
import type { TvCloudflareRequest } from '../src/platform/native';
import {
  BYPASS_WARNING,
  CHECK_BUSY,
  NOT_SENT_TO_TV,
  runCloudflareCheck,
  SENT_TO_TV,
  setCloudflareChecker,
  SHEET_NOTE_TV,
  GATE_WAIT,
  SHEET_TITLE,
  WATCH_NOTIFY,
  type CloudflareVisibleRequest,
} from '../../src/sources/cloudflareCheck';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { isCloudflareBypassOn, isSourceOn, reloadSourcePrefs, resetHealth, setCloudflareBypass } from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import type { Source, SourceContext } from '../../src/sources/types';
import type { BrowserLoginRequest } from '../../src/sources/browserLogin';
import { WATCH_NOTIFY_LOGIN } from '../../src/sources/browserLogin';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATV: SavedTv = { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 };
const site: Source = {
  id: 'rustorka',
  name: 'rustorka',
  kind: 'builtin',
  cloudflare: true,
  siteUrl: 'https://rustorka.example/',
  search: () => Promise.resolve([]),
};

const tick = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

/** A fake native side: records the sheets and the watch target, answers with `answer`. */
function fakeNative() {
  const f = {
    sheets: [] as CloudflareVisibleRequest[],
    watch: [] as ({ url: string; token: string; notify: string; notifyLogin?: string } | null)[],
    answer: { result: 'solved', sent: true } as { result?: string; sent?: boolean },
    pending: null as TvCloudflareRequest | null,
    listeners: [] as ((r: TvCloudflareRequest) => void)[],
    declined: [] as string[],
    cloudflareDecline(id: string) {
      f.declined.push(id);
      return Promise.resolve();
    },
    cloudflareVisible(req: CloudflareVisibleRequest) {
      f.sheets.push(req);
      return Promise.resolve(f.answer);
    },
    cloudflareWatch(t: { url: string; token: string; notify: string; notifyLogin?: string } | null) {
      f.watch.push(t);
      return Promise.resolve();
    },
    cloudflarePending() {
      return Promise.resolve(f.pending);
    },
    paired: [] as ({ url: string; token: string } | null)[],
    pairedTv(t: { url: string; token: string } | null) {
      f.paired.push(t);
      return Promise.resolve();
    },
    logins: [] as BrowserLoginRequest[],
    loginAnswer: { result: 'ok', sent: true } as { result?: string; sent?: boolean; host?: string },
    siteBrowserLogin(req: BrowserLoginRequest) {
      f.logins.push(req);
      return Promise.resolve(f.loginAnswer);
    },
    onCloudflareRequest(cb: (r: TvCloudflareRequest) => void) {
      f.listeners.push(cb);
      return () => {
        f.listeners = f.listeners.filter((x) => x !== cb);
      };
    },
  };
  return f;
}

let toasts: string[];
let visible: (() => void)[];

function deps(n: ReturnType<typeof fakeNative>, tv: () => SavedTv | null, bypassOn: () => boolean = () => true): PhoneCloudflareDeps {
  return {
    native: n,
    toast: (t) => toasts.push(t),
    tv,
    bypassOn,
    onVisible: (cb) => {
      visible.push(cb);
      return () => {
        visible = visible.filter((x) => x !== cb);
      };
    },
  };
}

const request: TvCloudflareRequest = { id: 'c7', site: 'rustorka', url: 'https://rustorka.example/' };

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  resetTvRequests();
  toasts = [];
  visible = [];
  registerSource(site);
});
afterEach(() => {
  setCloudflareChecker(null);
  unregisterSource('rustorka');
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
});

describe('phone: the visible check', () => {
  it('a search on the phone opens the sheet without the TV line', async () => {
    const n = fakeNative();
    setCloudflareChecker(phoneChecker(n));
    expect(await runCloudflareCheck('rustorka', 'https://rustorka.example/tracker.php?nm=x')).toBe('solved');
    expect(n.sheets).toEqual([
      { url: 'https://rustorka.example/', site: 'rustorka', mode: 'phone', title: SHEET_TITLE, text: 'Сайт rustorka просит пройти проверку Cloudflare.', cancel: 'Отмена', gateWait: GATE_WAIT },
    ]);
  });

  it('a TV request for a site that is not known here (or whose switch is off) is declined without a sheet', async () => {
    const n = fakeNative();
    const d = deps(n, () => ATV);
    // the switch is off
    await handleTvRequest(request, d);
    setCloudflareBypass('rustorka', true);
    // another host, another port, another scheme, not a root
    await handleTvRequest({ id: 'x1', site: 'rustorka', url: 'https://evil.example/' }, d);
    await handleTvRequest({ id: 'x2', site: 'rustorka', url: 'https://rustorka.example:8443/' }, d);
    await handleTvRequest({ id: 'x3', site: 'rustorka', url: 'http://rustorka.example/' }, d);
    expect(n.sheets).toEqual([]);
    expect(n.declined).toEqual(['c7', 'x1', 'x2', 'x3']);
    expect(logEntries().map((e) => e.x).join('\n')).not.toContain('evil');
  });

  it('the TV asked: the sheet names the TV, the answer goes natively, the phone says whether it got there', async () => {
    setCloudflareBypass('rustorka', true);
    const n = fakeNative();
    const d = deps(n, () => ATV);
    // the TV's own site name is not trusted: the phone's name for the site is shown
    await handleTvRequest({ ...request, site: 'Войдите в банк' }, d);
    expect(n.sheets[0].text).toBe('Сайт rustorka просит пройти проверку Cloudflare. Это нужно для телевизора «Гостиная».');
    expect(n.sheets[0].note).toBe(SHEET_NOTE_TV);
    expect(n.sheets[0].forTv).toBe('c7');
    expect(toasts).toEqual([SENT_TO_TV]);
    // the same request again (event + pending): shown once
    await handleTvRequest(request, d);
    expect(n.sheets.length).toBe(1);
    n.answer = { result: 'solved', sent: false };
    await handleTvRequest({ ...request, id: 'c8' }, d);
    expect(toasts[1]).toBe(NOT_SENT_TO_TV);
    n.answer = { result: 'busy' };
    await handleTvRequest({ ...request, id: 'c9' }, d);
    expect(toasts[2]).toBe(CHECK_BUSY);
    n.answer = { result: 'cancelled' };
    await handleTvRequest({ ...request, id: 'c10' }, d);
    // the TV passed it itself meanwhile
    n.answer = { result: 'done' };
    await handleTvRequest({ ...request, id: 'c13' }, d);
    expect(toasts.length).toBe(3);
    const lines = logEntries().map((e) => e.x).join('\n');
    expect(lines).toContain('Cloudflare: проверка пройдена · rustorka');
    expect(lines).not.toContain('rustorka.example');
    expect(lines).not.toContain(TOKEN);
  });

  it('watches the paired Android TV only, and shows its waiting request on start and when the app comes back', async () => {
    expect(watchTarget(null)).toBeNull();
    expect(watchTarget({ ip: '192.168.1.50', name: 'LG', clientKey: 'k' })).toBeNull();
    expect(watchTarget({ ...ATV, token: undefined })).toBeNull();
    expect(watchTarget(ATV)).toEqual({ url: 'http://192.168.1.40:8095', token: TOKEN, notify: WATCH_NOTIFY, notifyLogin: WATCH_NOTIFY_LOGIN });
    const tv = signal<SavedTv | null>(null);
    const n = fakeNative();
    n.pending = request;
    setCloudflareBypass('rustorka', true);
    const off = installPhoneCloudflare(deps(n, () => tv.value, () => isCloudflareBypassOn(site)));
    await tick();
    expect(n.watch).toEqual([null]);
    expect(n.sheets.length).toBe(1);
    tv.value = ATV;
    expect(n.watch[1]).toEqual({ url: 'http://192.168.1.40:8095', token: TOKEN, notify: WATCH_NOTIFY, notifyLogin: WATCH_NOTIFY_LOGIN });
    // the paired TV is registered natively whatever the polling (session cookies go only there)
    expect(n.paired).toEqual([null, { url: 'http://192.168.1.40:8095', token: TOKEN }]);
    // no site with the switch on: the phone stops listening to the TV
    setCloudflareBypass('rustorka', false);
    expect(n.watch[2]).toBeNull();
    expect(n.paired.length).toBe(2);
    setCloudflareBypass('rustorka', true);
    expect(n.watch[3]).toEqual({ url: 'http://192.168.1.40:8095', token: TOKEN, notify: WATCH_NOTIFY, notifyLogin: WATCH_NOTIFY_LOGIN });
    // a live event
    n.listeners[0]({ ...request, id: 'c11' });
    await tick();
    expect(n.sheets.map((s) => s.forTv)).toEqual(['c7', 'c11']);
    // back from the notification
    n.pending = { ...request, id: 'c12' };
    visible.forEach((cb) => cb());
    await tick();
    expect(n.sheets.map((s) => s.forTv)).toEqual(['c7', 'c11', 'c12']);
    // the phone checker is registered for searches
    expect(await runCloudflareCheck('rustorka', 'https://rustorka.example/')).toBe('solved');
    off();
    expect(n.listeners.length).toBe(0);
  });
});

describe('phone: a site behind Cloudflare (mockup PhoneSite)', () => {
  async function mount(until: number | null) {
    document.body.innerHTML = '<div id="app"></div>';
    const el = document.getElementById('app')!;
    const now = new Date(2026, 9, 4, 20, 0).getTime();
    act(() => render(<SourceSite id="rustorka" clearance={() => Promise.resolve(until)} now={() => now} />, el));
    await tick();
    return el;
  }

  it('the switch is off by default, persists, and shows the warning and the clearance time', async () => {
    const el = await mount(new Date(2026, 9, 4, 22, 40).getTime());
    expect(el.querySelector('h1')!.textContent).toBe('rustorka');
    expect(el.querySelector('[data-note="cloudflare-warning"]')!.textContent).toBe(BYPASS_WARNING);
    const bypass = el.querySelector('[aria-label="Обходить проверку Cloudflare"]') as HTMLButtonElement;
    expect(bypass.getAttribute('aria-checked')).toBe('false');
    // off: no status line
    expect(el.textContent).not.toContain('действует до');
    act(() => bypass.click());
    await tick();
    expect(isCloudflareBypassOn(site)).toBe(true);
    reloadSourcePrefs();
    expect(isCloudflareBypassOn(site)).toBe(true);
    expect(el.querySelector('[data-bypass="on"] .m-src-note')!.textContent).toBe('проверка пройдена · действует до 22:40');
    const search = el.querySelector('[aria-label="Искать на rustorka"]') as HTMLButtonElement;
    act(() => search.click());
    await tick();
    expect(isSourceOn(site)).toBe(false);
    expect(isCloudflareBypassOn(site)).toBe(true);
  });

  it('an expired clearance shows no status', async () => {
    const el = await mount(new Date(2026, 9, 4, 19, 0).getTime());
    act(() => (el.querySelector('[aria-label="Обходить проверку Cloudflare"]') as HTMLButtonElement).click());
    await tick();
    expect(el.textContent).not.toContain('действует до');
  });

  it('«Источники поиска» opens the site\'s screen', async () => {
    resetTo({ name: 'sources' });
    document.body.innerHTML = '<div id="app"></div>';
    const el = document.getElementById('app')!;
    const ctx = (): SourceContext => ({
      http: { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() },
      client: null,
    });
    act(() => render(<Sources ctx={ctx} indexerEnv={() => ({ scan: null, readSettings: null, now: () => Date.now() })} />, el));
    await tick();
    const open = el.querySelector('[data-open="rustorka"]') as HTMLButtonElement;
    act(() => open.click());
    expect(currentRoute.value).toEqual({ name: 'sourceSite', id: 'rustorka' });
  });
});
