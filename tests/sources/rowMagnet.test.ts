import { describe, it, expect, afterEach } from 'vitest';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { resolveRowMagnet, rowNeedsMagnet } from '../../src/sources/rowMagnet';
import { probeSeeds, setProbeContext } from '../../src/sources/liveSeedsRun';
import type { Source, SourceContext, SourceResult } from '../../src/sources/types';

const ctx = { http: { get: async () => ({ status: 200, url: '', text: '' }), post: async () => ({ status: 200, url: '', text: '' }), clearCookies: async () => undefined }, client: null } as SourceContext;

function row(): SourceResult {
  return {
    Title: 'Film 2160p BluRay',
    Categories: '',
    Size: '28.7 GB',
    CreateDate: '',
    Tracker: 'NNM-Club',
    Link: '',
    Magnet: '',
    Hash: '',
    Peer: 2,
    Seed: 11,
    source: 'nnm-test',
    detailUrl: 'https://nnmclub.to/forum/viewtopic.php?t=1',
  } as SourceResult;
}

function source(magnet: Source['magnet']): void {
  registerSource({ id: 'nnm-test', name: 'NNM-Club', kind: 'builtin', search: async () => [], magnet: magnet });
}

afterEach(() => {
  unregisterSource('nnm-test');
  setProbeContext(null);
});

describe('NNM list rows have no announce URL until the topic page is opened', () => {
  it('does not invent a tracker; it loads the magnet the source already knows how to fetch', async () => {
    let asked = '';
    source(async (url) => {
      asked = url;
      return 'magnet:?xt=urn:btih:' + 'ab'.repeat(20) + '&tr=' + encodeURIComponent('http://tr.example/announce');
    });
    const r = row();
    expect(rowNeedsMagnet(r)).toBe(true);
    const got = await resolveRowMagnet(r, ctx);
    expect(asked).toBe(r.detailUrl);
    expect(got.note).toBeUndefined();
    expect(got.row.Magnet).toContain('tr=');
    expect(got.row.Title).toBe(r.Title);
  });

  it('keeps the source error when the topic page cannot be read', async () => {
    source(async () => {
      throw new Error('Нужен вход');
    });
    const got = await resolveRowMagnet(row(), ctx);
    expect(got.row.Magnet || '').toBe('');
    expect(got.note).toBe('Нужен вход');
    setProbeContext(() => ctx);
    expect(await probeSeeds(row())).toEqual({ ok: false, reason: 'notrackers', note: 'Нужен вход' });
  });

  it('without a topic page the old no-hash result stays, and no URL is made up', async () => {
    const bare = { ...row(), detailUrl: '', source: 'missing' } as SourceResult;
    expect(rowNeedsMagnet(bare)).toBe(false);
    const got = await resolveRowMagnet(bare, ctx);
    expect(got.row.Magnet || '').toBe('');
    expect(got.note).toBeUndefined();
    expect(await probeSeeds(bare)).toEqual({ ok: false, reason: 'nohash' });
  });
});
