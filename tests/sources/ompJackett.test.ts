import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN } from '../../src/billing/config';
import { ACCESS_KEY, MONITOR_FREE_MAX, monitorMax, ompSubscribed, saveBillingAccess } from '../../src/billing/entitlement';
import { allowBillingRefresh, REFRESH_SECRET, resetBillingTokens } from '../../src/billing/tokens';
import { billingSession, deviceId, onBillingChange, saveBillingSession, saveSeenAccount, seenAccount, sessionKey } from '../../src/billing/session';
import { failureOf } from '../../src/monitor/upgradeText';
import { isLoginRequired } from '../../src/sources/types';
import type { SourceResult } from '../../src/sources/types';
import {
  activateCode,
  allowBillingSignIn,
  billingSignedOut,
  claimLinkedSession,
  clearBilling,
  ensureOmpJackettSources,
  fetchBillingAccount,
  OMP_JACRED_ID,
  OMP_JACKETT_ID,
  ompJackettSource,
  ompJacredSource,
  refreshOmpJackettSources,
  signOutBilling,
  startOmpJackett,
  syncOmpJackett,
} from '../../src/sources/ompJackett';
import { dhtSeedCheckAvailable, setDhtPeersContext } from '../../src/sources/dhtPeers';
import { progressText, sourceName } from '../../src/sources/view';
import { getSource, registerSource, unregisterSource } from '../../src/sources/registry';
import type { HttpResponse } from '../../src/sources/types';
import { fakeSite, page } from './fakeSite';

const H = '0123456789abcdef0123456789abcdef01234567';
const RSS =
  '<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>x</title>' +
  '<item><title>Film</title><link>omp-fetch:/dl/a</link><torznab:attr name="infohash" value="' +
  H +
  '"/><torznab:attr name="seeders" value="2"/></item></channel></rss>';

