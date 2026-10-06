import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyRemoteSources,
  buildTransferPayload,
  forgetTransferredLogin,
  lastTransfer,
  onTransferApplied,
  parseRemoteSources,
  transferWhen,
  validateTransferPayload,
  withoutNewParts,
  MAX_TRANSFER_SOURCES,
} from '../../src/sources/transfer';
import { settings, resetSettings, updateSettings } from '../../src/store/settings';
import { lang } from '../../src/i18n';
import { rutracker, rutrackerLoginPending, rutrackerSavedLogin, rutrackerCaptcha } from '../../src/sources/rutracker';
import { getHealth, isSourceOn, reloadSourcePrefs, resetHealth, setHealth, setSourceOn } from '../../src/sources/store';
import { fakeSite, fixture, page } from './fakeSite';
import type { HttpCall } from './fakeSite';
import type { Source } from '../../src/sources/types';

const LOGIN_URL = 'https://rutracker.org/forum/login.php';
// test-only values, not a real account
const PASSWORD = 'pa55-test-only';
const CREDS = { 'rutracker.username': 'test-user', 'rutracker.password': PASSWORD };
const NEW_PASSWORD = 'new-pa55-test-only';
const PENDING = { 'rutracker.pending.username': 'new-user', 'rutracker.pending.password': NEW_PASSWORD };

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
    // rutracker needs a login: off by default; it is behind Cloudflare, so its switch (off) travels too
    expect(p).toEqual({ v: 1, sources: { 'ts-rutor': true, rutor: true, nnmclub: false, rutracker: false }, cloudflare: { rutracker: false } });
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
      // C1 too, like Kotlin isISOControl()
      { ...ok, rutracker: { username: 'a\u0085b', password: PASSWORD } },
      { ...ok, rutracker: { username: 'a\u009fb', password: PASSWORD } },
    ];
    bad.forEach((b) => expect(validateTransferPayload(b)).toBeNull());
  });
});

