import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN, BILLING_ORIGIN_LAN, rememberBillingOrigin } from '../../src/billing/config';
import { OMP_JACRED, OMP_JACKETT, indexerAuthHeader } from '../../src/billing/indexers';
import { billingSession, deviceId, saveBillingSession } from '../../src/billing/session';
import {
  activateCode,
  clearBilling,
  fetchBillingAccount,
  OMP_JACRED_ID,
  OMP_JACKETT_ID,
  ompJackettSource,
  ompJacredSource,
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

  it('searches Jackett with the built-in key when the subscription is active', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett();
    const site = fakeSite((c) => page(RSS, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Title).toBe('Film');
    expect(list[0].Hash).toBe(H);
    expect(site.calls[0].url).toBe(
      OMP_JACKETT.url + '/api/v2.0/indexers/all/results/torznab/api?apikey=' + OMP_JACKETT.apiKey + '&t=search&q=q',
    );
    expect(site.calls[0].opts?.headers?.Authorization).toBe(indexerAuthHeader());
  });

  it('searches JacRed with the built-in key', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const only =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' +
      '<item><title>File</title><link>' +
      OMP_JACRED.url +
      '/dl/file</link></item></channel></rss>';
    const site = fakeSite((c) => page(only, c.url));
    const list = await ompJacredSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Link).toBe(OMP_JACRED.url + '/dl/file');
    expect(site.calls[0].url.indexOf(OMP_JACRED.url) === 0).toBe(true);
    expect(site.calls[0].url).toContain('apikey=' + OMP_JACRED.apiKey);
  });

  it('keeps a Jackett download link when there is no magnet', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const only =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' +
      '<item><title>File</title><link>' +
      OMP_JACKETT.url +
      '/dl/file</link></item></channel></rss>';
    const site = fakeSite((c) => page(only, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Link).toBe(OMP_JACKETT.url + '/dl/file');
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

  it('syncs paidUntil from /v1/me after admin grant', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 1e12 });
    const site = fakeSite((c) =>
      page(JSON.stringify({ telegramId: '1', paidUntil: 2e12, active: true, deviceLimit: 1 }), c.url),
    );
    const acc = await fetchBillingAccount(site.ctx);
    expect(acc?.paidUntil).toBe(2e12);
    expect(billingSession()?.paidUntil).toBe(2e12);
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/me');
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
