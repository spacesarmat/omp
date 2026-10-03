import { describe, it, expect, afterEach } from 'vitest';
import { allSources, getSource, registerSource, unregisterSource, builtinSources, torrServerSources, fromSearchResult } from '../../src/sources/registry';
import type { SearchResult } from '../../src/api/types';
import type { SourceContext } from '../../src/sources/types';

const GB = 1024 * 1024 * 1024;
const hex = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';

function sr(p: Partial<SearchResult>): SearchResult {
  return { Title: 'T', Categories: 'Movie', Size: '1.5 GB', CreateDate: '2026-10-01T10:00:00Z', Tracker: 'Rutor', Link: 'http://rutor.info/torrent/1', Magnet: 'magnet:?xt=urn:btih:' + hex.toUpperCase(), Hash: '', Peer: 2, Seed: 7, ...p };
}

afterEach(() => { unregisterSource('test-builtin'); });

describe('registry', () => {
  it('lists TorrServer rutor and Torznab first, built-ins after', () => {
    expect(torrServerSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab']);
    expect(builtinSources()).toEqual([]);
    registerSource({ id: 'test-builtin', name: 'Test', kind: 'builtin', search: () => Promise.resolve([]) });
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab', 'test-builtin']);
    expect(getSource('test-builtin')!.name).toBe('Test');
    expect(getSource('ts-rutor')!.kind).toBe('torrserver');
    expect(getSource('nope')).toBeUndefined();
  });

  it('registering the same id replaces it', () => {
    registerSource({ id: 'test-builtin', name: 'A', kind: 'builtin', search: () => Promise.resolve([]) });
    registerSource({ id: 'test-builtin', name: 'B', kind: 'builtin', search: () => Promise.resolve([]) });
    expect(builtinSources().map((s) => s.name)).toEqual(['B']);
  });

  it('converts TorrServer results', () => {
    const r = fromSearchResult(sr({}), 'ts-rutor');
    expect(r.source).toBe('ts-rutor');
    expect(r.hash).toBe(hex);
    expect(r.sizeBytes).toBe(1.5 * GB);
    expect(r.date).toBe(Date.UTC(2026, 9, 1, 10));
    expect(r.detailUrl).toBe('http://rutor.info/torrent/1');
    const n = fromSearchResult(sr({ Magnet: '', Hash: hex.toUpperCase(), Size: '', CreateDate: '', Link: '' }), 'ts-torznab');
    expect(n.hash).toBe(hex);
    expect(n.sizeBytes).toBeUndefined();
    expect(n.date).toBeUndefined();
    expect(n.detailUrl).toBeUndefined();
  });

  it('TorrServer sources call client.search with rutor / torznab', async () => {
    const calls: string[] = [];
    const ctx: SourceContext = {
      http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
      client: { search: (q, s) => { calls.push(q + ':' + s); return Promise.resolve([sr({ Title: s })]); } },
    };
    const a = await getSource('ts-rutor')!.search('matrix', ctx);
    const b = await getSource('ts-torznab')!.search('matrix', ctx);
    expect(calls).toEqual(['matrix:rutor', 'matrix:torznab']);
    expect(a[0].source).toBe('ts-rutor');
    expect(b[0].source).toBe('ts-torznab');
    await expect(getSource('ts-rutor')!.search('x', { http: ctx.http, client: null })).rejects.toThrow('Нет сервера');
  });
});