describe('omp Jackett source', () => {
  beforeEach(() => {
    localStorage.clear();
    unregisterSource(OMP_JACKETT_ID);
    unregisterSource(OMP_JACRED_ID);
  });
  afterEach(() => {
    allowBillingSignIn();
    setDhtPeersContext(null);
    clearBilling();
    unregisterSource(OMP_JACKETT_ID);
    unregisterSource(OMP_JACRED_ID);
  });

  it('binds a code to this device and registers the source', async () => {
    const pair = { refreshToken: 'r1.one', accessToken: 'a1.one', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const site = fakeSite((c) => page(JSON.stringify(pair), c.url));
    const row = await activateCode(site.ctx, 'ABCD-EFGH');
    expect(row.access).toBe('a1.one');
    expect(billingSession()?.access).toBe('a1.one');
    expect(billingSession()?.paidUntil).toBe(2e12);
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/activate');
    expect(site.calls[0].form).toEqual({ code: 'ABCD-EFGH', deviceId: deviceId(), tokens: 'pair' });
    startOmpJackett();
    // The follow-up /v1/me in this fake is the token pair, which is not an active account.
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('a confirmed code turns paid sources on without an app restart', async () => {
    const pair = { refreshToken: 'r1.one', accessToken: 'a1.one', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const me = { telegramId: '9', paidUntil: 2e12, active: true, accessUntil: 2e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => page(JSON.stringify(c.url.indexOf('/v1/activate') > 0 ? pair : me), c.url));
    await activateCode(site.ctx, 'ABCD-EFGH');
    expect(getSource(OMP_JACKETT_ID)?.name).toBe('OMP Jackett');
    expect(getSource(OMP_JACRED_ID)?.name).toBe('OMP JacRed');
    expect(ompSubscribed()).toBe(true);
    expect(monitorMax()).toBe(0);
  });

  it('names the paid sources OMP Jackett and OMP JacRed in the did-not-answer line', () => {
    registerSource(ompJackettSource());
    registerSource(ompJacredSource());
    expect(sourceName(OMP_JACKETT_ID)).toBe('OMP Jackett');
    expect(sourceName(OMP_JACRED_ID)).toBe('OMP JacRed');
    const line = progressText({ found: 0, answered: 0, total: 2, pending: [], failed: [sourceName(OMP_JACKETT_ID), sourceName(OMP_JACRED_ID)] });
    expect(line).toContain('не ответили: OMP Jackett, OMP JacRed');
  });

  it('claims a session for a linked Telegram account and does not send a telegram id', async () => {
    const pair = { refreshToken: 'r1.tg', accessToken: 'a1.tg', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const me = { telegramId: '9', paidUntil: 2e12, active: true, accessUntil: 2e12, sources: { jackett: true, jacred: false }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(pair), c.url);
      return page(JSON.stringify(me), c.url);
    });
    const row = await claimLinkedSession(site.ctx);
    expect(row && row.access).toBe('a1.tg');
    const claim = site.calls.filter((c) => c.url.indexOf('/v1/link/claim') > 0)[0];
    expect(claim.form).toEqual({ deviceId: deviceId(), tokens: 'pair' });
    expect(JSON.stringify(claim.form)).not.toContain('telegram');
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
    expect(ompSubscribed()).toBe(true);
  });

  it('sign-out clears the session, paid sources, DHT and the monitoring cap', async () => {
    const pair = { refreshToken: 'r1.tg', accessToken: 'a1.tg', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const me = { telegramId: '9', paidUntil: 2e12, active: true, accessUntil: 2e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => (c.url.indexOf('/v1/link/claim') > 0 ? page(JSON.stringify(pair), c.url) : page(JSON.stringify(me), c.url)));
    setDhtPeersContext(() => site.ctx);
    await claimLinkedSession(site.ctx);
    expect(dhtSeedCheckAvailable()).toBe(true);
    expect(monitorMax()).toBe(0);
    signOutBilling(site.ctx);
    expect(billingSession()).toBeNull();
    expect(ompSubscribed()).toBe(false);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
    expect(monitorMax()).toBe(MONITOR_FREE_MAX);
    expect(dhtSeedCheckAvailable()).toBe(false);
    expect(seenAccount()).toBeNull();
    const again = await claimLinkedSession(site.ctx);
    expect(again).toBeNull();
    expect(billingSession()).toBeNull();
  });

  it('a claim that answers after sign-out does not restore the session', async () => {
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => {
      release = resolve;
    });
    const pair = { refreshToken: 'r1.late', accessToken: 'a1.late', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const site = fakeSite((c) => (c.url.indexOf('/v1/link/claim') > 0 ? gate : page('{}', c.url)));
    const pending = claimLinkedSession(site.ctx);
    signOutBilling(site.ctx);
    release(page(JSON.stringify(pair), 'http://billing/v1/link/claim'));
    expect(await pending).toBeNull();
    expect(billingSession()).toBeNull();
    expect(billingSignedOut()).toBe(true);
  });

  it('a keystore write that finishes after sign-out does not keep the token', async () => {
    let releaseSet: () => void = () => undefined;
    let waiting = false;
    let deletes = 0;
    const pair = { refreshToken: 'r1.late', accessToken: 'a1.late', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const me = { active: true, paidUntil: 2e12, accessUntil: 2e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => page(JSON.stringify(c.url.indexOf('/v1/link/claim') > 0 ? pair : me), c.url), {});
    const ctx = {
      ...site.ctx,
      secrets: {
        get: () => Promise.resolve(null),
        set: () => {
          waiting = true;
          return new Promise<void>((resolve) => {
            releaseSet = resolve;
          });
        },
        delete: () => {
          deletes++;
          return Promise.resolve();
        },
      },
    };
    const pending = claimLinkedSession(ctx);
    for (let i = 0; i < 30 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    signOutBilling(ctx);
    releaseSet();
    expect(await pending).toBeNull();
    expect(billingSession()).toBeNull();
    expect(billingSignedOut()).toBe(true);
    expect(deletes).toBeGreaterThan(0);
  });

  it('a claim that finishes confirming after a new code does not sign that code out', async () => {
    let releaseMe: (r: HttpResponse) => void = () => undefined;
    let meHeld = false;
    const claimPair = { refreshToken: 'r1.claim', accessToken: 'a1.claim', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.code', accessToken: 'a1.code', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(claimPair), c.url);
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      if (!meHeld) {
        meHeld = true;
        return new Promise<HttpResponse>((resolve) => {
          releaseMe = resolve;
        });
      }
      return page(JSON.stringify(me), c.url);
    });
    const pending = claimLinkedSession(site.ctx);
    for (let i = 0; i < 40 && (!meHeld || billingSession()?.access !== 'a1.claim'); i++) await Promise.resolve();
    expect(billingSession()?.access).toBe('a1.claim');
    signOutBilling(site.ctx);
    const signed = await activateCode(site.ctx, 'ABCD-EFGH');
    expect(signed.access).toBe('a1.code');
    releaseMe(page(JSON.stringify({ active: true, paidUntil: 2e12, accessUntil: 2e12, monitorMax: 0 }), 'http://billing/v1/me'));
    expect(await pending).toBeNull();
    expect(billingSession()?.access).toBe('a1.code');
    expect(billingSignedOut()).toBe(false);
  });

  it('a cancelled keystore write does not erase the session that replaced it', async () => {
    let releaseSet: () => void = () => undefined;
    let waiting = false;
    let deletes = 0;
    const claimPair = { refreshToken: 'r1.old', accessToken: 'a1.old', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.new', accessToken: 'a1.new', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(claimPair), c.url);
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      return page(JSON.stringify(me), c.url);
    }, {});
    let sets = 0;
    const stored: { [key: string]: string } = {};
    const ctx = {
      ...site.ctx,
      secrets: {
        get: (key: string) => Promise.resolve(stored[key] || null),
        set: (key: string, value: string) => {
          sets++;
          if (sets === 1) {
            waiting = true;
            return new Promise<void>((resolve) => {
              releaseSet = () => {
                stored[key] = value;
                resolve();
              };
            });
          }
          stored[key] = value;
          return Promise.resolve();
        },
        delete: (key: string) => {
          deletes++;
          delete stored[key];
          return Promise.resolve();
        },
      },
    };
    const pending = claimLinkedSession(ctx);
    for (let i = 0; i < 40 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    signOutBilling(ctx);
    const signing = activateCode(ctx, 'ABCD-EFGH');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    releaseSet();
    const signed = await signing;
    expect(signed.access).toBe('a1.new');
    expect(await pending).toBeNull();
    expect(billingSession()?.access).toBe('a1.new');
    expect(billingSession()?.id).toBe(signed.id);
    expect(stored[REFRESH_SECRET]).toBe('r1.new');
    expect(billingSignedOut()).toBe(false);
    expect(deletes).toBe(0);
  });

  it('a code entered while a claim waits for its reply is not replaced when the claim answers', async () => {
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => {
      release = resolve;
    });
    const claimPair = { refreshToken: 'r1.claim', accessToken: 'a1.claim', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.code', accessToken: 'a1.code', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return gate;
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      return page(JSON.stringify(me), c.url);
    });
    const pending = claimLinkedSession(site.ctx);
    const signed = await activateCode(site.ctx, 'ABCD-EFGH');
    expect(signed.access).toBe('a1.code');
    release(page(JSON.stringify(claimPair), 'http://billing/v1/link/claim'));
    expect(await pending).toBeNull();
    expect(billingSession()?.access).toBe('a1.code');
    expect(billingSession()?.id).toBe(signed.id);
    expect(billingSignedOut()).toBe(false);
  });

  it('a claim keystore write that finishes after a code does not replace that code', async () => {
    let releaseSet: () => void = () => undefined;
    let waiting = false;
    let deletes = 0;
    const claimPair = { refreshToken: 'r1.old', accessToken: 'a1.old', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.new', accessToken: 'a1.new', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(claimPair), c.url);
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      return page(JSON.stringify(me), c.url);
    }, {});
    let sets = 0;
    const stored: { [key: string]: string } = {};
    const ctx = {
      ...site.ctx,
      secrets: {
        get: (key: string) => Promise.resolve(stored[key] || null),
        set: (key: string, value: string) => {
          sets++;
          if (sets === 1) {
            waiting = true;
            return new Promise<void>((resolve) => {
              releaseSet = () => {
                stored[key] = value;
                resolve();
              };
            });
          }
          stored[key] = value;
          return Promise.resolve();
        },
        delete: (key: string) => {
          deletes++;
          delete stored[key];
          return Promise.resolve();
        },
      },
    };
    const pending = claimLinkedSession(ctx);
    for (let i = 0; i < 40 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    const signing = activateCode(ctx, 'ABCD-EFGH');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    releaseSet();
    const signed = await signing;
    expect(signed.access).toBe('a1.new');
    expect(await pending).toBeNull();
    expect(billingSession()?.access).toBe('a1.new');
    expect(billingSession()?.id).toBe(signed.id);
    expect(stored[REFRESH_SECRET]).toBe('r1.new');
    expect(deletes).toBe(0);
    expect(billingSignedOut()).toBe(false);
  });

  it('an in-flight claim set that applies the old token on completion still leaves the code token', async () => {
    let releaseSet: () => void = () => undefined;
    let waiting = false;
    const written: string[] = [];
    const claimPair = { refreshToken: 'r1.old', accessToken: 'a1.old', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.new', accessToken: 'a1.new', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(claimPair), c.url);
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      return page(JSON.stringify(me), c.url);
    }, {});
    const stored: { [key: string]: string } = {};
    const ctx = {
      ...site.ctx,
      secrets: {
        get: (key: string) => Promise.resolve(stored[key] || null),
        set: (key: string, value: string) => {
          if (!waiting) {
            waiting = true;
            return new Promise<void>((resolve) => {
              releaseSet = () => {
                written.push(value);
                stored[key] = value;
                resolve();
              };
            });
          }
          written.push(value);
          stored[key] = value;
          return Promise.resolve();
        },
        delete: (key: string) => {
          delete stored[key];
          written.push('deleted');
          return Promise.resolve();
        },
      },
    };
    const pending = claimLinkedSession(ctx);
    for (let i = 0; i < 40 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    const signing = activateCode(ctx, 'ABCD-EFGH');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    releaseSet();
    const signed = await signing;
    expect(await pending).toBeNull();
    expect(written[0]).toBe('r1.old');
    expect(written[written.length - 1]).toBe('r1.new');
    expect(stored[REFRESH_SECRET]).toBe('r1.new');
    expect(billingSession()?.access).toBe('a1.new');
    expect(billingSession()?.id).toBe(signed.id);
    expect(billingSignedOut()).toBe(false);
  });

  it('an in-flight claim adopt that applies the old token on completion still leaves the code token', async () => {
    let release: () => void = () => undefined;
    let waiting = false;
    const written: string[] = [];
    let keystore = '';
    const claimPair = { refreshToken: 'r1.old', accessToken: 'a1.old', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 2e12 };
    const codePair = { refreshToken: 'r1.new', accessToken: 'a1.new', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: 3e12, paidUntil: 3e12 };
    const me = { active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: true }, monitorMax: 0 };
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/link/claim') > 0) return page(JSON.stringify(claimPair), c.url);
      if (c.url.indexOf('/v1/activate') > 0) return page(JSON.stringify(codePair), c.url);
      return page(JSON.stringify(me), c.url);
    }, null);
    const ctx = {
      ...site.ctx,
      billing: {
        refresh: () => Promise.resolve({ ok: false as const, error: 'missing' as const }),
        adopt: (token: string) => {
          if (!waiting) {
            waiting = true;
            return new Promise<{ volatile: boolean }>((resolve) => {
              release = () => {
                written.push(token);
                keystore = token;
                resolve({ volatile: false });
              };
            });
          }
          written.push(token);
          keystore = token;
          return Promise.resolve({ volatile: false });
        },
        forget: () => {
          keystore = '';
          written.push('forgotten');
          return Promise.resolve();
        },
      },
    };
    const pending = claimLinkedSession(ctx);
    for (let i = 0; i < 40 && !waiting; i++) await Promise.resolve();
    expect(waiting).toBe(true);
    const signing = activateCode(ctx, 'ABCD-EFGH');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    release();
    const signed = await signing;
    expect(await pending).toBeNull();
    expect(written[0]).toBe('r1.old');
    expect(written[written.length - 1]).toBe('r1.new');
    expect(keystore).toBe('r1.new');
    expect(billingSession()?.access).toBe('a1.new');
    expect(billingSession()?.id).toBe(signed.id);
    expect(billingSignedOut()).toBe(false);
  });

  it('refuses a code bound to another device', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'other_device' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Этот код уже привязан к другому устройству');
  });

  it('says the device slots are full on device_limit', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'device_limit' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Все устройства подписки заняты');
  });

  it('a Telegram link without a token remembers the account, a code entered meanwhile does not lose it', async () => {
    const linked = fakeSite((c) => page(JSON.stringify({ telegramId: '9', paidUntil: 2e12, active: true }), c.url));
    await fetchBillingAccount(linked.ctx);
    expect(billingSession()).toBeNull();
    expect(seenAccount()).toEqual({ paidUntil: 2e12 });

    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const late = fakeSite(() => gate);
    const pending = fetchBillingAccount(late.ctx);
    saveBillingSession({ token: 'new-code', paidUntil: 3e12 });
    saveSeenAccount({ paidUntil: 3e12 });
    release(page(JSON.stringify({ telegramId: '9', paidUntil: 1, active: false }), 'http://billing'));
    await pending;
    expect(billingSession()?.token).toBe('new-code');
    expect(seenAccount()).toEqual({ paidUntil: 3e12 });
  });

  it('caches the account for the Settings row, but not an answer that comes back after «Отключить»', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 1e12 });
    const ok = fakeSite((c) => page(JSON.stringify({ active: true, paidUntil: 2e12 }), c.url));
    await fetchBillingAccount(ok.ctx);
    expect(seenAccount()).toEqual({ paidUntil: 2e12 });
    const late = fakeSite((c) => {
      clearBilling();
      return page(JSON.stringify({ active: true, paidUntil: 2e12 }), c.url);
    });
    await fetchBillingAccount(late.ctx);
    expect(billingSession()).toBeNull();
    expect(seenAccount()).toBeNull();
  });

  it('keeps paid sources in the grace period and reads the grace end', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 1e12 });
    const site = fakeSite((c) =>
      page(JSON.stringify({ active: true, inGrace: true, paidUntil: 1e12, accessUntil: 1e12 + 3 * 864e5, sources: { jackett: true, jacred: true } }), c.url),
    );
    const acc = await fetchBillingAccount(site.ctx);
    expect(acc).toMatchObject({ active: true, inGrace: true, accessUntil: 1e12 + 3 * 864e5, overLimit: false });
    await refreshOmpJackettSources(site.ctx);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(billingSession()?.token).toBe('tok-1');
  });

  it('an over-limit phone keeps its session but turns paid sources off', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const site = fakeSite((c) =>
      page(JSON.stringify({ active: false, overLimit: true, paidUntil: 2e12, sources: { jackett: false, jacred: false } }), c.url),
    );
    await refreshOmpJackettSources(site.ctx);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(billingSession()?.token).toBe('tok-1');
    const search = fakeSite((c) => page(JSON.stringify({ error: 'device_limit' }), c.url, 403));
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    await expect(ompJackettSource().search('q', search.ctx)).rejects.toThrow('Доп. устройство не продлено');
  });

  it('searches through the billing proxy when the subscription is active', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett();
    const site = fakeSite((c) => page(RSS, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Title).toBe('Film');
    expect(list[0].Hash).toBe(H);
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/search');
    expect(site.calls[0].form).toEqual({ source: 'jackett', q: 'q', deviceId: deviceId(), deviceClass: 'tv' });
    expect(site.calls[0].opts?.headers?.Authorization).toBe('Bearer tok-1');
  });

  it('audiobook mode posts cat=3030 and an open search', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const book = (title: string, hash: string, cat: string) =>
      '<item><title>' + title + '</title><category>' + cat + '</category>' +
      '<link>omp-fetch:/dl/' + hash.slice(0, 6) + '</link>' +
      '<torznab:attr name="infohash" value="' + hash + '"/></item>';
    const site = fakeSite((c) => {
      const cat = c.form && c.form.cat;
      const items = cat === '3030'
        ? book('RuTracker', H, '3030') + book('Film', 'b'.repeat(40), '2000')
        : book('RuTracker', H, '3030') + book('Кинг - Оно MP3 128 kbps', 'c'.repeat(40), '8000');
      const rss =
        '<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>x</title>' +
        items +
        '</channel></rss>';
      return page(rss, c.url);
    });
    const list = await ompJackettSource().search('оно', { ...site.ctx, searchMode: 'audiobook' });
    expect(site.calls).toHaveLength(2);
    const cats = site.calls.map((c) => (c.form ? c.form.cat : undefined));
    expect(cats).toContain('3030');
    expect(cats).toContain(undefined);
    expect(list.map((r) => r.Title)).toEqual(['RuTracker', 'Кинг - Оно MP3 128 kbps']);
  });

  it('searches JacRed through the billing proxy', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const only =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' +
      '<item><title>File</title><link>omp-jacred:/dl/file</link></item></channel></rss>';
    const site = fakeSite((c) => page(only, c.url));
    const list = await ompJacredSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Link).toBe('omp-jacred:/dl/file');
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/search');
    expect(site.calls[0].form?.source).toBe('jacred');
  });

  it('keeps a proxy download link when there is no magnet', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const only =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' +
      '<item><title>File</title><link>omp-fetch:/dl/file</link></item></channel></rss>';
    const site = fakeSite((c) => page(only, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Link).toBe('omp-fetch:/dl/file');
  });

  it('downloads a torrent file through the billing proxy', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const torrent = 'd4:infod4:name4:testee';
    const site = fakeSite((c) => page(torrent, c.url));
    const src = ompJackettSource();
    expect(src.resolve).toBeTypeOf('function');
    const path = await src.resolve!(
      {
        Title: 'File',
        Link: 'omp-fetch:/dl/file',
        Categories: '',
        Size: '',
        CreateDate: '',
        Tracker: '',
        Magnet: '',
        Hash: '',
        Peer: 0,
        Seed: 0,
        source: OMP_JACKETT_ID,
      },
      site.ctx,
    );
    expect(path).toBeTruthy();
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/torrent');
    expect(site.calls[0].form?.link).toBe('omp-fetch:/dl/file');
  });

  it('a 502 upstream is the tracker not returning the file, not an expired subscription', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const row: SourceResult = {
      Title: 'File',
      Link: 'omp-fetch:/dl/megapeer/?path=ENC&file=Name',
      Categories: '',
      Size: '',
      CreateDate: '',
      Tracker: '',
      Magnet: '',
      Hash: '',
      Peer: 0,
      Seed: 0,
      source: OMP_JACKETT_ID,
    };
    const site = fakeSite((c) => page(JSON.stringify({ error: 'upstream' }), c.url, 502));
    let err: Error | null = null;
    try {
      await ompJackettSource().resolve!(row, site.ctx);
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }
    expect(err).toBeTruthy();
    expect(err!.message).toContain('не отдал файл раздачи');
    expect(err!.message).not.toContain('Подписка закончилась');
    expect(isLoginRequired(err)).toBe(false);
    const shown = failureOf({ ok: false, error: err!.message, cause: 'link' }, row);
    expect(shown.text).toContain('не отдал файл раздачи');
    expect(shown.source).toBeUndefined();
    expect(billingSession()?.token).toBe('tok-1');

    const down = fakeSite((c) => page(JSON.stringify({ error: 'down' }), c.url, 502));
    await expect(ompJackettSource().resolve!(row, down.ctx)).rejects.toThrow('Сервер подписки не отвечает');
    const expired = fakeSite((c) => page(JSON.stringify({ error: 'expired' }), c.url, 403));
    await expect(ompJackettSource().resolve!(row, expired.ctx)).rejects.toThrow('Подписка закончилась');
    expect(billingSession()?.token).toBe('tok-1');
  });

  it('accepts a magnet when the proxy followed a Jackett redirect', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const magnet = 'magnet:?xt=urn:btih:' + 'ab'.repeat(20);
    const site = fakeSite((c) => page(JSON.stringify({ magnet }), c.url));
    const src = ompJackettSource();
    const got = await src.resolve!(
      {
        Title: 'File',
        Link: 'omp-fetch:/dl/file',
        Categories: '',
        Size: '',
        CreateDate: '',
        Tracker: '',
        Magnet: '',
        Hash: '',
        Peer: 0,
        Seed: 0,
        source: OMP_JACKETT_ID,
      },
      site.ctx,
    );
    expect(got).toBe(magnet);
  });

  it('forget clears the source', () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    syncOmpJackett({ jackett: true, jacred: true });
    expect(getSource(OMP_JACKETT_ID)).toBeTruthy();
    clearBilling();
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('syncs paidUntil and sources from /v1/me after admin grant', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 1e12 });
    const site = fakeSite((c) =>
      page(
        JSON.stringify({
          telegramId: '1',
          paidUntil: 2e12,
          active: true,
          deviceLimit: 1,
          sources: { jackett: true, jacred: false },
        }),
        c.url,
      ),
    );
    const acc = await fetchBillingAccount(site.ctx);
    expect(acc?.paidUntil).toBe(2e12);
    expect(acc?.sources?.jacred).toBe(false);
    expect(billingSession()?.paidUntil).toBe(2e12);
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/me');
  });

  it('keeps paid sources when the account refresh fails', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: false });
    const offline = fakeSite(() => Promise.reject(new Error('offline')));
    await refreshOmpJackettSources(offline.ctx);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
    const down = fakeSite((c) => page('no', c.url, 502));
    await refreshOmpJackettSources(down.ctx);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    await expect(fetchBillingAccount(offline.ctx)).rejects.toThrow('Сервер подписки не отвечает');
  });

  it('a denied search clears the cached subscription and the paid sources', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const expired = fakeSite((c) => page(JSON.stringify({ error: 'expired' }), c.url, 403));
    await expect(ompJackettSource().search('q', expired.ctx)).rejects.toThrow('Подписка закончилась');
    expect(ompSubscribed(1e12)).toBe(false);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();

    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const limit = fakeSite((c) => page(JSON.stringify({ error: 'device_limit' }), c.url, 403));
    await expect(ompJacredSource().search('q', limit.ctx)).rejects.toThrow('Доп. устройство не продлено');
    expect(ompSubscribed(1e12)).toBe(false);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('an indexer that is switched off does not clear the subscription', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: false });
    const site = fakeSite((c) => page(JSON.stringify({ error: 'disabled' }), c.url, 403));
    await expect(ompJackettSource().search('q', site.ctx)).rejects.toThrow('Этот источник временно выключен');
    expect(ompSubscribed(1e12)).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
  });

  it('a denial that started on the old code does not clear the new subscription', async () => {
    saveBillingSession({ token: 'old', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const site = fakeSite(() => gate);
    const pending = ompJackettSource().search('q', site.ctx);
    saveBillingSession({ token: 'new-code', paidUntil: 3e12 });
    saveBillingAccess({ active: true, accessUntil: 3e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    release(page(JSON.stringify({ error: 'expired' }), 'http://billing', 403));
    await expect(pending).rejects.toThrow('Подписка закончилась');
    expect(billingSession()?.token).toBe('new-code');
    expect(ompSubscribed(1e12)).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)?.id).toBe(OMP_JACRED_ID);
  });

  it('a download refusal that started on the old code does not clear the new subscription', async () => {
    saveBillingSession({ token: 'old', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const row: SourceResult = {
      Title: 'File',
      Link: 'omp-fetch:/dl/file',
      Categories: '',
      Size: '',
      CreateDate: '',
      Tracker: '',
      Magnet: '',
      Hash: '',
      Peer: 0,
      Seed: 0,
      source: OMP_JACKETT_ID,
    };
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const site = fakeSite(() => gate);
    const pending = ompJackettSource().resolve!(row, site.ctx);
    saveBillingSession({ token: 'new-code', paidUntil: 3e12 });
    saveBillingAccess({ active: true, accessUntil: 3e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    release(page(JSON.stringify({ error: 'device_limit' }), 'http://billing', 403));
    await expect(pending).rejects.toThrow('Доп. устройство не продлено');
    expect(billingSession()?.token).toBe('new-code');
    expect(ompSubscribed(1e12)).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
  });

  it('an unchanged /v1/me does not emit, so the account screen does not ask again', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12, jackett: true, jacred: false, monitorMax: 0 });
    const body = { active: true, paidUntil: 2e12, accessUntil: 2e12, monitorMax: 0, sources: { jackett: true, jacred: false } };
    const site = fakeSite((c) => page(JSON.stringify(body), c.url));
    let emits = 0;
    const off = onBillingChange(() => {
      emits++;
      void fetchBillingAccount(site.ctx);
    });
    await fetchBillingAccount(site.ctx);
    await new Promise((r) => setTimeout(r, 30));
    off();
    expect(emits).toBe(0);
    expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(1);
  });

  it('a changed /v1/me emits once; the account screen refresh does not loop', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12, jackett: true, jacred: true, monitorMax: 0 });
    syncOmpJackett({ jackett: true, jacred: true });
    const body = { active: false, paidUntil: 2e12, accessUntil: 0, monitorMax: 10, sources: { jackett: false, jacred: false } };
    const site = fakeSite((c) => page(JSON.stringify(body), c.url));
    const off = onBillingChange(() => {
      void fetchBillingAccount(site.ctx);
    });
    await fetchBillingAccount(site.ctx);
    await new Promise((r) => setTimeout(r, 40));
    off();
    expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(2);
    expect(ompSubscribed()).toBe(false);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
  });

  it('TV search answers at once while /v1/me is slow, then the next call sees the new answer', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12, jackett: true, jacred: false, monitorMax: 0, checkedAt: 1 });
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const site = fakeSite(() => gate);
    const started = Date.now();
    await ensureOmpJackettSources(site.ctx);
    expect(Date.now() - started).toBeLessThan(500);
    expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(1);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
    release(page(JSON.stringify({ active: true, paidUntil: 2e12, accessUntil: 2e12, monitorMax: 0, sources: { jackett: true, jacred: true } }), 'http://billing'));
    for (let i = 0; i < 40 && !getSource(OMP_JACRED_ID); i++) await Promise.resolve();
    expect(getSource(OMP_JACRED_ID)?.id).toBe(OMP_JACRED_ID);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const again = fakeSite((c) => page('{}', c.url));
    await ensureOmpJackettSources(again.ctx);
    expect(again.calls).toEqual([]);
  });

  it('TV search with no saved source flags stays on the free set until the background /v1/me answers', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const key = sessionKey(billingSession()!);
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ token: key, active: true, accessUntil: 2e12 }));
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const site = fakeSite(() => gate);
    await ensureOmpJackettSources(site.ctx);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(1);
    release(page(JSON.stringify({ active: true, paidUntil: 2e12, accessUntil: 2e12, monitorMax: 0, sources: { jackett: true, jacred: false } }), 'http://billing'));
    for (let i = 0; i < 40 && !getSource(OMP_JACKETT_ID); i++) await Promise.resolve();
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('a fresh /v1/me puts paid search back after a denial', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const denied = fakeSite((c) => page(JSON.stringify({ error: 'expired' }), c.url, 403));
    await expect(ompJackettSource().search('q', denied.ctx)).rejects.toThrow('Подписка закончилась');
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    const renewed = fakeSite((c) =>
      page(JSON.stringify({ active: true, paidUntil: 3e12, accessUntil: 3e12, sources: { jackett: true, jacred: false } }), c.url),
    );
    await fetchBillingAccount(renewed.ctx);
    expect(ompSubscribed(1e12)).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('a late /v1/me for the old code does not turn the new subscription off', async () => {
    saveBillingSession({ token: 'old', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    let release: (r: HttpResponse) => void = () => undefined;
    const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
    const site = fakeSite(() => gate);
    const pending = fetchBillingAccount(site.ctx);
    saveBillingSession({ token: 'new-code', paidUntil: 3e12 });
    saveBillingAccess({ active: true, accessUntil: 3e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    release(page(JSON.stringify({ active: false, paidUntil: 0, sources: { jackett: false, jacred: false } }), 'http://billing'));
    await pending;
    expect(billingSession()?.token).toBe('new-code');
    expect(ompSubscribed(1e12)).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
  });

  it('a legacy upgrade still applies a denial for that same login', async () => {
    allowBillingRefresh(true);
    resetBillingTokens();
    saveBillingSession({ token: 'legacy-tok', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const site = fakeSite((c) => {
      if (c.url.indexOf('/v1/token/upgrade') >= 0) {
        return page(
          JSON.stringify({
            refreshToken: 'r1.up',
            accessToken: 'a1.up',
            accessExpiresAt: Date.now() + 864e5,
            refreshExpiresAt: Date.now() + 864e5 * 180,
            paidUntil: 2e12,
          }),
          c.url,
        );
      }
      return page(JSON.stringify({ error: 'expired' }), c.url, 403);
    }, {});
    try {
      await expect(ompJackettSource().search('q', site.ctx)).rejects.toThrow('Подписка закончилась');
      expect(billingSession()?.access).toBe('a1.up');
      expect(billingSession()?.token).toBe('');
      expect(ompSubscribed(1e12)).toBe(false);
      expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
      expect(getSource(OMP_JACRED_ID)).toBeUndefined();
    } finally {
      allowBillingRefresh(false);
      resetBillingTokens();
    }
  });

  it('logout drops the cached subscription flag', () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12 });
    expect(ompSubscribed(1e12)).toBe(true);
    clearBilling();
    expect(ompSubscribed(1e12)).toBe(false);
    expect(billingSession()).toBeNull();
  });

  it('a /v1/me that returns after a new code does not clear that code', async () => {
    saveBillingSession({ token: 'old', paidUntil: 1 });
    const site = fakeSite((c) => {
      saveBillingSession({ token: 'new', paidUntil: 5e12 });
      saveBillingAccess({ active: true, accessUntil: 5e12, monitorMax: 0, jackett: true, jacred: true });
      return page(JSON.stringify({ active: false, paidUntil: 1, accessUntil: 0, monitorMax: 10, sources: { jackett: false, jacred: false } }), c.url);
    });
    await refreshOmpJackettSources(site.ctx);
    expect(billingSession()?.token).toBe('new');
    expect(ompSubscribed()).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)?.id).toBe(OMP_JACRED_ID);
  });

  it('a fresh /v1/me turns paid sources back on after a denial', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    saveBillingAccess({ active: true, accessUntil: 2e12, jackett: true, jacred: true });
    syncOmpJackett({ jackett: true, jacred: true });
    const denied = fakeSite((c) => page(JSON.stringify({ error: 'expired' }), c.url, 403));
    await expect(ompJackettSource().search('q', denied.ctx)).rejects.toThrow('Подписка закончилась');
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    const site = fakeSite((c) =>
      page(JSON.stringify({ active: true, paidUntil: 2e12, accessUntil: 2e12, monitorMax: 0, sources: { jackett: true, jacred: true } }), c.url),
    );
    await refreshOmpJackettSources(site.ctx);
    expect(ompSubscribed()).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)?.id).toBe(OMP_JACRED_ID);
  });

  it('turns paid sources off only after the account says so', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett({ jackett: true, jacred: true });
    const site = fakeSite((c) => page(JSON.stringify({ active: false, paidUntil: 0, telegramId: '' }), c.url));
    await refreshOmpJackettSources(site.ctx);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('talks to the public domain only (the LAN fallback is gone)', async () => {
    localStorage.clear();
    const site = fakeSite(() => Promise.reject(new Error('dns down')));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Сервер подписки не отвечает');
    expect(site.calls.map((c) => c.url)).toEqual([BILLING_ORIGIN + '/v1/activate']);
  });
});
