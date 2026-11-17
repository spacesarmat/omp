import { Agent as HttpAgent, globalAgent as httpGlobalAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain module
import { httpScrape } from '../src/seedProbeNet.mjs';
// @ts-ignore plain module
import { createTrackerGate } from '../src/seedProbe.mjs';

const HASH = 'ab'.repeat(20);

function scrapeBody(seeders: number, leechers: number, hash = HASH): string {
  let key = '';
  for (let i = 0; i < 40; i += 2) key += String.fromCharCode(parseInt(hash.substr(i, 2), 16));
  return 'd5:filesd20:' + key + 'd8:completei' + seeders + 'e10:incompletei' + leechers + 'eeee';
}

// Public-looking answers so the SSRF gate passes; private.example resolves to a private address.
const lookup = async (host: string) =>
  host === 'private.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];

type Script = { status: number; headers?: Record<string, string>; body?: string; timeout?: boolean; error?: string; delay?: number };

// A fake node:http request. Scripts are chosen by the pinned hostname (servername / Host) plus path.
// A script may delay its reply (ms) so a hop can burn part of the shared timeout budget.
function fakeRequest(choose: (host: string, path: string, protocol: string) => Script) {
  const calls: any[] = [];
  const impl = (options: any, cb: (res: any) => void) => {
    calls.push({ ...options, at: Date.now() });
    const host = String(options.servername || (options.headers && options.headers.Host) || '');
    const script = choose(host, String(options.path || ''), String(options.protocol || ''));
    const req: any = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      setTimeout(() => {
        if (script.timeout) return req.emit('timeout');
        if (script.error) return req.emit('error', new Error(script.error));
        const res: any = new EventEmitter();
        res.statusCode = script.status;
        res.headers = script.headers || {};
        res.resume = () => {};
        cb(res);
        if (script.body !== undefined) res.emit('data', Buffer.from(script.body, 'latin1'));
        res.emit('end');
      }, script.delay || 0);
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
    // The first hop burns ~80 ms of the 200 ms budget before redirecting; the https hop then
    // times out. The next request must receive ONLY the remainder, not a fresh 200 ms - a per-hop
    // fresh timeout would hand both hops the same value and this assertion would fail.
    const impl = fakeRequest((_host, _path, protocol) => {
      if (protocol === 'http:') return { status: 302, headers: { location: 'https://secure.example' + SCRAPE_PATH }, delay: 80 };
      return { status: 200, timeout: true };
    });
    const started = Date.now();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 200, { lookup, request: impl });
    expect(out).toBe(null);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(impl.calls).toHaveLength(2);
    expect(impl.calls[0].timeout).toBeGreaterThanOrEqual(190);
    expect(impl.calls[0].timeout).toBeLessThanOrEqual(200);
    expect(impl.calls[1].timeout).toBeLessThan(impl.calls[0].timeout);
    expect(impl.calls[1].timeout).toBeLessThanOrEqual(160);
    expect(impl.calls[1].timeout).toBeGreaterThan(0);
  });

  it('does not contact a name that resolves to a private address', async () => {
    const impl = fakeRequest(() => ({ status: 200, body: scrapeBody(1, 1) }));
    const out = await httpScrape('http://private.example' + SCRAPE_PATH, HASH, 1000, { lookup, request: impl });
    expect(out).toBe(null);
    expect(impl.calls).toHaveLength(0);
  });
});

