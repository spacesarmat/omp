import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRemoteSources,
  buildTransferPayload,
  forgetTransferredLogin,
  lastTransfer,
  onTransferApplied,
  parseRemoteSources,
  transferWhen,
  validateTransferPayload,
  MAX_TRANSFER_SOURCES,
} from '../../src/sources/transfer';
import { rutracker, rutrackerLoginSaved, rutrackerSavedLogin, RUTRACKER_CAPTCHA } from '../../src/sources/rutracker';
import { getHealth, isSourceOn, reloadSourcePrefs, resetHealth, setHealth, setSourceOn } from '../../src/sources/store';
import { fakeSite, fixture, page } from './fakeSite';
import type { HttpCall } from './fakeSite';
import type { Source } from '../../src/sources/types';

const LOGIN_URL = 'https://rutracker.org/forum/login.php';
// test-only values, not a real account
const PASSWORD = 'pa55-test-only';
const CREDS = { 'rutracker.username': 'test-user', 'rutracker.password': PASSWORD };

function src(id: string, needsLogin = false): Source {
  return { id, name: id, kind: 'builtin', needsLogin, search: () => Promise.resolve([]) };
}

const KNOWN: Source[] = [src('ts-rutor'), src('rutor'), src('nnmclub'), rutracker];

function loginServer(loginPage?: string) {
  return (c: HttpCall) => {
    if (c.method === 'POST' && c.url === LOGIN_URL) {
      if (loginPage) return page(fixture(loginPage), LOGIN_URL);
      return page(fixture('rutracker-detail.html'), 'https://rutracker.org/forum/index.php');
    }
    return Promise.reject(new Error('Нет ответа от сайта'));
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
});

