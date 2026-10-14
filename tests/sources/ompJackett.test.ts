import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BILLING_ORIGIN } from '../../src/billing/config';
import { billingSession, deviceId, saveBillingSession } from '../../src/billing/session';
import { activateCode, clearBilling, OMP_JACKETT_ID, ompJackettSource, startOmpJackett, syncOmpJackett } from '../../src/sources/ompJackett';
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
  });
  afterEach(() => {
    clearBilling();
    unregisterSource(OMP_JACKETT_ID);
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
  });

  it('refuses a code bound to another device', async () => {
    const site = fakeSite((c) => page(JSON.stringify({ error: 'other_device' }), c.url, 409));
    await expect(activateCode(site.ctx, 'ABCD-EFGH')).rejects.toThrow('Этот код уже привязан к другому устройству');
  });

  it('searches through the billing proxy with the session token', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett();
    const site = fakeSite((c) => page(RSS, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Title).toBe('Film');
    expect(list[0].Hash).toBe(H);
    expect(site.calls[0].url).toBe(BILLING_ORIGIN + '/v1/search');
    expect(site.calls[0].opts?.headers?.Authorization).toBe('Bearer tok-1');
    expect(site.calls[0].opts?.headers?.['X-Device-Id']).toBe(deviceId());
  });

  it('keeps an omp-fetch download link when there is no magnet', async () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    const only =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' +
      '<item><title>File</title><link>omp-fetch:/dl/file</link>' +
      '<enclosure url="omp-fetch:/dl/file" type="application/x-bittorrent"/></item></channel></rss>';
    const site = fakeSite((c) => page(only, c.url));
    const list = await ompJackettSource().search('q', site.ctx);
    expect(list).toHaveLength(1);
    expect(list[0].Link).toBe('omp-fetch:/dl/file');
  });

  it('forget clears the source', () => {
    saveBillingSession({ token: 'tok-1', paidUntil: 2e12 });
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)).toBeTruthy();
    clearBilling();
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
  });
});