describe('remoteSources event (TV)', () => {
  it('parses the event and never needs a password in it', () => {
    expect(parseRemoteSources({ id: 's1', sources: { rutor: false }, rutracker: true, phone: 'Pixel\u0007\u0085 8', at: 7 })).toEqual({
      id: 's1',
      sources: { rutor: false },
      rutracker: true,
      phone: 'Pixel 8',
      at: 7,
    });
    expect(parseRemoteSources({ id: 's1', sources: { rutor: false } })).toMatchObject({ phone: 'Телефон', at: 0 });
    expect(parseRemoteSources({ id: '', sources: { rutor: true } })).toBeNull();
    expect(parseRemoteSources({ id: 's1', sources: { rutor: 1 } })).toBeNull();
    expect(parseRemoteSources('x')).toBeNull();
  });

  it('applies the switches of known sources and records the transfer', async () => {
    let heard = 0;
    const off = onTransferApplied(() => heard++);
    const site = fakeSite(loginServer());
    const r = await applyRemoteSources(
      { id: 's1', sources: { rutor: false, nnmclub: true, unknown: false }, rutracker: false, phone: 'Pixel 8', at: 0 },
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

  it('signs in with the staged login and stores nothing itself', async () => {
    const site = fakeSite(loginServer(), PENDING);
    setHealth('rutracker', { state: 'login', at: 1 });
    const r = await applyRemoteSources({ id: 's2', sources: { rutracker: true }, rutracker: true, phone: 'Pixel', at: 0 }, KNOWN, () => site.ctx, () => 5);
    expect(r).toBe('ok');
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['POST ' + LOGIN_URL]);
    expect(site.calls[0].form!.login_username).toBe('new-user');
    expect(site.calls[0].form!.login_password).toBe(NEW_PASSWORD);
    // the native side promotes it; the page never writes the live entries
    expect(site.secrets).toEqual(PENDING);
    expect(getHealth('rutracker')).toBeNull();
    expect(lastTransfer()).toEqual({ at: 5, phone: 'Pixel', rutracker: true });
    // the record never holds the login
    expect(localStorage.getItem('tsp.sourcesTransfer')).not.toContain(NEW_PASSWORD);
    expect(localStorage.getItem('tsp.sourcesTransfer')).not.toContain('new-user');
    // a later transfer without the login keeps the note
    await applyRemoteSources({ id: 's3', sources: { rutor: true }, rutracker: false, phone: 'Pixel', at: 0 }, KNOWN, () => site.ctx, () => 6);
    expect(lastTransfer()!.rutracker).toBe(true);
    forgetTransferredLogin();
    expect(lastTransfer()!.rutracker).toBe(false);
  });

  it('a refused login keeps the earlier working one and its state', async () => {
    const both = { ...CREDS, ...PENDING };
    const cases: [string | undefined, string][] = [
      ['rutracker-login-error.html', 'bad_login'],
      ['rutracker-login-captcha.html', 'captcha'],
      [undefined, 'error'],
    ];
    for (const [pageName, result] of cases) {
      setHealth('rutracker', { state: 'ok', ms: 500, at: 1 });
      const site = pageName ? fakeSite(loginServer(pageName), both) : fakeSite(() => Promise.reject(new Error('Нет ответа от сайта')), both);
      expect(await applyRemoteSources({ id: 'x' + result, sources: { rutracker: true }, rutracker: true, phone: 'P', at: 0 }, KNOWN, () => site.ctx)).toBe(result);
      // the page reads the staged pair only and never deletes the live login
      expect(site.calls[0].form!.login_password).toBe(NEW_PASSWORD);
      expect(site.secrets).toEqual(both);
      expect(getHealth('rutracker')!.state).toBe('ok');
    }

    // nothing staged (storage failed on the way): «error», no request
    const empty = fakeSite(loginServer(), CREDS);
    expect(await applyRemoteSources({ id: 'd', sources: { rutracker: true }, rutracker: true, phone: 'P', at: 0 }, KNOWN, () => empty.ctx)).toBe('error');
    expect(empty.calls).toHaveLength(0);
  });
});

describe('rutracker saved and staged login', () => {
  it('reads both parts or nothing', async () => {
    expect(await rutrackerSavedLogin(fakeSite(loginServer(), CREDS).ctx.secrets!)).toEqual({ username: 'test-user', password: PASSWORD });
    expect(await rutrackerSavedLogin(fakeSite(loginServer(), { 'rutracker.username': 'u' }).ctx.secrets!)).toBeNull();
  });

  it('the staged login needs a store and leaves the storage alone', async () => {
    await expect(rutrackerLoginPending(fakeSite(loginServer(), null).ctx)).rejects.toThrow('Вход доступен только в приложении Android');
    const c = fakeSite(loginServer('rutracker-login-captcha.html'), PENDING);
    await expect(rutrackerLoginPending(c.ctx)).rejects.toThrow(rutrackerCaptcha());
    expect(c.secrets).toEqual(PENDING);
  });
});

describe('transferWhen', () => {
  it('says today, yesterday or the date', () => {
    const now = new Date(2026, 9, 3, 20, 0).getTime();
    expect(transferWhen(new Date(2026, 9, 3, 18, 40).getTime(), now)).toEqual({ day: 'сегодня', time: '18:40' });
    expect(transferWhen(new Date(2026, 9, 2, 9, 5).getTime(), now)).toEqual({ day: 'вчера', time: '09:05' });
    expect(transferWhen(new Date(2026, 8, 30, 7, 0).getTime(), now)).toEqual({ day: '30 сент.', time: '07:00' });
    expect(transferWhen(new Date(2025, 0, 9, 7, 0).getTime(), now).day).toBe('9 янв. 2025');
  });
});

describe('transfer language', () => {
  afterEach(() => resetSettings());
  it('the payload carries the phone language when given; the TV accepts only ru / en', () => {
    const p = buildTransferPayload(KNOWN, null, undefined, null, null, 'en');
    expect(p.language).toBe('en');
    expect(validateTransferPayload(p)).toEqual(p);
    expect(buildTransferPayload(KNOWN, null).language).toBeUndefined();
    expect(validateTransferPayload({ ...p, language: 'de' })).toBeNull();
    expect(validateTransferPayload({ ...p, language: 1 })).toBeNull();
  });
  it('an older TV gets the payload without it', () => {
    const p = buildTransferPayload(KNOWN, null, undefined, null, null, 'en');
    expect(withoutNewParts(p).language).toBeUndefined();
  });
  it('the TV reads it from the event and stores it as its language', async () => {
    const r = parseRemoteSources({ id: 'l', sources: { rutor: true }, rutracker: false, phone: 'P', at: 0, language: 'en' })!;
    expect(r.language).toBe('en');
    expect(parseRemoteSources({ id: 'l', sources: { rutor: true }, rutracker: false, phone: 'P', at: 0, language: 'de' })!.language).toBeUndefined();
    await applyRemoteSources(r, KNOWN, () => fakeSite(loginServer(), null).ctx);
    expect(settings.value.language).toBe('en');
    expect(lang.value).toBe('en');
  });
  it('without it the TV keeps its language', async () => {
    updateSettings({ language: 'ru' });
    const r = parseRemoteSources({ id: 'm', sources: { rutor: true }, rutracker: false, phone: 'P', at: 0 })!;
    await applyRemoteSources(r, KNOWN, () => fakeSite(loginServer(), null).ctx);
    expect(settings.value.language).toBe('ru');
  });
});
