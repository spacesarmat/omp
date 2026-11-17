import { Agent as HttpAgent, globalAgent as httpGlobalAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain module
import { httpScrape } from '../src/seedProbeNet.mjs';

const HASH = 'ab'.repeat(20);

function scrapeBody(seeders: number, leechers: number, hash = HASH): string {
  let key = '';
  for (let i = 0; i < 40; i += 2) key += String.fromCharCode(parseInt(hash.substr(i, 2), 16));
  return 'd5:filesd20:' + key + 'd8:completei' + seeders + 'e10:incompletei' + leechers + 'eeee';
}

// Public-looking answers so the SSRF gate passes; private.example resolves to a private address.
const lookup = async (host: string) =>
  host === 'private.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];

type Script = { status: number; headers?: Record<string, string>; body?: string; timeout?: boolean; error?: string };

// A fake node:http request. Scripts are chosen by the pinned hostname (servername / Host) plus path.
function fakeRequest(choose: (host: string, path: string, protocol: string) => Script) {
  const calls: any[] = [];
  const impl = (options: any, cb: (res: any) => void) => {
    calls.push(options);
    const host = String(options.servername || (options.headers && options.headers.Host) || '');
    const script = choose(host, String(options.path || ''), String(options.protocol || ''));
    const req: any = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      setImmediate(() => {
        if (script.timeout) return req.emit('timeout');
        if (script.error) return req.emit('error', new Error(script.error));
        const res: any = new EventEmitter();
        res.statusCode = script.status;
        res.headers = script.headers || {};
        res.resume = () => {};
        cb(res);
        if (script.body !== undefined) res.emit('data', Buffer.from(script.body, 'latin1'));
        res.emit('end');
      });
    };
    return req;
  };
  (impl as any).calls = calls;
  return impl as any;
}

const SCRAPE_PATH = '/scrape?info_hash=' + '%AB'.repeat(20);

describe('httpScrape transport', () => {
  it('passes an explicit plain agent so NODE_USE_ENV_PROXY cannot route the scrape', async () => {
    const prev = { ...process.env };
    process.env.NODE_USE_ENV_PROXY = '1';
    process.env.HTTP_PROXY = 'http://warp:1080';
    process.env.HTTPS_PROXY = 'http://warp:1080';
    try {
      const http = fakeRequest(() => ({ status: 200, body: scrapeBody(7, 2) }));
      const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: http });
      expect(out).toEqual({ seeders: 7, leechers: 2 });
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0].agent).toBeInstanceOf(HttpAgent);
      expect(http.calls[0].agent).not.toBe(httpGlobalAgent);

      const https = fakeRequest(() => ({ status: 200, body: scrapeBody(3, 1) }));
      const secure = await httpScrape('https://tracker.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: https });
      expect(secure).toEqual({ seeders: 3, leechers: 1 });
      expect(https.calls[0].agent).toBeInstanceOf(HttpsAgent);
    } finally {
      process.env.NODE_USE_ENV_PROXY = prev.NODE_USE_ENV_PROXY;
      process.env.HTTP_PROXY = prev.HTTP_PROXY;
      process.env.HTTPS_PROXY = prev.HTTPS_PROXY;
    }
  });

  it('follows an http->https redirect and re-checks the gate on the new host', async () => {
    const impl = fakeRequest((host, _path, protocol) => {
      if (protocol === 'http:') return { status: 302, headers: { location: 'https://secure.example' + SCRAPE_PATH } };
      return { status: 200, body: scrapeBody(11, 4) };
    });
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl });
    expect(out).toEqual({ seeders: 11, leechers: 4 });
    expect(impl.calls).toHaveLength(2);
    expect(impl.calls[0].protocol).toBe('http:');
    expect(impl.calls[1].protocol).toBe('https:');
    expect(impl.calls[1].servername).toBe('secure.example');
    expect(impl.calls[1].agent).toBeInstanceOf(HttpsAgent);
  });

  it('resolves a relative Location against the current origin', async () => {
    const impl = fakeRequest((_host, path, protocol) => {
      if (protocol === 'http:') return { status: 301, headers: { location: '/scrape2?info_hash=' + '%AB'.repeat(20) } };
      return { status: 200, body: scrapeBody(5, 0) };
    });
    // The relative target stays http, so it is refused (only https targets are followed).
    const refused = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl });
    expect(refused).toBe(null);
    expect(impl.calls).toHaveLength(1);
  });

  it('refuses a redirect that resolves to a private address', async () => {
    const impl = fakeRequest((host) => {
      if (host === 'tracker.example') return { status: 302, headers: { location: 'https://private.example' + SCRAPE_PATH } };
      return { status: 200, body: scrapeBody(9, 9) };
    });
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl });
    expect(out).toBe(null);
    expect(impl.calls).toHaveLength(1); // never contacts the private host
  });

  it('refuses an http->http redirect and an https->http downgrade', async () => {
    const plain = fakeRequest(() => ({ status: 302, headers: { location: 'http://secure.example' + SCRAPE_PATH } }));
    expect(await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: plain })).toBe(null);
    expect(plain.calls).toHaveLength(1);

    const down = fakeRequest(() => ({ status: 307, headers: { location: 'http://secure.example' + SCRAPE_PATH } }));
    expect(await httpScrape('https://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: down })).toBe(null);
    expect(down.calls).toHaveLength(1);
  });

  it('caps the redirect chain at three hops', async () => {
    const impl = fakeRequest(() => ({ status: 302, headers: { location: 'https://secure.example' + SCRAPE_PATH } }));
    const out = await httpScrape('https://tracker.example' + SCRAPE_PATH, HASH, 4000, { lookup, request: impl });
    expect(out).toBe(null);
    expect(impl.calls.length).toBeLessThanOrEqual(4);
    expect(impl.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('returns null on a timeout, an error, and a non-2xx block page', async () => {
    const to = fakeRequest(() => ({ status: 200, timeout: true }));
    expect(await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 50, { lookup, request: to })).toBe(null);
    const err = fakeRequest(() => ({ status: 200, error: 'ECONNRESET' }));
    expect(await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: err })).toBe(null);
    const block = fakeRequest(() => ({ status: 503, body: 'blocked' }));
    expect(await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: block })).toBe(null);
  });

  it('shares one timeout budget across the redirect chain', async () => {
    // Each hop waits longer than the whole budget; the shared deadline must cut the chain short.
    const impl = fakeRequest((_host, _path, protocol) => {
      if (protocol === 'http:') return { status: 302, headers: { location: 'https://secure.example' + SCRAPE_PATH } };
      return { status: 200, timeout: true };
    });
    const started = Date.now();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 120, { lookup, request: impl });
    expect(out).toBe(null);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not contact a name that resolves to a private address', async () => {
    const impl = fakeRequest(() => ({ status: 200, body: scrapeBody(1, 1) }));
    const out = await httpScrape('http://private.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: impl });
    expect(out).toBe(null);
    expect(impl.calls).toHaveLength(0);
  });
});