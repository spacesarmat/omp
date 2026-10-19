// Android: the refresh token lives in the app (BillingTokens.kt); every page, the background check and the TV search
// server included, renews the access token through it. Here a fake with the same contract: one refresh at a time for the
// process, a fresher token handed to a page that waited, the rotated token kept natively only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN } from '../../src/billing/config';
import { billingNotice, billingSession, saveBillingSession } from '../../src/billing/session';
import { allowBillingRefresh, resetBillingTokens, startBillingKeepAlive } from '../../src/billing/tokens';
import { activateCode, clearBilling, fetchBillingAccount, ompJackettSource } from '../../src/sources/ompJackett';
import { unregisterSource } from '../../src/sources/registry';
import type { NativeBilling, NativeBillingAnswer, SourceContext } from '../../src/sources/types';
import { fakeSite, page, type HttpCall } from '../sources/fakeSite';

const HOUR = 60 * 60 * 1000;
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
const ME = JSON.stringify({ telegramId: '', paidUntil: 2e12, active: true, accessUntil: 2e12 });

interface FakeApp extends Required<NativeBilling> {
  refreshes: string[];
  adopted: string[];
  forgotten: number;
  keystore: string | null;
  memory: string | null;
  next: () => NativeBillingAnswer;
}

/** The app side: one refresh at a time; a page whose access token is already stale gets the fresh one without a request. */
function fakeApp(answer?: (n: number) => NativeBillingAnswer): FakeApp {
  let n = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let last: NativeBillingAnswer | null = null;
  const app: FakeApp = {
    refreshes: [],
    adopted: [],
    forgotten: 0,
    keystore: 'r1.cur',
    memory: null,
    next: () => {
      n++;
      return answer
        ? answer(n)
        : {
            ok: true,
            accessToken: 'a1.n' + n,
            accessExpiresAt: Date.now() + 24 * HOUR,
            refreshExpiresAt: 3e12,
            paidUntil: 2e12,
            volatile: false,
          };
    },
    refresh(deviceId, stale) {
      const run = chain.then(() => {
        if (last && last.accessToken !== stale && (last.accessExpiresAt || 0) > Date.now() + 60_000) return last;
        if (!app.memory && !app.keystore) return { ok: false, error: 'missing' };
        app.refreshes.push(stale);
        const out = app.next();
        if (out.ok) last = out;
        if (out.error === 'gone') app.keystore = null;
        return out;
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run as Promise<NativeBillingAnswer>;
    },
    adopt(token) {
      app.adopted.push(token);
      app.keystore = token;
      last = null;
      return Promise.resolve({ volatile: false });
    },
    status: () => Promise.resolve({ present: !!(app.memory || app.keystore), volatile: !!app.memory }),
    name: () => Promise.resolve('Xiaomi 2201117TY*'),
    forget() {
      app.forgotten++;
      app.keystore = null;
      app.memory = null;
      last = null;
      return Promise.resolve();
    },
  };
  return app;
}

/** A hidden page (background check or TV search server): refresh only, read-only secrets. */
function hidden(ctx: SourceContext, app: FakeApp, background: boolean): SourceContext {
  return { ...ctx, background, secrets: undefined, billing: { refresh: (d, s) => app.refresh(d, s) } };
}

function onPair(left: number, extra?: object) {
  saveBillingSession({
    token: '',
    paidUntil: 2e12,
    id: 'b'.repeat(32),
    access: 'a1.cur',
    accessExp: Date.now() + left,
    refreshExp: 3e12,
    ...extra,
  });
}

const bearer = (c: HttpCall) => (c.opts && c.opts.headers ? c.opts.headers.Authorization : undefined);
const paths = (calls: HttpCall[]) => calls.map((c) => c.url.replace(BILLING_ORIGIN, ''));
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe('device tokens through the Android app', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBillingTokens(() => Promise.resolve());
    allowBillingRefresh(false); // as on a hidden page: only ctx.billing allows renewing
  });
  afterEach(() => {
    resetBillingTokens();
    allowBillingRefresh(false);
    clearBilling();
    unregisterSource('omp-jackett');
    unregisterSource('omp-jacred');
  });

  it('the background check renews an expired access token itself (the app was not opened for days)', async () => {
    onPair(-HOUR);
    const app = fakeApp();
    const site = fakeSite((c) => page(ME, c.url));
    await fetchBillingAccount(hidden(site.ctx, app, true));
    expect(app.refreshes).toEqual(['a1.cur']);
    expect(paths(site.calls)).toEqual(['/v1/me']);
    expect(bearer(site.calls[0])).toBe('Bearer a1.n1');
    expect(billingSession()!.access).toBe('a1.n1');
    expect(JSON.stringify(localStorage)).not.toContain('r1.');
  });

  it('the TV search server renews on 401 token_expired and repeats the search once', async () => {
    onPair(20 * HOUR);
    const app = fakeApp();
    let n = 0;
    const site = fakeSite((c) => {
      n++;
      return n === 1 ? page(JSON.stringify({ error: 'token_expired' }), c.url, 401) : page(RSS, c.url);
    });
    await ompJackettSource().search('q', hidden(site.ctx, app, false));
    expect(site.calls.map(bearer)).toEqual(['Bearer a1.cur', 'Bearer a1.n1']);
    expect(app.refreshes).toHaveLength(1);
  });

  it('the app and a hidden page renewing at once: one refresh, both get the fresh token', async () => {
    onPair(-1);
    const app = fakeApp();
    const site = fakeSite((c) => page(RSS, c.url));
    const main: SourceContext = { ...site.ctx, billing: app };
    await Promise.all([
      ompJackettSource().search('a', main),
      ompJackettSource().search('b', hidden(site.ctx, app, false)),
      fetchBillingAccount(hidden(site.ctx, app, true)).then(undefined, () => null),
    ]);
    expect(app.refreshes).toHaveLength(1);
    expect(site.calls.filter((c) => c.url.indexOf('/v1/search') > 0).every((c) => bearer(c) === 'Bearer a1.n1')).toBe(true);
  });

  it('a network error on the way never disconnects', async () => {
    onPair(-1);
    const app = fakeApp(() => ({ ok: false, error: 'network' }));
    const site = fakeSite((c) => page(RSS, c.url));
    await expect(ompJackettSource().search('q', hidden(site.ctx, app, false))).rejects.toThrow('Сервер подписки не отвечает');
    expect(billingSession()!.access).toBe('a1.cur');
    expect(billingNotice()).toBe('');
    const rejecting: SourceContext = {
      ...site.ctx,
      background: true,
      billing: { refresh: () => Promise.reject(new Error('bridge')) },
    };
    resetBillingTokens();
    await expect(fetchBillingAccount(rejecting)).rejects.toThrow('Сервер подписки не отвечает');
    expect(billingSession()).not.toBeNull();
  });

  it('the server dropped the binding: «Устройство отключено», the app forgets the token', async () => {
    onPair(-1);
    const app = fakeApp(() => ({ ok: false, error: 'gone', code: 'revoked' }));
    const site = fakeSite((c) => page(RSS, c.url));
    await expect(ompJackettSource().search('q', { ...site.ctx, billing: app })).rejects.toThrow(
      'Устройство отключено — введите новый код',
    );
    expect(billingSession()).toBeNull();
    expect(billingNotice()).toBe('revoked');
    expect(app.forgotten).toBe(1);
  });

  it('missing after a restart that lost a memory-only token: the code is asked again, saying why', async () => {
    onPair(-1, { volatile: true });
    const app = fakeApp();
    app.keystore = null;
    const site = fakeSite((c) => page(RSS, c.url));
    await expect(ompJackettSource().search('q', hidden(site.ctx, app, false))).rejects.toThrow('Ключ подписки не сохранился');
    expect(billingNotice()).toBe('keystore');
  });

  it('a memory-only token is marked on the session and cleared once the Keystore takes it', async () => {
    onPair(-1);
    const app = fakeApp((n) => ({
      ok: true,
      accessToken: 'a1.n' + n,
      accessExpiresAt: Date.now() + (n === 1 ? -1 : 24 * HOUR),
      volatile: n === 1,
    }));
    const site = fakeSite((c) => page(RSS, c.url));
    const main: SourceContext = { ...site.ctx, billing: app };
    await ompJackettSource().search('q', main);
    expect(billingSession()!.volatile).toBe(true);
    resetBillingTokens();
    await ompJackettSource().search('q', main);
    expect(billingSession()!.volatile).toBeUndefined();
  });

  it('activation hands the refresh token to the app: never in localStorage or the page secrets', async () => {
    const app = fakeApp();
    const pair = {
      refreshToken: 'r1.code',
      accessToken: 'a1.code',
      accessExpiresAt: Date.now() + 24 * HOUR,
      refreshExpiresAt: 3e12,
      paidUntil: 2e12,
    };
    const site = fakeSite((c) => page(JSON.stringify(pair), c.url), {});
    await activateCode({ ...site.ctx, billing: app }, 'ABCD-EFGH');
    expect(app.adopted).toEqual(['r1.code']);
    // the phone's model goes with the activation, cleaned, for the bot's and the panel's device list
    expect(site.calls[0].form).toMatchObject({ code: 'ABCD-EFGH', tokens: 'pair', name: 'Xiaomi 2201117TY' });
    expect(site.secrets).toEqual({});
    expect(JSON.stringify(localStorage)).not.toContain('r1.code');
    expect(billingSession()!.access).toBe('a1.code');
  });

  it('no model from the app (or an error) sends no name; activation still works', async () => {
    const app = fakeApp();
    app.name = () => Promise.reject(new Error('no plugin'));
    const pair = { refreshToken: 'r1.code', accessToken: 'a1.code', accessExpiresAt: Date.now() + 24 * HOUR };
    const site = fakeSite((c) => page(JSON.stringify(pair), c.url), {});
    await activateCode({ ...site.ctx, billing: app }, 'ABCD-EFGH');
    expect(site.calls[0].form).not.toHaveProperty('name');
    const plain = fakeSite((c) => page(JSON.stringify(pair), c.url), {});
    resetBillingTokens();
    clearBilling();
    await activateCode(plain.ctx, 'ABCD-EFGH');
    expect(plain.calls[0].form).not.toHaveProperty('name');
  });

  it('activation fails cleanly when the app cannot take the token', async () => {
    const app = fakeApp();
    app.adopt = () => Promise.reject(new Error('keystore'));
    const pair = { refreshToken: 'r1.code', accessToken: 'a1.code', accessExpiresAt: Date.now() + 24 * HOUR };
    const site = fakeSite((c) => page(JSON.stringify(pair), c.url), {});
    await expect(activateCode({ ...site.ctx, billing: app }, 'ABCD-EFGH')).rejects.toThrow('Сервер подписки не отвечает');
    expect(billingSession()).toBeNull();
  });

  it('a legacy session: hidden pages keep the old token, the app moves it once through adopt', async () => {
    saveBillingSession({ token: 'legacy-1', paidUntil: 2e12 });
    const app = fakeApp();
    const site = fakeSite((c) =>
      page(
        c.url.indexOf('/v1/token/upgrade') > 0
          ? JSON.stringify({ refreshToken: 'r1.up', accessToken: 'a1.up', accessExpiresAt: Date.now() + 24 * HOUR })
          : ME,
        c.url,
      ),
    );
    await fetchBillingAccount(hidden(site.ctx, app, true));
    expect(paths(site.calls)).toEqual(['/v1/me']);
    expect(bearer(site.calls[0])).toBe('Bearer legacy-1');
    await fetchBillingAccount({ ...site.ctx, billing: app });
    expect(paths(site.calls).slice(1)).toEqual(['/v1/token/upgrade', '/v1/me']);
    expect(app.adopted).toEqual(['r1.up']);
    expect(site.calls[1].form).toMatchObject({ name: 'Xiaomi 2201117TY' });
    expect(bearer(site.calls[2])).toBe('Bearer a1.up');
  });

  it('«Отключить» makes the app forget the token', () => {
    onPair(HOUR);
    const app = fakeApp();
    clearBilling({ ...fakeSite(() => page('', '')).ctx, billing: app });
    expect(app.forgotten).toBe(1);
    expect(billingSession()).toBeNull();
  });

  it('keep-alive: a memory-only session after a restart is dropped; one the app still holds is kept', async () => {
    const site = fakeSite((c) => page(RSS, c.url));
    onPair(20 * HOUR, { volatile: true });
    const kept = fakeApp();
    kept.keystore = null;
    kept.memory = 'r1.mem';
    let stop = startBillingKeepAlive(() => ({ ...site.ctx, billing: kept }));
    await tick();
    stop();
    expect(billingSession()).not.toBeNull();

    const lost = fakeApp();
    lost.keystore = null;
    stop = startBillingKeepAlive(() => ({ ...site.ctx, billing: lost }));
    await tick();
    stop();
    expect(billingSession()).toBeNull();
    expect(billingNotice()).toBe('keystore');
  });

  it('extra_expired: «Доп. устройство не продлено» on activation and on search', async () => {
    const act = fakeSite((c) => page(JSON.stringify({ error: 'extra_expired' }), c.url, 409), {});
    await expect(activateCode(act.ctx, 'ABCD-EFGH')).rejects.toThrow('Доп. устройство не продлено — продлите его в боте');
    onPair(20 * HOUR);
    const search = fakeSite((c) => page(JSON.stringify({ error: 'extra_expired' }), c.url, 403));
    await expect(ompJackettSource().search('q', search.ctx)).rejects.toThrow('Доп. устройство не продлено — продлите его в боте');
    expect(billingSession()).not.toBeNull();
  });
});
