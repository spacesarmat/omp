import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSourceHttp } from '../../src/sources/http';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { setTmdbFallbackKeyForTests } from '../../src/catalog/fallbackKey';
import { installSubPosters, lookupSubPoster } from '../../src/monitor/subPoster';
import { installRpcCatalog } from '../src/rpc/catalog';
import type { Subscription } from '../../src/monitor/types';

const sub = (query: string): Subscription => ({
  id: 's',
  query,
  quality: '',
  sources: null,
  notify: true,
  createdAt: 1,
});

beforeEach(() => {
  localStorage.clear();
  setTmdbFallbackKeyForTests('test-key');
  installSubPosters(null);
  setCatalogProvider(null);
});

afterEach(() => {
  installSubPosters(null);
  setCatalogProvider(null);
  setTmdbFallbackKeyForTests('');
});

describe('RPC page catalog', () => {
  it('looks up a missing poster through the page http, not the phone plugin', async () => {
    setTmdbFallbackKeyForTests('test-key');
    const urls: string[] = [];
    const http = createSourceHttp(async (req) => {
      urls.push(req.url);
      return {
        status: 200,
        url: req.url,
        text: JSON.stringify({
          results: [{ id: 7, media_type: 'movie', title: 'Dune', poster_path: '/abc.jpg', release_date: '2021-10-01' }],
        }),
      };
    });
    installRpcCatalog(http);
    const hit = await lookupSubPoster(sub('Dune 2021'));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0].indexOf('search')).toBeGreaterThan(-1);
    expect(hit && hit.poster.indexOf('/abc.jpg') >= 0).toBe(true);
    expect(hit && hit.poster.indexOf('https://') === 0).toBe(true);
  });
});