describe('httpScrape tracker gate on every hop', () => {
  const redirectImpl = () =>
    fakeRequest((host) => {
      if (host === 'secure.example') return { status: 200, body: scrapeBody(8, 1) };
      return { status: 302, headers: { location: 'https://secure.example' + SCRAPE_PATH } };
    });
  // An http->https upgrade that stays on the SAME hostname (the second hop hits the host gap).
  const sameHostUpgrade = () =>
    fakeRequest((_host, _path, protocol) => {
      if (protocol === 'http:') return { status: 302, headers: { location: 'https://tracker.example' + SCRAPE_PATH } };
      return { status: 200, body: scrapeBody(8, 1) };
    });

  it('waits out the per-host gap for a shared tracker and completes within the deadline', async () => {
    // Two hashes share one HTTP tracker: the second scrape must wait the gap, not be dropped.
    const gate = createTrackerGate({ perHostGapMs: 60 });
    const impl = fakeRequest(() => ({ status: 200, body: scrapeBody(8, 1) }));
    const first = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    const second = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    expect(first).toEqual({ seeders: 8, leechers: 1 });
    expect(second).toEqual({ seeders: 8, leechers: 1 });
    expect(impl.calls).toHaveLength(2);
    expect(impl.calls[1].at - impl.calls[0].at).toBeGreaterThanOrEqual(60); // gap respected
  });

  it('completes an http->https redirect on the same hostname (second hop waits the gap)', async () => {
    const gate = createTrackerGate({ perHostGapMs: 60 });
    const impl = sameHostUpgrade();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    expect(out).toEqual({ seeders: 8, leechers: 1 });
    expect(impl.calls).toHaveLength(2);
    expect(impl.calls[0].protocol).toBe('http:');
    expect(impl.calls[1].protocol).toBe('https:');
    expect(impl.calls[1].servername).toBe('tracker.example');
    expect(impl.calls[1].at - impl.calls[0].at).toBeGreaterThanOrEqual(60); // gap respected
  });

  it('respects the per-host gap of a redirect target shared by two announce hosts', async () => {
    const gate = createTrackerGate({ perHostGapMs: 60 });
    const impl = redirectImpl();
    const first = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    const second = await httpScrape('http://other.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    expect(first).toEqual({ seeders: 8, leechers: 1 });
    expect(second).toEqual({ seeders: 8, leechers: 1 });
    const secureCalls = impl.calls.filter((c: any) => c.servername === 'secure.example');
    expect(secureCalls).toHaveLength(2); // both chains reach the target, spaced by the gap
    expect(secureCalls[1].at - secureCalls[0].at).toBeGreaterThanOrEqual(60);
  });

  it('spends the shared request-window budget on every redirect hop', async () => {
    // windowMax 2: one scrape with a single redirect uses both slots (origin + target).
    const gate = createTrackerGate({ perHostGapMs: 0, windowMs: 10000, windowMax: 2 });
    const impl = redirectImpl();
    const first = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    expect(first).toEqual({ seeders: 8, leechers: 1 });
    expect(impl.calls).toHaveLength(2);
    // The window is now full; a further scrape (even a single hop) is refused without a request.
    const next = fakeRequest(() => ({ status: 200, body: scrapeBody(3, 0) }));
    const blocked = await httpScrape('http://third.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: next, gate });
    expect(blocked).toBe(null);
    expect(next.calls).toHaveLength(0);
  });

  it('returns null without contacting a redirect target when the window is exhausted', async () => {
    // windowMax 1: the origin hop spends the only slot, so the redirect hop is capped (not a gap).
    const gate = createTrackerGate({ perHostGapMs: 0, windowMs: 10000, windowMax: 1 });
    const impl = redirectImpl();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl, gate });
    expect(out).toBe(null);
    expect(impl.calls).toHaveLength(1); // only the origin hop; the capped target is never contacted
    expect(impl.calls[0].servername).toBe('tracker.example');
  });

  it('returns null when the per-host gap outlives the remaining budget (no spinning)', async () => {
    const gate = createTrackerGate({ perHostGapMs: 500 });
    expect(gate.take('tracker.example', Date.now())).toBe(true); // host just contacted
    gate.release();
    const impl = fakeRequest(() => ({ status: 200, body: scrapeBody(8, 1) }));
    const started = Date.now();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 40, { lookup, request: impl, gate });
    expect(out).toBe(null);
    expect(impl.calls).toHaveLength(0); // budget too short to wait the gap: a miss, no contact
    expect(Date.now() - started).toBeLessThan(400); // did not spin to the gap or beyond the budget
  });

  it('still scrapes normally when no gate is passed', async () => {
    const impl = redirectImpl();
    const out = await httpScrape('http://tracker.example' + SCRAPE_PATH, HASH, 2000, { lookup, request: impl });
    expect(out).toEqual({ seeders: 8, leechers: 1 });
    expect(impl.calls).toHaveLength(2);
  });
});