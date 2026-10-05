import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { torrentby, isBanPage, codeSpec } from '../../src/sources/torrentby';
import { clearSourcePause, ipBanError, ipBanText, isIpBan, pauseSource, PAUSE_KEY, PAUSE_MS, sourcePaused } from '../../src/sources/ipBan';
import { phoneLoginRequest, setBrowserLoginPlatform, type BrowserSpec } from '../../src/sources/browserLogin';
import { getHealth, resetHealth, setHealth } from '../../src/sources/store';
import { healthText, ipBanNote } from '../../src/sources/view';
import { registerSource } from '../../src/sources/registry';
import { searchAll } from '../../src/sources/search';
import { fakeSite, fixture, page } from './fakeSite';

const BAN_RU = 'torrent.by просит ввести проверочный код';
const BAN_EN = 'torrent.by asks for a verification code';
const banSite = () => fakeSite((c) => page(fixture('torrentby-ban.html'), c.url));

beforeEach(() => {
  localStorage.clear();
  resetHealth();
  setBrowserLoginPlatform(null);
  registerSource(torrentby);
});

afterEach(() => {
  applyLanguageSetting('ru');
  setBrowserLoginPlatform(null);
  vi.useRealTimers();
});

describe('ipBan', () => {
  it('builds a typed error with the site name', () => {
    const e = ipBanError('torrent.by');
    expect(e.message).toBe(BAN_RU);
    expect(isIpBan(e)).toBe(true);
    expect(isIpBan(new Error(BAN_RU))).toBe(false);
    applyLanguageSetting('en');
    expect(ipBanText('torrent.by')).toBe(BAN_EN);
  });

  it('pauses a source for an hour in storage, prunes expired stamps and clears', () => {
    const now = 1_000_000;
    pauseSource('old', now - 2 * PAUSE_MS);
    pauseSource('torrentby', now);
    expect(sourcePaused('torrentby', now + PAUSE_MS - 1)).toBe(true);
    expect(sourcePaused('torrentby', now + PAUSE_MS)).toBe(false);
    expect(Object.keys(JSON.parse(localStorage.getItem(PAUSE_KEY)!))).toEqual(['torrentby']);
    clearSourcePause('torrentby', now);
    expect(sourcePaused('torrentby', now)).toBe(false);
    expect(JSON.parse(localStorage.getItem(PAUSE_KEY)!)).toEqual({});
  });

  it('ignores a broken storage value', () => {
    localStorage.setItem(PAUSE_KEY, '{"torrentby":"soon","x":null}');
    expect(sourcePaused('torrentby')).toBe(false);
    localStorage.setItem(PAUSE_KEY, 'not json');
    expect(sourcePaused('torrentby')).toBe(false);
  });
});

describe('torrentby code page', () => {
  it('recognises the ban page and nothing else', () => {
    expect(isBanPage(fixture('torrentby-ban.html'))).toBe(true);
    expect(isBanPage(fixture('torrentby-search.html'))).toBe(false);
    expect(isBanPage(fixture('torrentby-category.html'))).toBe(false);
  });

  it('rejects a search with the ban error and pauses the background requests', async () => {
    const err = await torrentby.search('x', banSite().ctx).then(
      () => null,
      (e) => e,
    );
    expect(isIpBan(err)).toBe(true);
    expect(err.message).toBe(BAN_RU);
    expect(sourcePaused('torrentby')).toBe(true);
  });

  it('records the ban in the health; the state line says it instead of «не отвечает»', async () => {
    const h = searchAll('x', { ctx: banSite().ctx, sources: ['torrentby'] });
    await h.done;
    const health = getHealth('torrentby')!;
    expect(health.state).toBe('error');
    expect(health.code).toBe('ipban');
    expect(healthText(health)).toEqual({ text: BAN_RU, tone: 'bad' });
    expect(ipBanNote('torrentby')).toBe(BAN_RU);
  });

  it('the pause alone tells the ban when there is no health yet (the background page saw it)', () => {
    expect(ipBanNote('torrentby')).toBe('');
    pauseSource('torrentby');
    expect(ipBanNote('torrentby')).toBe(BAN_RU);
    applyLanguageSetting('en');
    expect(ipBanNote('torrentby')).toBe(BAN_EN);
    setHealth('torrentby', { state: 'ok', at: Date.now() });
    expect(ipBanNote('torrentby')).toBe('');
  });

  it('background requests skip a paused site for an hour, a search the person starts still asks it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
    pauseSource('torrentby');
    const site = fakeSite((c) => page(fixture('torrentby-category.html'), c.url));
    const bg = { ...site.ctx, background: true };
    await expect(torrentby.latest!(bg, 'movie')).rejects.toThrow(BAN_RU);
    await expect(torrentby.search('x', bg)).rejects.toThrow(BAN_RU);
    expect(site.calls).toHaveLength(0);
    // the person's own search
    const user = fakeSite((c) => page(fixture('torrentby-search.html'), c.url));
    expect((await torrentby.search('x', user.ctx)).length).toBeGreaterThan(0);
    expect(user.calls).toHaveLength(1);
    // the answer ended the pause
    expect(sourcePaused('torrentby')).toBe(false);
    // a new ban: paused again, until the hour is over
    await expect(torrentby.search('x', banSite().ctx)).rejects.toThrow(BAN_RU);
    vi.setSystemTime(new Date(2026, 9, 5, 12, 59, 0));
    await expect(torrentby.latest!(bg, 'movie')).rejects.toThrow(BAN_RU);
    expect(site.calls).toHaveLength(0);
    vi.setSystemTime(new Date(2026, 9, 5, 13, 0, 1));
    expect((await torrentby.latest!(bg, 'movie')).length).toBeGreaterThan(0);
    expect(site.calls.map((c) => c.url)).toEqual(['https://torrent.by/films/']);
  });
});

