import { describe, it, expect, beforeEach } from 'vitest';
import { checkSubscriptions, checkSubscription, type SearchFn } from '../../src/monitor/check';
import { addSubscription, bestRank, findingsOf, loadFound, removeSubscription, seenKeys, unseenCount, updateSubscription } from '../../src/monitor/subs';
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
  it('background runs keep the normal timeout for Cloudflare sites', async () => {
    let seen: SearchAllOptions | null = null;
    const search: SearchFn = (query, opts) => {
      seen = opts;
      return fakeSearch({}, [])(query, opts);
    };
    await checkSubscription(ctx, newSub(), { search, now: 1 });
    expect(seen!.cloudflareTimeoutMs).toBe(15000);
    await checkSubscription(ctx, newSub({ query: 'Другое' }), { search, now: 2, timeoutMs: 8000 });
    expect(seen!.cloudflareTimeoutMs).toBe(8000);
  });

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
    expect(seenKeys(sub.id)!.filter((e) => e.indexOf('h:' + 'a'.repeat(40) + '|t:') === 0)).toHaveLength(1);
    expect(seenKeys(sub.id)).toHaveLength(2);
    expect(calls).toEqual([{ query: 'Дюна', sources: undefined }]);

    pages['Дюна'] = pages['Дюна'].concat([res('Дюна Часть вторая 1080p', { sizeBytes: 9e9 }), res('Дюна 480p')]);
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
    const again = { Дюна: [res('Дюна (2021) 1080p', { sizeBytes: 8e9 + 1e6 })] };
    expect((await checkSubscription(ctx, sub, { search: fakeSearch(again, calls), now: 2 })).findings).toEqual([]);
  });

  it('a check with more results than SEEN_MAX never reports them again (200-results probe)', async () => {
    const sub = newSub({ quality: '' });
    const calls: Call[] = [];
    const list: SourceResult[] = [];
    for (let i = 0; i < 200; i++) list.push(res('Дюна релиз ' + i, { hash: (1000000000 + i).toString(16).padStart(40, '0'), sizeBytes: 1e9 + i * 5e7 }));
    const pages = { Дюна: list };
    const counts: number[] = [];
    for (let run = 0; run < 4; run++) counts.push((await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: run })).findings.length);
    expect(counts).toEqual([0, 0, 0, 0]);
    // and 400 results, the same
    const more = { Дюна: list.concat(list.map((r, i) => res('Дюна другой ' + i, { sizeBytes: 3e9 + i * 1e8 }))) };
    const sub2 = newSub({ query: 'Дюна', quality: '' });
    const c2: number[] = [];
    for (let run = 0; run < 3; run++) c2.push((await checkSubscription(ctx, sub2, { search: fakeSearch(more, calls), now: run })).findings.length);
    expect(c2).toEqual([0, 0, 0]);
  });

  it('a source that did not answer the first check is silent on its own first answer', async () => {
    const sub = newSub({ quality: '' });
    const answering = (ids: string[], list: SourceResult[]): SearchFn => () => ({
      sourceIds: ['rutor', 'nnmclub'],
      results: () => list.slice(),
      pending: () => [],
      answered: () => ids.slice(),
      failed: () => ['rutor', 'nnmclub'].filter((id) => ids.indexOf(id) < 0),
      done: Promise.resolve(),
      cancel: () => undefined,
    });
    const r1 = res('Дюна A', { sizeBytes: 1e9 });
    const n1 = res('Дюна N1', { source: 'nnmclub', sizeBytes: 2e9 });
    const n2 = res('Дюна N2', { source: 'nnmclub', sizeBytes: 3e9 });
    const both = res('Дюна B', { source: 'nnmclub', sources: ['rutor'], sizeBytes: 4e9 });
    expect((await checkSubscription(ctx, sub, { search: answering(['rutor'], [r1]) })).first).toBe(true);
    // nnmclub answers for the first time: its results are remembered, not reported; a result rutor lists too is new
    const second = await checkSubscription(ctx, sub, { search: answering(['rutor', 'nnmclub'], [r1, n1, both]) });
    expect(second.findings.map((f) => f.result.Title)).toEqual(['Дюна B']);
    const third = await checkSubscription(ctx, sub, { search: answering(['rutor', 'nnmclub'], [r1, n1, both, n2]) });
    expect(third.findings.map((f) => f.result.Title)).toEqual(['Дюна N2']);
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

  it('a subscription deleted or edited while the search runs gets no findings and no seen results', async () => {
    const sub = newSub({ quality: '' });
    const calls: Call[] = [];
    const pages: { [q: string]: SourceResult[] } = { Дюна: [res('Дюна 1080p', { hash: 'a'.repeat(40) })] };
    await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 1 });
    pages['Дюна'] = [res('Дюна 1080p', { hash: 'a'.repeat(40) }), res('Дюна 2160p', { hash: 'b'.repeat(40) })];
    const edited = checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 2 });
    updateSubscription(sub.id, { query: 'Дюна 2' });
    expect((await edited).findings).toEqual([]);
    expect(loadFound()).toEqual([]);
    expect(seenKeys(sub.id)).toBeNull();
    const sub2 = newSub({ quality: '' });
    await checkSubscription(ctx, sub2, { search: fakeSearch(pages, calls), now: 1 });
    const gone = checkSubscription(ctx, sub2, { search: fakeSearch({ Дюна: pages['Дюна'].concat([res('Дюна 3')]) }, calls), now: 2 });
    removeSubscription(sub2.id);
    expect((await gone).findings).toEqual([]);
    expect(loadFound()).toEqual([]);
    expect(unseenCount()).toBe(0);
  });
});

