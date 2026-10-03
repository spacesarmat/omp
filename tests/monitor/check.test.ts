import { describe, it, expect, beforeEach } from 'vitest';
import { checkSubscriptions, checkSubscription, type SearchFn } from '../../src/monitor/check';
import { addSubscription, findingsOf, loadFound, seenKeys, unseenCount } from '../../src/monitor/subs';
import { resultKeys } from '../../src/monitor/match';
import type { Subscription } from '../../src/monitor/types';
import type { SearchAllOptions, SearchHandle } from '../../src/sources/search';
import type { SourceContext, SourceResult } from '../../src/sources/types';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'rutor', ...extra };
}

interface Call {
  query: string;
  sources?: string[];
}

/** A scripted searchAll: answers per query from `pages`, every source answered unless `fail`. */
function fakeSearch(pages: { [query: string]: SourceResult[] }, calls: Call[], fail?: boolean): SearchFn {
  return (query: string, opts: SearchAllOptions): SearchHandle => {
    calls.push({ query, sources: opts.sources });
    const list = pages[query] || [];
    return {
      sourceIds: ['rutor'],
      results: () => (fail ? [] : list.slice()),
      pending: () => [],
      answered: () => (fail ? [] : ['rutor']),
      failed: () => (fail ? ['rutor'] : []),
      done: Promise.resolve(),
      cancel: () => undefined,
    };
  };
}

function newSub(extra?: Partial<Subscription>): Subscription {
  return addSubscription({ query: 'Дюна', quality: '1080', sources: null, notify: true, ...extra }, 1000)!;
}

beforeEach(() => {
  localStorage.clear();
});

describe('checkSubscription', () => {
  it('the first run only remembers what it found; later runs return the new matches', async () => {
    const sub = newSub();
    const calls: Call[] = [];
    const pages: { [q: string]: SourceResult[] } = {
      Дюна: [res('Дюна 1080p', { hash: 'a'.repeat(40) }), res('Дюна 720p'), res('Дюна 2160p', { sizeBytes: 50 })],
    };
    const first = await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 5000 });
    expect(first.first).toBe(true);
    expect(first.findings).toEqual([]);
    expect(loadFound()).toEqual([]);
    // only matching results are remembered (720p is filtered out)
    expect(seenKeys(sub.id)!.indexOf('h:' + 'a'.repeat(40))).toBeGreaterThanOrEqual(0);
    expect(seenKeys(sub.id)).toHaveLength(3);
    expect(calls).toEqual([{ query: 'Дюна', sources: undefined }]);

    pages['Дюна'] = pages['Дюна'].concat([res('Дюна Часть вторая 1080p', { source: 'nnmclub', sizeBytes: 9e9 }), res('Дюна 480p')]);
    const second = await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 6000 });
    expect(second.first).toBe(false);
    expect(second.findings.map((f) => f.result.Title)).toEqual(['Дюна Часть вторая 1080p']);
    const f = second.findings[0];
    expect(f).toMatchObject({ subId: sub.id, at: 6000 });
    expect(f.key).toBe(resultKeys(f.result)[0]);
    expect(f.seen).toBeUndefined();
    expect(findingsOf(sub.id).map((x) => x.result.Title)).toEqual(['Дюна Часть вторая 1080p']);
    expect(unseenCount(sub.id)).toBe(1);

    // nothing new the third time
    const third = await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 7000 });
    expect(third.findings).toEqual([]);
    expect(findingsOf(sub.id)).toHaveLength(1);
  });

  it('a release seen with its hash is not new when another site lists it without the hash', async () => {
    const sub = newSub({ quality: '' });
    const calls: Call[] = [];
    const pages = { Дюна: [res('Дюна (2021) 1080p', { hash: 'b'.repeat(40), sizeBytes: 8e9 })] };
    await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 1 });
    const again = { Дюна: [res('Дюна (2021) 1080p', { source: 'nnmclub', sizeBytes: 8e9 + 1e6 })] };
    expect((await checkSubscription(ctx, sub, { search: fakeSearch(again, calls), now: 2 })).findings).toEqual([]);
  });

  it('searches the chosen sources of the subscription', async () => {
    const sub = newSub({ sources: ['rutor', 'nnmclub'] });
    const calls: Call[] = [];
    await checkSubscription(ctx, sub, { search: fakeSearch({}, calls) });
    expect(calls).toEqual([{ query: 'Дюна', sources: ['rutor', 'nnmclub'] }]);
  });

  it('when no source answered nothing is remembered (the first run stays first)', async () => {
    const sub = newSub();
    const calls: Call[] = [];
    const r = await checkSubscription(ctx, sub, { search: fakeSearch({ Дюна: [res('Дюна 1080p')] }, calls, true) });
    expect(r.failed).toEqual(['rutor']);
    expect(r.findings).toEqual([]);
    expect(seenKeys(sub.id)).toBeNull();
  });

  it('a search that throws counts as no answer', async () => {
    const sub = newSub();
    const thrower: SearchFn = () => {
      throw new Error('boom');
    };
    const r = await checkSubscription(ctx, sub, { search: thrower });
    expect(r.answered).toEqual([]);
    expect(seenKeys(sub.id)).toBeNull();
  });
});

describe('checkSubscriptions', () => {
  it('runs every saved subscription and returns all new findings', async () => {
    const a = newSub({ query: 'Дюна' });
    const b = newSub({ query: 'Матрица', quality: '' });
    const calls: Call[] = [];
    const pages: { [q: string]: SourceResult[] } = { Дюна: [res('Дюна 1080p')], Матрица: [res('Матрица')] };
    const first = await checkSubscriptions(ctx, { search: fakeSearch(pages, calls), now: 10 });
    expect(first.findings).toEqual([]);
    expect(first.subs.map((s) => s.sub.id + ':' + s.first)).toEqual([a.id + ':true', b.id + ':true']);
    expect(first.at).toBe(10);
    pages['Дюна'] = [res('Дюна 1080p'), res('Дюна 2 1080p')];
    pages['Матрица'] = [res('Матрица'), res('Матрица 4')];
    const second = await checkSubscriptions(ctx, { search: fakeSearch(pages, calls), now: 20, concurrency: 1 });
    expect(second.findings.map((f) => f.subId + ':' + f.result.Title)).toEqual([a.id + ':Дюна 2 1080p', b.id + ':Матрица 4']);
    expect(calls.map((c) => c.query)).toEqual(['Дюна', 'Матрица', 'Дюна', 'Матрица']);
    expect(unseenCount()).toBe(2);
  });

  it('takes a given list and resolves with nothing to check', async () => {
    const calls: Call[] = [];
    const r = await checkSubscriptions(ctx, { search: fakeSearch({}, calls), subs: [] });
    expect(r.findings).toEqual([]);
    expect(r.subs).toEqual([]);
    expect(calls).toEqual([]);
  });
});