describe('transfer payload (phone)', () => {
  it('carries every switch and the login only when given', () => {
    setSourceOn('nnmclub', false);
    const p = buildTransferPayload(KNOWN, null);
    // rutracker needs a login: off by default
    expect(p).toEqual({ v: 1, sources: { 'ts-rutor': true, rutor: true, nnmclub: false, rutracker: false } });
    const withLogin = buildTransferPayload(KNOWN, { username: ' test-user ', password: PASSWORD });
    expect(withLogin.rutracker).toEqual({ username: 'test-user', password: PASSWORD });
    expect(validateTransferPayload(withLogin)).toEqual(withLogin);
    expect(validateTransferPayload(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('refuses what the TV refuses', () => {
    const ok = { v: 1, sources: { rutor: true } };
    expect(validateTransferPayload(ok)).toEqual(ok);
    expect(validateTransferPayload({ ...ok, rutracker: null })).toEqual(ok);
    const many: { [id: string]: boolean } = {};
    for (let i = 0; i <= MAX_TRANSFER_SOURCES; i++) many['s' + i] = true;
    const bad: unknown[] = [
      null,
      [],
      { sources: { rutor: true } },
      { v: 2, sources: { rutor: true } },
      { v: 1, sources: {} },
      { v: 1, sources: many },
      { v: 1, sources: { Rutor: true } },
      { v: 1, sources: { '../x': true } },
      { v: 1, sources: { rutor: 'yes' } },
      { ...ok, extra: 1 },
      { ...ok, rutracker: 'test-user' },
      { ...ok, rutracker: { username: ' ', password: PASSWORD } },
      { ...ok, rutracker: { username: 'u', password: '' } },
      { ...ok, rutracker: { username: 'u'.repeat(101), password: PASSWORD } },
      { ...ok, rutracker: { username: 'u', password: 'p'.repeat(201) } },
      { ...ok, rutracker: { username: 'a\u0007b', password: PASSWORD } },
    ];
    bad.forEach((b) => expect(validateTransferPayload(b)).toBeNull());
  });
});

describe('remoteSources event (TV)', () => {
  it('parses the event and never needs a password in it', () => {
    expect(parseRemoteSources({ id: 's1', sources: { rutor: false }, rutracker: true, phone: 'Pixel\u0007 8' })).toEqual({
      id: 's1',
      sources: { rutor: false },
      rutracker: true,
      phone: 'Pixel 8',
    });
    expect(parseRemoteSources({ id: 's1', sources: { rutor: false } })!.phone).toBe('Телефон');
    expect(parseRemoteSources({ id: '', sources: { rutor: true } })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { rutor: 1 } })).toBeNull();
    expect(parseRemoteSources('x')).toBeNull();
  });

  it('applies the switches of known sources and records the transfer', async () => {
    let heard = 0;
    const off = onTransferApplied(() => heard++);
    const site = fakeSite(loginServer());
    const r = await applyRemoteSources(
      { id: 's1', sources: { rutor: false, nnmclub: true, unknown: false }, rutracker: false, phone: 'Pixel 8' },
      KNOWN,
      () => site.ctx,
      () => 1000,
    );
    off();
    expect(r).toBeUndefined();
    expect(isSourceOn(src('rutor'))).toBe(false);
    expect(isSourceOn(src('nnmclub'))).toBe(true);
    expect(localStorage.getItem('tsp.sources')).not.toContain('unknown');
    expect(lastTransfer()).toEqual({ at: 1000, phone: 'Pixel 8', rutracker: false });
    expect(site.calls).toHaveLength(0);
    expect(heard).toBeGreaterThan(0);
  });

  it('signs in with the login the native side saved', async () => {
    const site = fakeSite(loginServer(), CREDS);
    setHealth('rutracker', { state: 'login', at: 1 });
    const r = await applyRemoteSources({ id: 's2', sources: { rutracker: true }, rutracker: true, phone: 'Pixel' }, KNOWN, () => site.ctx, () => 5);
    expect(r).toBe('ok');
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['POST ' + LOGIN_URL]);
    expect(site.calls[0].form!.login_password).toBe(PASSWORD);
    expect(getHealth('rutracker')).toBeNull();
    expect(lastTransfer()).toEqual({ at: 5, phone: 'Pixel', rutracker: true });
    // the record never holds the login
    expect(localStorage.getItem('tsp.sourcesTransfer')).not.toContain(PASSWORD);
    expect(localStorage.getItem('tsp.sourcesTransfer')).not.toContain('test-user');
    // a later transfer without the login keeps the note
    await applyRemoteSources({ id: 's3', sources: { rutor: true }, rutracker: false, phone: 'Pixel' }, KNOWN, () => site.ctx, () => 6);
    expect(lastTransfer()!.rutracker).toBe(true);
    forgetTransferredLogin();
    expect(lastTransfer()!.rutracker).toBe(false);
  });

  it('a wrong login is forgotten, a captcha keeps it, a network error is «error»', async () => {
    const wrong = fakeSite(loginServer('rutracker-login-error.html'), CREDS);
    expect(await applyRemoteSources({ id: 'a', sources: { rutracker: true }, rutracker: true, phone: 'P' }, KNOWN, () => wrong.ctx)).toBe('bad_login');
    expect(wrong.secrets).toEqual({});
    expect(getHealth('rutracker')!.state).toBe('login');
    expect(lastTransfer()!.rutracker).toBe(false);

    const captcha = fakeSite(loginServer('rutracker-login-captcha.html'), CREDS);
    expect(await applyRemoteSources({ id: 'b', sources: { rutracker: true }, rutracker: true, phone: 'P' }, KNOWN, () => captcha.ctx)).toBe('captcha');
    expect(captcha.secrets).toEqual(CREDS);

    const down = fakeSite(() => Promise.reject(new Error('Нет ответа от сайта')), CREDS);
    expect(await applyRemoteSources({ id: 'c', sources: { rutracker: true }, rutracker: true, phone: 'P' }, KNOWN, () => down.ctx)).toBe('error');
    expect(down.secrets).toEqual(CREDS);

    // nothing saved (storage failed on the way): «error», no request
    const empty = fakeSite(loginServer(), {});
    expect(await applyRemoteSources({ id: 'd', sources: { rutracker: true }, rutracker: true, phone: 'P' }, KNOWN, () => empty.ctx)).toBe('error');
    expect(empty.calls).toHaveLength(0);
  });
});

describe('rutracker saved login', () => {
  it('reads both parts or nothing', async () => {
    expect(await rutrackerSavedLogin(fakeSite(loginServer(), CREDS).ctx.secrets!)).toEqual({ username: 'test-user', password: PASSWORD });
    expect(await rutrackerSavedLogin(fakeSite(loginServer(), { 'rutracker.username': 'u' }).ctx.secrets!)).toBeNull();
  });

  it('rejects without a store and keeps the login on a captcha', async () => {
    await expect(rutrackerLoginSaved(fakeSite(loginServer(), null).ctx)).rejects.toThrow('Вход доступен только в приложении Android');
    const c = fakeSite(loginServer('rutracker-login-captcha.html'), CREDS);
    await expect(rutrackerLoginSaved(c.ctx)).rejects.toThrow(RUTRACKER_CAPTCHA);
    expect(c.secrets).toEqual(CREDS);
  });
});

describe('transferWhen', () => {
  it('says today, yesterday or the date', () => {
    const now = new Date(2026, 9, 3, 20, 0).getTime();
    expect(transferWhen(new Date(2026, 9, 3, 18, 40).getTime(), now)).toEqual({ day: 'сегодня', time: '18:40' });
    expect(transferWhen(new Date(2026, 9, 2, 9, 5).getTime(), now)).toEqual({ day: 'вчера', time: '09:05' });
    expect(transferWhen(new Date(2026, 8, 30, 7, 0).getTime(), now)).toEqual({ day: '30.09.2026', time: '07:00' });
  });
});