describe('«Только лучшее качество»', () => {
  it('reports only the best new result, and only above every rank reported before', async () => {
    const sub = newSub({ query: 'Северный ветер', quality: '', better: true });
    const calls: Call[] = [];
    const pages: { [q: string]: SourceResult[] } = { 'Северный ветер': [res('Северный ветер (2026) CAMRip')] };
    await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 1 });
    expect(findingsOf(sub.id)).toEqual([]);
    expect(bestRank(sub.id)).toBe(-1);
    pages['Северный ветер'] = [
      res('Северный ветер (2026) CAMRip'),
      res('Северный ветер (2026) TS 1080p'),
      res('Северный ветер (2026) WEB-DL 1080p', { Seed: 3 }),
      res('Северный ветер (2026) WEBRip 1080p', { Seed: 9 }),
      res('Северный ветер (2026) WEB-DL 720p'),
    ];
    const second = await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 2 });
    expect(second.findings.map((f) => f.result.Title)).toEqual(['Северный ветер (2026) WEBRip 1080p']);
    expect(bestRank(sub.id)).toBe(22);
    pages['Северный ветер'] = pages['Северный ветер'].concat([res('Северный ветер (2026) WEB-DL 1080p от Группы')]);
    expect((await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 3 })).findings).toEqual([]);
    pages['Северный ветер'] = pages['Северный ветер'].concat([res('Северный ветер (2026) 2160p WEB-DL')]);
    const fourth = await checkSubscription(ctx, sub, { search: fakeSearch(pages, calls), now: 4 });
    expect(fourth.findings.map((f) => f.result.Title)).toEqual(['Северный ветер (2026) 2160p WEB-DL']);
    expect(bestRank(sub.id)).toBe(32);
    expect(findingsOf(sub.id)).toHaveLength(2);
  });

  it('without the flag every new result is reported, as before', async () => {
    const sub = newSub({ query: 'Северный ветер', quality: '' });
    const pages: { [q: string]: SourceResult[] } = { 'Северный ветер': [res('Северный ветер (2026) CAMRip')] };
    await checkSubscription(ctx, sub, { search: fakeSearch(pages, []), now: 1 });
    pages['Северный ветер'] = pages['Северный ветер'].concat([res('Северный ветер (2026) WEB-DL 1080p'), res('Северный ветер (2026) WEB-DL 720p')]);
    expect((await checkSubscription(ctx, sub, { search: fakeSearch(pages, []), now: 2 })).findings).toHaveLength(2);
    expect(bestRank(sub.id)).toBe(-1);
  });
});
