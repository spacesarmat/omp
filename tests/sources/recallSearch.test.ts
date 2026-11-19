import { describe, expect, it } from 'vitest';
import { searchRecall } from '../../src/sources/recallSearch';
import { mergeResults } from '../../src/sources/merge';
import type { Source, SourceResult } from '../../src/sources/types';

function row(p: Partial<SourceResult>): SourceResult {
  return {
    Title: 't', Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '',
    Peer: 0, Seed: 1, source: 'rutor', ...p,
  };
}

function source(search: Source['search']): Source {
  return { id: 'rutor', name: 'Rutor', kind: 'builtin', search };
}

describe('searchRecall', () => {
  it('searches the cleaned title and the original, and merges one infohash', async () => {
    const seen: string[] = [];
    const s = source((q) => {
      seen.push(q);
      if (q === 'Игра престолов') return Promise.resolve([row({ Title: 'Игра престолов', hash: 'aa', Seed: 2 })]);
      if (q === 'Game of Thrones') return Promise.resolve([row({ Title: 'Game of Thrones', hash: 'aa', Seed: 9 })]);
      return Promise.resolve([]);
    });
    const h = searchRecall('Игра престолов', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve(['Game of Thrones']),
    });
    await h.done;
    expect(seen[0]).toBe('Игра престолов');
    expect(seen).toContain('Game of Thrones');
    expect(h.results()).toHaveLength(1);
    expect(h.results()[0].Seed).toBe(9);
    expect(h.results()[0].hash).toBe('aa');
  });

  it('asks the next title only after the previous one of the same source has answered', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let secondStarted = false;
    const s = source((q) => {
      if (q === 'Локи') return gate.then(() => []);
      secondStarted = true;
      return Promise.resolve([]);
    });
    const h = searchRecall('Локи', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve(['Game of Thrones']),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    release();
    await h.done;
    expect(secondStarted).toBe(true);
  });

  it('retries without the subtitle when nothing relevant came back', async () => {
    const seen: string[] = [];
    const s = source((q) => {
      seen.push(q);
      if (q === 'Локи') return Promise.resolve([row({ Title: 'Локи', hash: 'bb', Seed: 4 })]);
      return Promise.resolve([]);
    });
    const h = searchRecall('Локи: Бог обмана', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve([]),
    });
    await h.done;
    expect(seen).toContain('Локи: Бог обмана');
    expect(seen).toContain('Локи');
    expect(h.results().map((r) => r.Title)).toEqual(['Локи']);
  });

  it('keeps a Cloudflare error instead of replacing it with a timeout', async () => {
    const seen: Error[] = [];
    const cf = new Error('check') as Error & { code?: string };
    cf.code = 'cloudflare-interactive';
    const s = source(() => Promise.reject(cf));
    const h = searchRecall('Локи', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve([]),
      onDone: (_id, err) => { if (err) seen.push(err); },
    });
    await h.done;
    expect(seen.length).toBeGreaterThan(0);
    expect((seen[0] as { code?: string }).code).toBe('cloudflare-interactive');
  });

  it('does not report a search that was cancelled', async () => {
    let calls = 0;
    let rejectLate: (e: Error) => void = () => {};
    const s = source(() => new Promise((_ok, rej) => { rejectLate = rej; }));
    const h = searchRecall('Локи', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve([]),
      onDone: () => { calls++; },
      onResult: () => { calls++; },
    });
    h.cancel();
    rejectLate(new Error('late'));
    await h.done;
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  it('does not retry when the first query already matched', async () => {
    const seen: string[] = [];
    const s = source((q) => {
      seen.push(q);
      return Promise.resolve([row({ Title: 'Локи', hash: 'cc', Seed: 1 })]);
    });
    const h = searchRecall('Локи', {
      ctx: {} as never,
      from: [s],
      sources: ['rutor'],
      lookup: () => Promise.resolve([]),
    });
    await h.done;
    expect(seen.filter((q) => q === 'Локи').length).toBe(1);
  });
});

describe('merge ё and е', () => {
  it('treats ё and е as one title when the size matches', () => {
    const gb = 1024 * 1024 * 1024;
    const out = mergeResults([
      row({ source: 'rutor', Title: 'Ёлки', sizeBytes: 2 * gb, Seed: 1 }),
      row({ source: 'nnmclub', Title: 'Елки', sizeBytes: 2 * gb, Seed: 5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].Seed).toBe(5);
  });
});
