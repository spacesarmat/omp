import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN } from '../../src/billing/config';
import { billingSession, deviceId, saveBillingSession, seenAccount } from '../../src/billing/session';
import { failureOf } from '../../src/monitor/upgradeText';
import { isLoginRequired } from '../../src/sources/types';
import type { SourceResult } from '../../src/sources/types';
import {
  activateCode,
  clearBilling,
  fetchBillingAccount,
  OMP_JACRED_ID,
  OMP_JACKETT_ID,
  ompJackettSource,
  ompJacredSource,
  refreshOmpJackettSources,
  startOmpJackett,
  syncOmpJackett,
} from '../../src/sources/ompJackett';
import { getSource, unregisterSource } from '../../src/sources/registry';
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
    expect(getSource(OMP_JACKETT_ID)?.kind).toBe('billing');
    expect(getSource(OMP_JACRED_ID)?.name).toBe('JacRed');
  });

  it('refuses a code bound to another device', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'other_device' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Этот код уже привязан к другому устройству');
  });

  it('says the device slots are full on device_limit', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'device_limit' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Все устройства подписки заняты');
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
    expect(site.calls[0].form).toEqual({ source: 'jackett', q: 'q', deviceId: deviceId() });
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
