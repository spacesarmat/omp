import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRemoteLogins,
  buildTransferPayload,
  forgetSiteLogin,
  LOGIN_SITES,
  parseRemoteSources,
  siteLoginFromPhone,
  siteLoginsNotStored,
  siteLoginsState,
  transferLogins,
  validateTransferPayload,
  withoutNewParts,
} from '../../src/sources/transfer';
import { applyRemoteSourcesEvent, resetRemoteSources } from '../../src/platform/androidRemote';
import { getHealth, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import { kinozal } from '../../src/sources/kinozal';
import { resetMirrors } from '../../src/sources/mirrors';
import { rustorka } from '../../src/sources/rustorka';
import { siteLoginError } from '../../src/sources/siteLoginText';
import { fakeSite, fixture, page } from './fakeSite';
import type { HttpCall } from './fakeSite';
import type { Source, SourceContext } from '../../src/sources/types';

// test-only values
const PASS = 'pa55-test-only';

function src(id: string, extra?: Partial<Source>): Source {
  return { id, name: id, kind: 'builtin', search: () => Promise.resolve([]), ...extra };
}

beforeEach(() => {
  localStorage.clear();
  resetMirrors();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  resetRemoteSources();
});

describe('site logins in the transfer', () => {
  it('the schema takes logins of the known sites only (both sites behind Cloudflare included)', () => {
    const p = buildTransferPayload([kinozal, rustorka], null, undefined, null, {
      kinozal: { username: ' kino ', password: PASS },
      rustorka: { username: 'rus', password: PASS },
      evil: { username: 'x', password: 'y' },
    });
    expect(p.logins).toEqual({ kinozal: { username: 'kino', password: PASS }, rustorka: { username: 'rus', password: PASS } });
    expect(p.cloudflare).toEqual({ kinozal: false, rustorka: false });
    expect(validateTransferPayload(p)).toEqual(p);
    expect(LOGIN_SITES).toEqual(['kinozal', 'rustorka']);
    const base = { v: 1, sources: { kinozal: true } };
    const bad: unknown[] = [
      { rutracker: { username: 'a', password: 'p' } },
      {},
      [],
      { kinozal: { username: '', password: 'p' } },
      { kinozal: { username: 'a', password: '' } },
      { kinozal: { username: 'a', password: 'p', extra: 1 } },
      { kinozal: { username: 'a\u0001', password: 'p' } },
      { kinozal: 'a:p' },
      { kinozal: { username: 'a'.repeat(101), password: 'p' } },
      { kinozal: { username: 'a', password: 'p'.repeat(201) } },
    ];
    bad.forEach((logins) => expect(validateTransferPayload({ ...base, logins })).toBeNull());
    // nothing to send: no logins key; an older TV gets the payload without them
    expect(buildTransferPayload([kinozal], null, undefined, null, {}).logins).toBeUndefined();
    expect(withoutNewParts(p).logins).toBeUndefined();
  });

  it('reads the saved logins of the sites for the transfer (only the asked ones)', async () => {
    const site = fakeSite(() => page('', ''), {
      'kinozal.username': 'k',
      'kinozal.password': PASS,
      'rustorka.username': 'r',
      'rustorka.password': PASS,
    });
    const rutrackerLike = src('rutracker', { savedLogin: () => Promise.resolve({ username: 'no', password: 'no' }) });
    expect(await transferLogins([kinozal, rustorka, rutrackerLike], site.ctx)).toEqual({
      kinozal: { username: 'k', password: PASS },
      rustorka: { username: 'r', password: PASS },
    });
    expect(await transferLogins([kinozal, rustorka], site.ctx, ['rustorka'])).toEqual({ rustorka: { username: 'r', password: PASS } });
    const broken = src('kinozal', { savedLogin: () => Promise.reject(new Error('keystore')) });
    expect(await transferLogins([broken], site.ctx)).toEqual({});
  });

  it('the TV event names the staged sites only (no passwords), unknown sites are refused', () => {
    const r = parseRemoteSources({ id: 's1', sources: { kinozal: true }, rutracker: false, phone: 'Pixel', logins: { kinozal: true, rustorka: true } })!;
    expect(r.logins).toEqual(['kinozal', 'rustorka']);
    expect(parseRemoteSources({ id: 's1', sources: { kinozal: true }, phone: 'P', logins: { evil: true } })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { kinozal: true }, phone: 'P', logins: { kinozal: 'secret' } })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { kinozal: true }, phone: 'P' })!.logins).toBeUndefined();
  });

  it('checks each staged login in parallel: ok / wrong password / captcha / only ok is noted', async () => {
    setHealth('rustorka', { state: 'login', at: 1 });
    const ok = src('kinozal', { loginPending: () => Promise.resolve() });
    const bad = src('rustorka', { loginPending: () => Promise.reject(siteLoginError('bad_login', 'rustorka')) });
    const r = parseRemoteSources({ id: 's2', sources: { kinozal: true }, phone: 'P', logins: { kinozal: true, rustorka: true } })!;
    expect(parseRemoteSources({ id: 's2', sources: { kinozal: true }, phone: 'P', logins: { labtor: true } })).toBeNull();
    const res = await applyRemoteLogins(r, [ok, bad], () => fakeSite(() => page('', '')).ctx);
    expect(res).toEqual({ kinozal: 'ok', rustorka: 'bad_login' });
    expect(siteLoginFromPhone('kinozal')).toBe(true);
    expect(siteLoginFromPhone('rustorka')).toBe(false);
    // the TV keeps its earlier state for the refused one
    expect(getHealth('rustorka')!.state).toBe('login');
    forgetSiteLogin('kinozal');
    expect(siteLoginFromPhone('kinozal')).toBe(false);
  });

  it('a verified login the TV could not store is not claimed; the earlier note and state come back', async () => {
    const before = siteLoginsState();
    setHealth('kinozal', { state: 'error', at: 2, message: 'x' });
    const prev = siteLoginsState();
    const r = parseRemoteSources({ id: 's3', sources: { kinozal: true }, phone: 'P', logins: { kinozal: true } })!;
    await applyRemoteLogins(r, [src('kinozal', { loginPending: () => Promise.resolve() })], () => fakeSite(() => page('', '')).ctx);
    expect(siteLoginFromPhone('kinozal')).toBe(true);
    expect(getHealth('kinozal')).toBeNull();
    siteLoginsNotStored(['kinozal'], prev);
    expect(siteLoginFromPhone('kinozal')).toBe(false);
    expect(getHealth('kinozal')!.message).toBe('x');
    expect(before.fromPhone).toEqual({});
  });

  it('Android TV: the event signs in to each site through its real login flow and answers per site without secrets', async () => {
    const LOGIN = 'https://kinozal.me/takelogin.php';
    const http = (c: HttpCall) => {
      if (c.method === 'POST' && c.url === LOGIN) return c.form!.password === PASS ? page(fixture('kinozal-search.html'), 'https://kinozal.me/') : page(fixture('kinozal-login-error.html'), LOGIN);
      if (c.method === 'POST') return page(fixture('rustorka-login-captcha.html'), c.url);
      return page(fixture('kinozal-guest.html'), c.url);
    };
    const site = fakeSite(http, {
      'kinozal.pending.username': 'kino',
      'kinozal.pending.password': PASS,
      'rustorka.pending.username': 'rus',
      'rustorka.pending.password': 'other',
    });
    const calls: unknown[] = [];
    const done = (o: unknown) => {
      calls.push(o);
      return Promise.resolve({ stored: true, sitesNotStored: [] as string[] });
    };
    await applyRemoteSourcesEvent(
      { id: 's4', sources: { kinozal: true, rustorka: true }, rutracker: false, phone: 'Pixel', logins: { kinozal: true, rustorka: true } },
      { remoteSourcesDone: done },
      () => [kinozal, rustorka],
      (): SourceContext => site.ctx,
    );
    expect(calls).toEqual([{ id: 's4', logins: { kinozal: 'ok', rustorka: 'captcha' } }]);
    expect(siteLoginFromPhone('kinozal')).toBe(true);
    const text = JSON.stringify(logEntries());
    expect(text.indexOf(PASS)).toBe(-1);
    expect(text.indexOf('kino"')).toBe(-1);
    expect(text).toContain('вход на kinozal: ok');
  });

  it('Android TV: sites the native side could not store lose the note', async () => {
    const done = () => Promise.resolve({ stored: true, sitesNotStored: ['kinozal'] });
    await applyRemoteSourcesEvent(
      { id: 's5', sources: { kinozal: true }, rutracker: false, phone: 'Pixel', logins: { kinozal: true } },
      { remoteSourcesDone: done },
      () => [src('kinozal', { loginPending: () => Promise.resolve() })],
      () => fakeSite(() => page('', '')).ctx,
    );
    expect(siteLoginFromPhone('kinozal')).toBe(false);
    expect(logEntries().some((e) => e.x.indexOf('не сохранён на телевизоре: kinozal') >= 0)).toBe(true);
  });
});
