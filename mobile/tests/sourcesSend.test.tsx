import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch, type MockResponse } from '../../tests/helpers/fetchMock';
import { Sources, sentText, sendText, loginNotSent, transferPayload } from '../src/screens/Sources';
import { currentRoute } from '../src/nav';
import { resetTo } from '../src/nav';
import { cancelWarmUp, disconnectTv, sendSourcesToTv, setTransport, tvState, sourcesAtvOnly, sourcesBusy, sourcesNoAnswer, sourcesSecrets, tvForgot, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv, setActiveTv, type SavedTv } from '../src/tv/tvStore';
import { native } from '../src/platform/native';
import { toast } from '../src/ui/toast';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { logEntries, clearLog } from '../../src/lib/log';
import type { Source, SourceContext } from '../../src/sources/types';
import { indexerConnections, indexerKeyName, reloadIndexers } from '../../src/sources/indexerStore';
import { sourcesRejected } from '../src/tv/tvClient';
import { cloudflareNotSent, indexersNotSent, indexersText } from '../src/screens/Sources';
import { applyLanguageSetting } from '../../src/i18n';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATV: SavedTv = { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 };
const LG: SavedTv = { ip: '192.168.1.50', name: 'LG', clientKey: 'k' };
const BASE = 'http://192.168.1.40:8095';
// test-only values, not a real account
const PASSWORD = 'pa55-test-only';
let SECRETS: { [k: string]: string } = { 'rutracker.username': 'test-user', 'rutracker.password': PASSWORD };

interface Call {
  url: string;
  method: string;
  auth?: string;
  body: any;
}

let calls: Call[];
let answer: (c: Call) => MockResponse | Promise<MockResponse>;
let el: HTMLElement;

/** A fake OMP control server on the Android TV. */
function server() {
  return mockFetch((url, init) => {
    const c: Call = { url, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    if (url === BASE + '/omp/info') return { body: JSON.stringify({ name: 'Гостиная', version: '0.14.0', paired: true, foreground: true }) };
    return answer(c);
  });
}

const noSsap: TvTransport = {
  tvConnect: () => Promise.reject(new Error('ssap used')),
  tvSend: () => Promise.reject(new Error('ssap used')),
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: () => Promise.reject(new Error('ssap used')),
  pointerSend: () => Promise.reject(new Error('ssap used')),
  tvDisconnect: () => Promise.resolve(),
};

function ctx(): SourceContext {
  return {
    http: { get: () => Promise.reject(new Error('net')), post: () => Promise.reject(new Error('net')), clearCookies: () => Promise.resolve() },
    client: null,
    secrets: {
      get: (k) => Promise.resolve(Object.prototype.hasOwnProperty.call(SECRETS, k) ? SECRETS[k] : null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}

const rutrackerFake = (logged: boolean): Source => ({
  id: 'rutracker',
  name: 'rutracker',
  kind: 'builtin',
  needsLogin: true,
  search: () => Promise.resolve([]),
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  loggedIn: () => Promise.resolve(logged),
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Sources ctx={ctx} />, el));
  await flush();
}

const btn = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement | undefined;
const card = () => el.querySelector('[data-send="tv"]') as HTMLElement | null;
const sourcePosts = () => calls.filter((c) => c.method === 'POST' && c.url === BASE + '/omp/sources');

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  SECRETS = { 'rutracker.username': 'test-user', 'rutracker.password': PASSWORD };
  calls = [];
  answer = (c) => ({ body: JSON.stringify(c.body.rutracker ? { ok: true, rutracker: 'ok' } : { ok: true }) });
  toast.value = '';
  setTransport(noSsap);
  server();
  resetTo({ name: 'sources' });
  registerSource({ id: 'nnmclub', name: 'nnmclub', kind: 'builtin', search: () => Promise.resolve([]) });
});

afterEach(async () => {
  if (el) act(() => render(null, el));
  unregisterSource('nnmclub');
  unregisterSource('rutracker');
  vi.useRealTimers();
  cancelWarmUp();
  await disconnectTv();
  setTransport(native);
  vi.unstubAllGlobals();
});

describe('sendSourcesToTv (protocol)', () => {
  it('posts the payload with the token and reads the rutracker result', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    const payload = { v: 1, sources: { rutor: true }, rutracker: { username: 'test-user', password: PASSWORD } };
    expect(await sendSourcesToTv(payload)).toEqual({ rutracker: 'ok' });
    const post = sourcePosts()[0];
    expect(post.auth).toBe('Bearer ' + TOKEN);
    expect(post.body).toEqual(payload);
    expect(await sendSourcesToTv({ v: 1, sources: { rutor: false } })).toEqual({});
    answer = () => ({ body: JSON.stringify({ ok: true, rutracker: 'weird' }) });
    expect(await sendSourcesToTv(payload)).toEqual({ rutracker: 'error' });
  });

  it('maps the TV answers to Russian errors', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    const payload = { v: 1, sources: { rutor: true } };
    answer = () => ({ status: 409, body: '{"error":"busy"}' });
    await expect(sendSourcesToTv(payload)).rejects.toThrow(sourcesBusy());
    answer = () => ({ status: 503, body: '{"error":"no_answer"}' });
    await expect(sendSourcesToTv(payload)).rejects.toThrow(sourcesNoAnswer());
    answer = () => ({ status: 500, body: '{"error":"secrets"}' });
    await expect(sendSourcesToTv(payload)).rejects.toThrow(sourcesSecrets());
    answer = () => ({ status: 401, body: '{"error":"unauthorized"}' });
    await expect(sendSourcesToTv(payload)).rejects.toThrow(tvForgot());
    expect(tvState.value).toBe('error');
  });

  it('is only for an Android TV', async () => {
    saveTv(LG);
    setActiveTv(LG.ip);
    await expect(sendSourcesToTv({ v: 1, sources: { rutor: true } })).rejects.toThrow(sourcesAtvOnly());
    expect(calls).toHaveLength(0);
  });
});

