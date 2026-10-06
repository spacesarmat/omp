import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchSourceHttp, tvCatalog, setTvCatalogForTests } from '../../src/catalog/tvCatalog';
import { servers, addServer, setActiveServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  setTvCatalogForTests(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setTvCatalogForTests(null);
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
  it('returns the test client', async () => {
    const c = { fake: true } as unknown as CatalogClient;
    setTvCatalogForTests(c);
    expect(await tvCatalog()).toBe(c);
  });
});
