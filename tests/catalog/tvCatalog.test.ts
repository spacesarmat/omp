import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchSourceHttp, tvCatalog, setTvCatalogForTests } from '../../src/catalog/tvCatalog';
import { servers, addServer, setActiveServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';
import { setLocalTmdbSource } from '../../src/catalog/localTmdb';

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  setTvCatalogForTests(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setTvCatalogForTests(null);
  setLocalTmdbSource(null);
});

describe('fetchSourceHttp', () => {
  it('returns status, url and text from fetch', async () => {
    const f = vi.fn(() => Promise.resolve({ status: 200, url: 'https://x/y', text: () => Promise.resolve('{"a":1}') }));
    const r = await fetchSourceHttp(f as unknown as typeof fetch).get('https://x/y');
    expect(r).toEqual({ status: 200, url: 'https://x/y', text: '{"a":1}' });
  });
  it('gives status 0 on a network error', async () => {
    const f = vi.fn(() => Promise.reject(new Error('net')));
    const r = await fetchSourceHttp(f as unknown as typeof fetch).get('https://x/y');
    expect(r).toEqual({ status: 0, url: 'https://x/y', text: '' });
  });
  it('gives status 0 on timeout', async () => {
    const f = vi.fn(() => new Promise(() => undefined));
    const r = await fetchSourceHttp(f as unknown as typeof fetch).get('https://x/y', { timeoutMs: 5 });
    expect(r.status).toBe(0);
  });
});

describe('tvCatalog', () => {
  function setup(): ReturnType<typeof vi.fn> {
    setActiveServer(addServer({ url: 'h:1' }).id);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'k' } as never);
    const f = vi.fn((url: string) =>
      Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify({ results: [], total_pages: 1 })) }),
    );
    vi.stubGlobal('fetch', f);
    return f;
  }
  it('builds a client with the server key', async () => {
    const f = setup();
    const c = await tvCatalog();
    await c.search('x', 1);
    expect(f.mock.calls[0][0]).toContain('api_key=k');
  });
  it('reuses the client for the same server', async () => {
    setup();
    const a = await tvCatalog();
    const b = await tvCatalog();
    expect(b).toBe(a);
  });
  it('does not keep a client when the server key is empty', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    const spy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: '' });
    const c = await tvCatalog();
    await expect(c.search('x', 1)).rejects.toMatchObject({ code: 'nokey' });
    await tvCatalog();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('re-reads when Обзор opens again', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    const spy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'k' });
    await tvCatalog();
    await tvCatalog(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('an unreachable server is not a missing key', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockRejectedValue(Object.assign(new Error('net'), { kind: 'network' }));
    const c = await tvCatalog();
    await expect(c.search('x', 1)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('uses the phone TorrServer key when the active server has none', async () => {
    setActiveServer(addServer({ url: 'http://home:5665' }).id);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockImplementation(function (this: TorrServerClient) {
      if (this.baseUrl.indexOf('127.0.0.1') >= 0) return Promise.resolve({ APIKey: 'phone' });
      return Promise.resolve({ APIKey: '' });
    });
    setLocalTmdbSource(() => {
      const local = new TorrServerClient({ url: 'http://127.0.0.1:8090' });
      return { baseUrl: local.baseUrl, readTmdbSettings: () => local.readTmdbSettings() };
    });
    const f = vi.fn((url: string) =>
      Promise.resolve({ status: 200, url, text: () => Promise.resolve(JSON.stringify({ results: [], total_pages: 1 })) }),
    );
    vi.stubGlobal('fetch', f);
    const c = await tvCatalog();
    await c.search('x', 1);
    expect(String(f.mock.calls[0][0])).toContain('api_key=phone');
  });

  it('returns the test client', async () => {
    const c = { fake: true } as unknown as CatalogClient;
    setTvCatalogForTests(c);
    expect(await tvCatalog()).toBe(c);
  });
});
