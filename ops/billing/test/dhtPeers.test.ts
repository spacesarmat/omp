import { describe, expect, it } from 'vitest';
import { dhtConfig, dhtPeersLimitConfig, dhtPerMinute, DHT_WINDOW_MS, probeDhtSidecar, publicDhtBody, queryDhtPeers, validDhtPerMinute } from '../src/dhtPeers.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';

const HASH = 'ab'.repeat(20);
const TOKEN = 'cd'.repeat(16);

function upstream(status: number, body: unknown, retryAfter?: string) {
  return async (url: string, init: { headers?: { authorization?: string } }) => {
    upstream.lastUrl = url;
    upstream.lastAuth = init && init.headers ? init.headers.authorization || '' : '';
    upstream.calls++;
    return {
      status,
      headers: { get: (name: string) => (name === 'retry-after' ? retryAfter || null : null) },
      text: async () => JSON.stringify(body),
    };
  };
}
upstream.calls = 0;
upstream.lastUrl = '';
upstream.lastAuth = '';

describe('billing DHT peer contract', () => {
  it('stays disabled without a long token and a plain origin', () => {
    expect(dhtConfig({}).enabled).toBe(false);
    expect(dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: 'short' }).enabled).toBe(false);
    expect(dhtConfig({ BILLING_DHT_URL: 'http://user:pass@dht-peers:8788', BILLING_DHT_TOKEN: TOKEN }).enabled).toBe(false);
    expect(dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788/extra', BILLING_DHT_TOKEN: TOKEN }).enabled).toBe(false);
    expect(dhtConfig({ BILLING_DHT_URL: 'file:///tmp/x', BILLING_DHT_TOKEN: TOKEN }).enabled).toBe(false);
    const on = dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN });
    expect(on.enabled).toBe(true);
    expect(on.url).toBe('http://dht-peers:8788');
    expect(dhtPeersLimitConfig({}).max).toBe(30);
    expect(dhtPeersLimitConfig({}).windowMs).toBe(DHT_WINDOW_MS);
    expect(dhtPeersLimitConfig({ BILLING_DHT_WINDOW_SEC: '1' }).windowMs).toBe(60 * 1000);
    expect(dhtPeersLimitConfig({ BILLING_DHT_DEVICE_MAX: '0' }).max).toBe(0);
    expect(dhtPerMinute(null, {})).toBe(30);
    expect(dhtPerMinute({}, { BILLING_DHT_DEVICE_MAX: '8' })).toBe(8);
    expect(dhtPerMinute({ dhtPerMinute: 12 }, { BILLING_DHT_DEVICE_MAX: '8' })).toBe(12);
    expect(dhtPerMinute({ dhtPerMinute: 0 }, { BILLING_DHT_DEVICE_MAX: '8' })).toBe(0);
    expect(validDhtPerMinute('1.5')).toBe(false);
    expect(validDhtPerMinute('1001')).toBe(false);
    expect(mergeSettings({ dhtPerMinute: 12 }, { dhtPerMinute: '4' }).dhtPerMinute).toBe(4);
    expect(mergeSettings({ dhtPerMinute: 12 }, { dhtPerMinute: 'nope' }).dhtPerMinute).toBe(12);
    expect(mergeSettings({}, { priceRub: '1' }).dhtPerMinute).toBeUndefined();
    expect(publicAdminSettings({}, { BILLING_DHT_DEVICE_MAX: '8' }).dhtPerMinute).toBe(8);
    expect(publicAdminSettings({ dhtPerMinute: 4 }, { BILLING_DHT_DEVICE_MAX: '8' }).dhtPerMinute).toBe(4);
    expect(publicAdminSettings({}, {}).dhtPerMinute).toBe(30);
  });

  it('drops peer addresses and skips the sidecar when disabled or the hash is bad', async () => {
    expect(publicDhtBody({ peers: 4, source: 'dht', approx: true, ips: ['1.2.3.4:1'] })).toEqual({
      peers: 4,
      source: 'dht',
      approx: true,
    });
    expect(publicDhtBody({ peers: 4, source: 'dht' })).toBe(null);
    expect(publicDhtBody({ peers: 1.5, source: 'dht', approx: true })).toBe(null);

    upstream.calls = 0;
    const off = await queryDhtPeers(dhtConfig({}), HASH, upstream);
    expect(off).toEqual({ status: 503, body: { error: 'disabled' }, upstream: 'disabled' });
    const bad = await queryDhtPeers(dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN }), 'nope', upstream);
    expect(bad.status).toBe(400);
    expect(upstream.calls).toBe(0);
  });

  it('calls the sidecar with the internal token and returns the public count', async () => {
    const fetchImpl = upstream(200, { peers: 7, source: 'dht', approx: true, cached: true, ips: ['9.9.9.9:1'] });
    upstream.calls = 0;
    const cfg = dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788/', BILLING_DHT_TOKEN: TOKEN });
    const out = await queryDhtPeers(cfg, HASH.toUpperCase(), fetchImpl);
    expect(out).toEqual({ status: 200, body: { peers: 7, source: 'dht', approx: true } });
    expect(upstream.lastUrl).toBe('http://dht-peers:8788/v1/peers?infohash=' + HASH);
    expect(upstream.lastAuth).toBe('Bearer ' + TOKEN);
    expect(JSON.stringify(out.body)).not.toContain('9.9.9.9');
  });

  it('maps a sidecar miss and a rate limit without leaking the internal error', async () => {
    const down = await queryDhtPeers(
      dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN }),
      HASH,
      async () => {
        throw new Error('refused');
      },
    );
    expect(down).toEqual({ status: 502, body: { error: 'down' }, upstream: 'down' });

    const limited = await queryDhtPeers(
      dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN }),
      HASH,
      upstream(429, { error: 'rate', retryAfter: 2 }, '3'),
    );
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'rate' });
    expect(limited.retryAfter).toBe(3);
  });

  it('reads sidecar health without sending the token', async () => {
    const cfg = dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN });
    let seen = '';
    let auth = '';
    const ok = await probeDhtSidecar(cfg, async (url: string, init: { headers?: { authorization?: string } }) => {
      seen = url;
      auth = init && init.headers && init.headers.authorization ? init.headers.authorization : '';
      return { status: 200, text: async () => JSON.stringify({ ok: true, dht: 'idle', rss: 40 * 1024 * 1024, token: TOKEN }) };
    });
    expect(seen).toBe('http://dht-peers:8788/health');
    expect(auth).toBe('');
    expect(ok).toMatchObject({ configured: true, ok: true, dht: 'idle', rss: 40 * 1024 * 1024 });
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
    const off = await probeDhtSidecar(dhtConfig({}), async () => {
      throw new Error('should not fetch');
    });
    expect(off).toEqual({ configured: false, ok: false, dht: 'off', rss: null, latencyMs: 0 });
    const down = await probeDhtSidecar(cfg, async () => {
      throw new Error('token=' + TOKEN);
    });
    expect(down.ok).toBe(false);
    expect(JSON.stringify(down)).not.toContain(TOKEN);
  });
});
