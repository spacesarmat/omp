import { describe, expect, it } from 'vitest';
import { dhtConfig, dhtPeersLimitConfig, publicDhtBody, queryDhtPeers } from '../src/dhtPeers.mjs';

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
    expect(dhtPeersLimitConfig({ BILLING_DHT_DEVICE_MAX: '0' }).max).toBe(0);
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
    expect(off).toEqual({ status: 503, body: { error: 'disabled' } });
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
    expect(down).toEqual({ status: 502, body: { error: 'down' } });

    const limited = await queryDhtPeers(
      dhtConfig({ BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN }),
      HASH,
      upstream(429, { error: 'rate', retryAfter: 2 }, '3'),
    );
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'rate' });
    expect(limited.retryAfter).toBe(3);
  });
});