describe('«Передать на телевизор» on the phone', () => {
  it('is hidden without a paired Android TV and for LG', async () => {
    await mount();
    expect(card()).toBeNull();
    saveTv(LG);
    setActiveTv(LG.ip);
    await mount();
    expect(card()).toBeNull();
    expect(el.textContent).not.toContain('Передать на телевизор');
  });

  it('sends the switches and the rutracker login, then says «Передано»', async () => {
    registerSource(rutrackerFake(true));
    setSourceOn('nnmclub', false);
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mount();
    expect(card()!.textContent).toContain('Android TV «Гостиная»');
    expect(card()!.textContent).toContain(sendText());
    const box = card()!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    const post = sourcePosts()[0];
    expect(post.body.v).toBe(1);
    expect(post.body.sources).toMatchObject({ 'ts-rutor': true, 'ts-torznab': true, nnmclub: false });
    expect(post.body.rutracker).toEqual({ username: 'test-user', password: PASSWORD });
    expect(toast.value).toBe('Передано');
    expect(card()!.textContent).toMatch(/Передано сегодня в \d\d:\d\d/);
    expect(card()!.textContent).toContain('подключён');
    // nothing secret in the log or the saved state
    expect(JSON.stringify(logEntries())).not.toContain(PASSWORD);
    expect(JSON.stringify(localStorage)).not.toContain(PASSWORD);
  });

  it('without the checkbox the login stays on the phone', async () => {
    registerSource(rutrackerFake(true));
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mount();
    const box = card()!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(sourcePosts()[0].body.rutracker).toBeUndefined();
  });

  it('no checkbox when the phone is not signed in to rutracker', async () => {
    registerSource(rutrackerFake(false));
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mount();
    expect(card()!.querySelector('input[type="checkbox"]')).toBeNull();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(sourcePosts()[0].body.rutracker).toBeUndefined();
  });

  it('shows the TV refusal of the login and errors inline', async () => {
    registerSource(rutrackerFake(true));
    saveTv(ATV);
    setActiveTv(ATV.ip);
    answer = () => ({ body: '{"ok":true,"rutracker":"bad_login"}' });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(toast.value).toBe(sentText('bad_login'));
    answer = () => ({ status: 503, body: '{"error":"no_answer"}' });
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(el.querySelector('[role="alert"]')!.textContent).toBe(sourcesNoAnswer());
  });

  it('after a 401 the card stays with the reason and «Подключить заново»', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    answer = () => ({ status: 401, body: '{"error":"unauthorized"}' });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(card()).not.toBeNull();
    expect(el.querySelector('[role="alert"]')!.textContent).toBe(tvForgot());
    expect(btn('Передать на телевизор')).toBeUndefined();
    act(() => btn('Подключить заново')!.click());
    expect(currentRoute.value.name).toBe('tv');
  });

  it('a login the TV would refuse is left out and the phone says so', async () => {
    registerSource(rutrackerFake(true));
    SECRETS = { 'rutracker.username': 'ab', 'rutracker.password': PASSWORD };
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    const post = sourcePosts()[0];
    expect(post.body.rutracker).toBeUndefined();
    expect(post.body.sources.nnmclub).toBe(true);
    expect(toast.value).toBe('Источники переданы. ' + loginNotSent());
    expect(() => transferPayload([], null)).toThrow('Не удалось подготовить источники к передаче');
    expect(transferPayload([{ id: 'rutor', name: 'rutor', kind: 'builtin', search: () => Promise.resolve([]) }], { username: 'u', password: 'p'.repeat(201) }).loginDropped).toBe(true);
  });

  it('a slow TV times out without ending the remote session', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mount();
    answer = () => new Promise<MockResponse>(() => {});
    vi.useFakeTimers();
    const p = sendSourcesToTv({ v: 1, sources: { rutor: true } });
    const done = expect(p).rejects.toThrow(sourcesNoAnswer());
    await vi.advanceTimersByTimeAsync(45000);
    await done;
    expect(tvState.value).toBe('connected');
  });
});

