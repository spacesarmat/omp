import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN, BILLING_ORIGIN_LAN, rememberBillingOrigin } from '../../src/billing/config';
import { billingSession, deviceId, saveBillingSession } from '../../src/billing/session';
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
    rememberBillingOrigin(BILLING_ORIGIN);
    unregisterSource(OMP_JACKETT_ID);
    unregisterSource(OMP_JACRED_ID);
  });
  afterEach(() => {
    clearBilling();
    unregisterSource(OMP_JACKETT_ID);
    unregisterSource(OMP_JACRED_ID);
  });

  it('binds a code to this device and registers the source', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ token: 'tok-1', paidUntil: 2e12 }), c.url));
    const row = await activateCode(site.ctx, 'ABCD-EFGH');
    expect(row.token).toBe('tok-1');
    expect(billingSession()?.token).toBe('tok-1');
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/activate');
    expect(site.calls[0].form).toEqual({ code: 'ABCD-EFGH', deviceId: deviceId() });
    startOmpJackett();
    expect(getSource(OMP_JACKETT_ID)?.kind).toBe('billing');
    expect(getSource(OMP_JACRED_ID)?.name).toBe('JacRed');
  });

  it('refuses a code bound to another device', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'other_device' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Этот код уже привязан к другому устройству');
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

  it('falls back to LAN when the public host is unreachable', async () => {
    localStorage.clear();
    const site = fakeSite((c) => {
      if (c.url.indexOf(BILLING_ORIGIN_LAN) === 0) {
        return page(JSON.stringify({ token: 'tok-lan', paidUntil: 2e12 }), c.url);
      }
      return Promise.reject(new Error('dns down'));
    });
    const row = await activateCode(site.ctx, 'ABCD-EFGH');
    expect(row.token).toBe('tok-lan');
    expect(site.calls.some((c) => c.url === BILLING_ORIGIN_LAN + '/v1/activate')).toBe(true);
  });
});