describe('torrentby «Ввести код»', () => {
  it('opens the site in the browser sheet with its own copy, then clears the pause and checks the site once', async () => {
    pauseSource('torrentby');
    setHealth('torrentby', { state: 'error', at: 1, message: BAN_RU, code: 'ipban' });
    const opened: BrowserSpec[] = [];
    setBrowserLoginPlatform({
      login: (spec) => {
        opened.push(spec);
        return Promise.resolve({ result: 'cancelled' });
      },
    });
    const site = fakeSite((c) => page(fixture('torrentby-category.html'), c.url));
    expect(await torrentby.unblock!(site.ctx)).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].url).toBe('https://torrent.by/');
    expect(opened[0].hosts).toEqual(['torrent.by']);
    expect(opened[0].check).toEqual({ path: 'films/', marker: 'ttable_col1', loginPath: 'ban_free/' });
    expect(opened[0].title).toBe('Проверочный код torrent.by');
    expect(opened[0].cancel).toBe('Закрыть');
    expect(site.calls.map((c) => c.url)).toEqual(['https://torrent.by/films/']);
    expect(getHealth('torrentby')!.state).toBe('ok');
    expect(sourcePaused('torrentby')).toBe(false);
    expect(ipBanNote('torrentby')).toBe('');
  });

  it('a site still blocked after the sheet keeps the ban state', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'ok' }) });
    expect(await torrentby.unblock!(banSite().ctx)).toBe(true);
    expect(getHealth('torrentby')!.code).toBe('ipban');
    expect(sourcePaused('torrentby')).toBe(true);
  });

  it('resolves false and asks nothing when no sheet opens', async () => {
    const site = banSite();
    expect(await torrentby.unblock!(site.ctx)).toBe(false);
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'busy' }) });
    expect(await torrentby.unblock!(site.ctx)).toBe(false);
    expect(site.calls).toHaveLength(0);
  });

  it('the phone sheet carries the code copy instead of the sign-in one', () => {
    const r = phoneLoginRequest(codeSpec());
    expect(r.title).toBe('Проверочный код torrent.by');
    expect(r.text).toBe('Введите код с картинки на странице сайта и закройте окно — OMP проверит сайт снова.');
    expect(r.cancel).toBe('Закрыть');
    expect(r.source).toBe('torrentby');
    applyLanguageSetting('en');
    expect(phoneLoginRequest(codeSpec()).title).toBe('torrent.by verification code');
  });

  it('the code spec passes the native check rules (relative paths, a marker)', () => {
    const s = codeSpec();
    expect(s.check.path.charAt(0)).not.toBe('/');
    expect(s.check.loginPath.charAt(0)).not.toBe('/');
    expect(s.check.marker.length).toBeGreaterThan(0);
  });
});