describe('«Передать на телевизор» with Jackett / Prowlarr', () => {
  // test-only key
  const KEY = 'test0only0key0000000000000000abc';

  function withJackett() {
    localStorage.setItem('tsp.indexers', JSON.stringify([{ kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true }]));
    reloadIndexers();
    SECRETS[indexerKeyName(indexerConnections()[0].id)] = KEY;
    saveTv(ATV);
    setActiveTv(ATV.ip);
  }

  afterEach(() => {
    localStorage.clear();
    reloadIndexers();
  });

  const keysBox = () =>
    Array.from(card()!.querySelectorAll('label')).find((l) => (l.textContent || '').indexOf('Вместе с ключами Jackett/Prowlarr') >= 0)!.querySelector('input') as HTMLInputElement;

  it('sends the connections with their keys by default; the answer and the log hold no key', async () => {
    withJackett();
    answer = () => ({ body: JSON.stringify({ ok: true, indexers: 1 }) });
    await mount();
    expect(keysBox().checked).toBe(true);
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    const post = sourcePosts()[0];
    expect(post.body.indexers).toEqual([{ kind: 'jackett', url: 'http://192.168.1.5:9117', key: KEY }]);
    expect(toast.value).toBe('Передано');
    expect(JSON.stringify(logEntries())).not.toContain(KEY);
    expect(JSON.stringify(localStorage)).not.toContain(KEY);
  });

  it('without «вместе с ключами» only the address goes', async () => {
    withJackett();
    answer = () => ({ body: JSON.stringify({ ok: true, indexers: 1 }) });
    await mount();
    act(() => {
      keysBox().checked = false;
      keysBox().dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(sourcePosts()[0].body.indexers).toEqual([{ kind: 'jackett', url: 'http://192.168.1.5:9117' }]);
    expect(JSON.stringify(sourcePosts()[0].body)).not.toContain(KEY);
  });

  it('a v0.15 TV refusing only the language gets everything else, and no «обновите OMP» note', async () => {
    withJackett();
    localStorage.setItem('tsp.flaresolverr', JSON.stringify({ url: 'http://192.168.1.191:8191' }));
    answer = (c) => (c.body.language !== undefined ? { status: 400, body: '{"error":"bad_request"}' } : { body: JSON.stringify({ ok: true, indexers: 1 }) });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(sourcePosts()).toHaveLength(2);
    expect(sourcePosts()[0].body.language).toBe('ru');
    const second = sourcePosts()[1].body;
    expect(second.language).toBeUndefined();
    expect(second.indexers).toEqual([{ kind: 'jackett', url: 'http://192.168.1.5:9117', key: KEY }]);
    expect(second.flaresolverr).toBe('http://192.168.1.191:8191');
    expect(toast.value).not.toContain('обновите OMP');
    expect(toast.value).not.toContain(indexersNotSent());
    expect(toast.value).not.toContain(cloudflareNotSent());
  });

  it('an older TV refusing the connections gets the rest, and the phone says so', async () => {
    withJackett();
    answer = (c) => (c.body.indexers ? { status: 400, body: '{"error":"bad_request"}' } : { body: JSON.stringify({ ok: true }) });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    // without the language first (a v0.15 TV), then without the v0.15 parts
    expect(sourcePosts()).toHaveLength(3);
    expect(sourcePosts()[2].body.indexers).toBeUndefined();
    expect(toast.value).toBe('Источники переданы. ' + indexersNotSent());
  });

  it('an older TV refusing the FlareSolverr address gets the rest, and the phone says the Cloudflare settings did not go', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    localStorage.setItem('tsp.flaresolverr', JSON.stringify({ url: 'http://192.168.1.191:8191' }));
    answer = (c) => (c.body.flaresolverr ? { status: 400, body: '{"error":"bad_request"}' } : { body: JSON.stringify({ ok: true }) });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    // without the language first (a v0.15 TV), then without the v0.15 parts
    expect(sourcePosts()).toHaveLength(3);
    expect(sourcePosts()[0].body.flaresolverr).toBe('http://192.168.1.191:8191');
    expect(sourcePosts()[2].body.flaresolverr).toBeUndefined();
    expect(toast.value).toBe('Источники переданы. ' + cloudflareNotSent());
  });

  it('a v0.14 TV answering 413 (8 KB limit) also gets the rest without the connections', async () => {
    withJackett();
    answer = (c) => (c.body.indexers ? { status: 413, body: '{"error":"too_large"}' } : { body: JSON.stringify({ ok: true }) });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    // without the language first (a v0.15 TV), then without the v0.15 parts
    expect(sourcePosts()).toHaveLength(3);
    expect(sourcePosts()[2].body.indexers).toBeUndefined();
    expect(toast.value).toBe('Источники переданы. ' + indexersNotSent());
  });

  it('the TV saved fewer than were sent', async () => {
    withJackett();
    answer = () => ({ body: JSON.stringify({ ok: true, indexers: 0 }) });
    await mount();
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(toast.value).toBe('Источники переданы. ' + indexersText(1, 0));
    expect(indexersText(2, 2)).toBe('');
    expect(indexersText(0, undefined)).toBe('');
  });

  it('protocol: 400 is «обновите OMP», the saved count is read', async () => {
    saveTv(ATV);
    setActiveTv(ATV.ip);
    const payload = { v: 1, sources: { rutor: true }, indexers: [{ kind: 'jackett' as const, url: 'http://192.168.1.5:9117', key: KEY }] };
    answer = () => ({ body: JSON.stringify({ ok: true, indexers: 1 }) });
    expect(await sendSourcesToTv(payload)).toEqual({ indexers: 1 });
    answer = () => ({ body: JSON.stringify({ ok: true, indexers: 99 }) });
    expect(await sendSourcesToTv(payload)).toEqual({ indexers: 0 });
    answer = () => ({ status: 400, body: '{"error":"bad_request"}' });
    await expect(sendSourcesToTv(payload)).rejects.toThrow(sourcesRejected());
  });
});

describe('transfer language', () => {
  it('the payload carries the phone resolved language', async () => {
    const list: Source[] = [{ id: 'rutor', name: 'rutor', kind: 'builtin', search: () => Promise.resolve([]) }];
    expect(transferPayload(list, null).payload.language).toBe('ru');
    applyLanguageSetting('en');
    expect(transferPayload(list, null).payload.language).toBe('en');
  });
});

describe('«Send to the TV» in English', () => {
  const ATV_EN: SavedTv = { ...ATV, name: 'Living room' };
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  const noCyrillic = (t: string) => expect(t).not.toMatch(/[А-Яа-яЁё]/);

  it('the card, the checkbox and the sent line', async () => {
    registerSource(rutrackerFake(true));
    saveTv(ATV_EN);
    setActiveTv(ATV_EN.ip);
    await mount();
    expect(card()!.textContent).toContain('Android TV “Living room”');
    expect(card()!.textContent).toContain(sendText());
    expect(sendText()).toBe('Send the enabled sources, the Jackett/Prowlarr connections and the site sign-ins to the TV. Passwords and keys go only to your TV over the pairing channel and are stored there encrypted.');
    expect(card()!.textContent).toContain('Together with the sign-in to rutracker');
    act(() => btn('Send to the TV')!.click());
    await flush();
    expect(toast.value).toBe('Sent');
    expect(card()!.textContent).toMatch(/Sent today at \d\d:\d\d/);
    expect(card()!.textContent).toContain('connected');
    noCyrillic(card()!.textContent!);
    expect(logEntries().some((e) => e.x.indexOf('Sources sent to the Android TV, rutracker sign-in: ok') === 0)).toBe(true);
    noCyrillic(JSON.stringify(logEntries().map((e) => e.x)));
  });

  it('the refusals: login, captcha, dropped login, partial connections', async () => {
    registerSource(rutrackerFake(true));
    saveTv(ATV_EN);
    setActiveTv(ATV_EN.ip);
    answer = () => ({ body: '{"ok":true,"rutracker":"bad_login"}' });
    await mount();
    act(() => btn('Send to the TV')!.click());
    await flush();
    expect(toast.value).toBe('Sources were sent, but rutracker did not accept the login or password');
    expect(sentText('captcha')).toBe('Sources were sent, but rutracker asks for a captcha — press “Sign in with the browser”');
    expect(sentText('error')).toBe('Sources were sent; the TV will check the rutracker sign-in during a search');
    expect(sentText(undefined)).toBe('Sent');
    expect(indexersText(2, 1)).toBe('Not all Jackett/Prowlarr connections were saved: 1 of 2');
    expect(indexersNotSent()).toBe('The Jackett/Prowlarr connections were not sent — update OMP on the TV');
    expect(cloudflareNotSent()).toBe('The Cloudflare bypass and FlareSolverr settings were not sent — update OMP on the TV');
    expect(loginNotSent()).toBe('The sign-in to rutracker was not sent: the login or password is too long or has invalid characters');
    expect(() => transferPayload([], null)).toThrow('Could not prepare the sources for sending');
  });

  it('a login the TV would refuse is left out and the phone says so', async () => {
    registerSource(rutrackerFake(true));
    // a control character in the login: the TV would refuse it
    SECRETS = { 'rutracker.username': 'ab', 'rutracker.password': PASSWORD };
    saveTv(ATV_EN);
    setActiveTv(ATV_EN.ip);
    await mount();
    act(() => btn('Send to the TV')!.click());
    await flush();
    expect(toast.value).toBe('Sources were sent. ' + loginNotSent());
  });

  it('a 401 keeps the card with «Connect again»', async () => {
    saveTv(ATV_EN);
    setActiveTv(ATV_EN.ip);
    answer = () => ({ status: 401, body: '{"error":"unauthorized"}' });
    await mount();
    act(() => btn('Send to the TV')!.click());
    await flush();
    expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(btn('Connect again')).toBeTruthy();
    expect(btn('Send to the TV')).toBeUndefined();
  });
});
