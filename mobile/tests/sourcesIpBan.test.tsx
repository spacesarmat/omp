import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Sources } from '../src/screens/Sources';
import { resetTo } from '../src/nav';
import { registerSource } from '../../src/sources/registry';
import { getHealth, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { setBrowserLoginPlatform, type BrowserOutcome, type BrowserSpec } from '../../src/sources/browserLogin';
import { pauseSource, sourcePaused } from '../../src/sources/ipBan';
import { torrentby } from '../../src/sources/torrentby';
import { fakeSite, fixture, page, type FakeSite } from '../../tests/sources/fakeSite';

const BAN = 'torrent.by просит ввести проверочный код';

let el: HTMLElement;
let site: FakeSite;
let banned: boolean;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Sources ctx={() => site.ctx} indexerEnv={() => ({ scan: null, readSettings: null, now: () => Date.now() })} />, el));
  await flush();
}

const row = () => (el.querySelector('[role="switch"][aria-label="torrent.by"]') as HTMLElement).closest('.m-src-row') as HTMLElement;
const note = () => row().querySelector('.m-src-note') as HTMLElement | null;
const codeBtn = () => row().querySelector('[data-action="enter-code"]') as HTMLButtonElement | null;

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetTo({ name: 'sources' });
  registerSource(torrentby);
  banned = true;
  site = fakeSite((c) => page(fixture(banned ? 'torrentby-ban.html' : 'torrentby-category.html'), c.url));
});

afterEach(() => {
  if (el) act(() => render(null, el));
  setBrowserLoginPlatform(null);
  applyLanguageSetting('ru');
});

describe('phone «Источники поиска»: torrent.by asks for a verification code', () => {
  it('the row says so and has «Ввести код» only in that state', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'cancelled' }) });
    await mount();
    expect(codeBtn()).toBeNull();
    act(() => setHealth('torrentby', { state: 'error', at: 1, message: 'Сайт ответил ошибкой 503' }));
    expect(note()!.textContent).toBe('не отвечает');
    expect(codeBtn()).toBeNull();
    act(() => setHealth('torrentby', { state: 'error', at: 2, message: BAN, code: 'ipban' }));
    expect(note()!.textContent).toBe(BAN);
    expect(note()!.className).toBe('m-src-note bad');
    expect(codeBtn()!.textContent).toBe('Ввести код');
    // a status-line link after the note, like «Войти»
    expect(codeBtn()!.className).toBe('m-src-link');
    expect(codeBtn()!.closest('.m-src-status')).toBe(note()!.parentElement);
    act(() => setHealth('torrentby', { state: 'ok', ms: 500, at: 3 }));
    expect(codeBtn()).toBeNull();
  });

  it('a pause the background page set shows the state before any search', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'cancelled' }) });
    pauseSource('torrentby');
    await mount();
    expect(note()!.textContent).toBe(BAN);
    expect(codeBtn()).toBeTruthy();
  });

  it('without a browser (outside the app) there is no button, only the message', async () => {
    setHealth('torrentby', { state: 'error', at: 2, message: BAN, code: 'ipban' });
    await mount();
    expect(note()!.textContent).toBe(BAN);
    expect(codeBtn()).toBeNull();
  });

  it('«Ввести код» opens the site in the native sheet; after it closes the site is checked once', async () => {
    const opened: BrowserSpec[] = [];
    let close: (r: BrowserOutcome) => void = () => undefined;
    setBrowserLoginPlatform({
      login: (spec) => {
        opened.push(spec);
        return new Promise<BrowserOutcome>((r) => (close = r));
      },
    });
    setHealth('torrentby', { state: 'error', at: 2, message: BAN, code: 'ipban' });
    pauseSource('torrentby');
    await mount();
    act(() => codeBtn()!.click());
    await flush();
    expect(opened).toHaveLength(1);
    expect(opened[0].url).toBe('https://torrent.by/');
    expect(codeBtn()!.disabled).toBe(true);
    expect(site.calls).toHaveLength(0);
    // the person entered the code and closed the sheet
    banned = false;
    close({ result: 'cancelled' });
    await flush();
    expect(site.calls.map((c) => c.url)).toEqual(['https://torrent.by/films/']);
    expect(getHealth('torrentby')!.state).toBe('ok');
    expect(sourcePaused('torrentby')).toBe(false);
    expect(note()!.textContent).toMatch(/^работает/);
    expect(codeBtn()).toBeNull();
  });

  it('still blocked after the sheet: the state and the button stay', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'cancelled' }) });
    setHealth('torrentby', { state: 'error', at: 2, message: BAN, code: 'ipban' });
    await mount();
    act(() => codeBtn()!.click());
    await flush();
    expect(site.calls).toHaveLength(1);
    expect(note()!.textContent).toBe(BAN);
    expect(codeBtn()!.disabled).toBe(false);
  });

  it('English', async () => {
    applyLanguageSetting('en');
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'cancelled' }) });
    pauseSource('torrentby');
    await mount();
    expect(note()!.textContent).toBe('torrent.by asks for a verification code');
    expect(codeBtn()!.textContent).toBe('Enter the code');
  });
});
