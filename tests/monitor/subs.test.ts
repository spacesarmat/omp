import { describe, it, expect, beforeEach } from 'vitest';
import {
  SUBS_KEY,
  SEEN_KEY,
  FOUND_KEY,
  SEEN_MAX,
  FOUND_MAX,
  BETTER_FOUND_MAX,
  loadSubs,
  getSubscription,
  addSubscription,
  updateSubscription,
  removeSubscription,
  pruneEpisodeFindings,
  sanitizeSubscription,
  sanitizeResult,
  seenKeys,
  seenSources,
  rememberSeen,
  forgetSeen,
  loadFound,
  findingsOf,
  addFindings,
  markFindingsSeen,
  removeFindings,
  unseenCount,
  bestRank,
  rememberBestRank,
} from '../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID, type Finding } from '../../src/monitor/types';
import type { SourceResult } from '../../src/sources/types';

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 3, source: 'rutor', ...extra };
}

function finding(subId: string, key: string, at: number, extra?: Partial<Finding>): Finding {
  return { subId, key, result: res('R ' + key), at, ...extra };
}

beforeEach(() => {
  localStorage.clear();
});

describe('subscriptions', () => {
  it('adds, reads back, updates and removes', () => {
    expect(loadSubs()).toEqual([]);
    const a = addSubscription({ query: '  Дюна  ', quality: '1080', sources: null, notify: true, minSeeds: 5 }, 1000)!;
    expect(a.id).toMatch(/^s/);
    expect(a).toMatchObject({ query: 'Дюна', quality: '1080', sources: null, notify: true, minSeeds: 5, createdAt: 1000 });
    expect(a.maxSizeGb).toBeUndefined();
    const b = addSubscription({ query: 'Матрица', quality: '', sources: ['rutor'], notify: false, maxSizeGb: 20 }, 2000)!;
    expect(b.id).not.toBe(a.id);
    expect(loadSubs().map((s) => s.query)).toEqual(['Дюна', 'Матрица']);
    expect(JSON.parse(localStorage.getItem(SUBS_KEY)!)).toHaveLength(2);
    const u = updateSubscription(a.id, { quality: '2160', minSeeds: undefined, query: 'Дюна 2' })!;
    expect(u).toMatchObject({ id: a.id, query: 'Дюна 2', quality: '2160', createdAt: 1000 });
    expect(u.minSeeds).toBeUndefined();
    expect(getSubscription(a.id)!.query).toBe('Дюна 2');
    expect(updateSubscription('nope', { query: 'x' })).toBeNull();
    expect(updateSubscription(a.id, { query: '   ' })).toBeNull();
    removeSubscription(a.id);
    expect(loadSubs().map((s) => s.id)).toEqual([b.id]);
  });

  it('refuses an empty query', () => {
    expect(addSubscription({ query: '  ', quality: '', sources: null, notify: true })).toBeNull();
    expect(loadSubs()).toEqual([]);
  });

  it('sanitizes stored values and drops broken ones', () => {
    expect(sanitizeSubscription({ id: 'x', query: 'q', quality: '4k', sources: ['a', 1, 'a'], notify: 'yes', createdAt: 5, minSeeds: -1, maxSizeGb: 0 })).toEqual({
      id: 'x',
      query: 'q',
      quality: '',
      sources: ['a'],
      notify: true,
      createdAt: 5,
    });
    expect(sanitizeSubscription({ id: 'x', query: 'q', quality: '720', sources: 'all', notify: false, createdAt: 'z', minSeeds: 2.7, maxSizeGb: 1.5 })).toEqual({
      id: 'x',
      query: 'q',
      quality: '720',
      sources: null,
      notify: false,
      createdAt: 0,
      minSeeds: 2,
      maxSizeGb: 1.5,
    });
    expect(sanitizeSubscription({ id: '', query: 'q' })).toBeNull();
    expect(sanitizeSubscription({ id: 'x', query: ' ' })).toBeNull();
    expect(sanitizeSubscription(null)).toBeNull();
    localStorage.setItem(SUBS_KEY, JSON.stringify([{ id: 'a', query: 'ok' }, 'junk', { id: 'a', query: 'dup' }]));
    expect(loadSubs().map((s) => s.query)).toEqual(['ok']);
    localStorage.setItem(SUBS_KEY, '{oops');
    expect(loadSubs()).toEqual([]);
  });

  it('removing a subscription forgets its seen keys and findings', () => {
    const a = addSubscription({ query: 'q', quality: '', sources: null, notify: true }, 1)!;
    rememberSeen(a.id, ['k1']);
    addFindings([finding(a.id, 'k1', 10), finding('other', 'k2', 11)]);
    removeSubscription(a.id);
    expect(seenKeys(a.id)).toBeNull();
    expect(loadFound().map((f) => f.subId)).toEqual(['other']);
  });
});

describe('seen results', () => {
  it('null before the first check; the latest check is kept whole, older entries fill up to SEEN_MAX', () => {
    expect(seenKeys('s1')).toBeNull();
    rememberSeen('s1', []);
    expect(seenKeys('s1')).toEqual([]);
    rememberSeen('s1', ['a', 'b']);
    rememberSeen('s1', ['c', 'a']);
    expect(seenKeys('s1')).toEqual(['c', 'a', 'b']);
    const many: string[] = [];
    for (let i = 0; i < SEEN_MAX + 50; i++) many.push('k' + i);
    rememberSeen('s1', many);
    expect(SEEN_MAX).toBe(300);
    // more than SEEN_MAX in one check: all of them stay, the older ones go
    expect(seenKeys('s1')).toHaveLength(SEEN_MAX + 50);
    expect(seenKeys('s1')!.indexOf('b')).toBe(-1);
    rememberSeen('s1', ['x']);
    expect(seenKeys('s1')).toHaveLength(SEEN_MAX);
    expect(seenKeys('s1')![0]).toBe('x');
    expect(seenKeys('s2')).toBeNull();
  });

  it('answered sources accumulate; forgetSeen starts over', () => {
    expect(seenSources('s1')).toEqual([]);
    rememberSeen('s1', ['a'], ['rutor']);
    rememberSeen('s1', ['b'], ['nnmclub', 'rutor']);
    expect(seenSources('s1')).toEqual(['rutor', 'nnmclub']);
    forgetSeen('s1');
    expect(seenKeys('s1')).toBeNull();
    expect(seenSources('s1')).toEqual([]);
  });

  it('a broken store reads as empty; the old array shape is read', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ s1: ['a', 3, 'b'], s2: 'x', s3: { k: ['c'], s: ['rutor', 1] }, s4: { s: [] } }));
    expect(seenKeys('s1')).toEqual(['a', 'b']);
    expect(seenKeys('s2')).toBeNull();
    expect(seenKeys('s3')).toEqual(['c']);
    expect(seenSources('s3')).toEqual(['rutor']);
    expect(seenKeys('s4')).toBeNull();
  });

  it('changing the query or the filters forgets the seen results; other changes keep them', () => {
    const a = addSubscription({ query: 'q', quality: '', sources: null, notify: true }, 1)!;
    rememberSeen(a.id, ['k'], ['rutor']);
    updateSubscription(a.id, { notify: false });
    expect(seenKeys(a.id)).toEqual(['k']);
    updateSubscription(a.id, { quality: '1080' });
    expect(seenKeys(a.id)).toBeNull();
    const changes: Partial<Parameters<typeof updateSubscription>[1]>[] = [{ query: 'q2' }, { minSeeds: 3 }, { maxSizeGb: 9 }, { sources: ['rutor'] }];
    changes.forEach((p) => {
      rememberSeen(a.id, ['k']);
      updateSubscription(a.id, p);
      expect(seenKeys(a.id)).toBeNull();
    });
  });
});

describe('findings', () => {
  it('newest first, same key replaced, at most FOUND_MAX', () => {
    addFindings([finding('s1', 'a', 10), finding('s1', 'b', 20)]);
    addFindings([finding('s1', 'a', 30)]);
    expect(loadFound().map((f) => f.key + f.at)).toEqual(['a30', 'b20']);
    const many: Finding[] = [];
    for (let i = 0; i < FOUND_MAX + 10; i++) many.push(finding('s2', 'k' + i, 100 + i));
    addFindings(many);
    expect(FOUND_MAX).toBe(100);
    const all = loadFound();
    expect(all).toHaveLength(FOUND_MAX);
    expect(all[0].key).toBe('k' + (FOUND_MAX + 9));
    expect(JSON.parse(localStorage.getItem(FOUND_KEY)!)).toHaveLength(FOUND_MAX);
  });

  it('better-quality cards have their own cap and never push out subscription or episode cards', () => {
    expect(BETTER_FOUND_MAX).toBe(30);
    const subs: Finding[] = [];
    for (let i = 0; i < 90; i++) subs.push(finding('s1', 'k' + i, 10 + i));
    const eps: Finding[] = [];
    for (let i = 0; i < 10; i++)
      eps.push(finding(EPISODES_ID, 'e' + i + ':1:10', 200 + i, { episodes: { torrentHash: 'e' + i, torrentTitle: 'T', season: 1, haveTo: 8, to: 10 } }));
    addFindings(subs.concat(eps));
    const better: Finding[] = [];
    for (let i = 0; i < 40; i++)
      better.push(
        finding(BETTER_ID, 'b' + i + ':32', 1000 + i, { better: { torrentHash: 'b' + i, torrentTitle: 'T', have: '1080p WEB-DL', got: '4K WEB-DL' } }),
      );
    // one by one, as the background adds them
    better.forEach((f) => addFindings([f]));
    expect(findingsOf('s1')).toHaveLength(90);
    expect(findingsOf(EPISODES_ID)).toHaveLength(10);
    const kept = findingsOf(BETTER_ID).map((f) => f.key);
    expect(kept).toHaveLength(BETTER_FOUND_MAX);
    // the oldest better-quality cards went first
    expect(kept[0]).toBe('b39:32');
    expect(kept[kept.length - 1]).toBe('b10:32');
    expect(JSON.parse(localStorage.getItem(FOUND_KEY)!)).toHaveLength(130);
    markFindingsSeen();
    expect(loadFound()).toHaveLength(130);
  });

  it('a newer release of the same library torrent replaces the older card', () => {
    const ep = (to: number) => ({ torrentHash: 'abc', torrentTitle: 'T', season: 1, haveTo: 8, to });
    addFindings([finding(EPISODES_ID, 'abc:1:9', 10, { episodes: ep(9) })]);
    addFindings([finding(EPISODES_ID, 'abc:1:10', 20, { episodes: ep(10) })]);
    const list = findingsOf(EPISODES_ID);
    expect(list.map((f) => f.key)).toEqual(['abc:1:10']);
    expect(list[0].episodes).toEqual(ep(10));
  });

  it('unseen counts, marking seen and removing', () => {
    addFindings([finding('s1', 'a', 1), finding('s1', 'b', 2), finding('s2', 'c', 3), finding(EPISODES_ID, 'h:1:2', 4, { episodes: { torrentHash: 'h', torrentTitle: 'T', season: 1, haveTo: 1, to: 2 } })]);
    expect(unseenCount()).toBe(4);
    expect(unseenCount('s1')).toBe(2);
    markFindingsSeen('s1', ['a']);
    expect(unseenCount('s1')).toBe(1);
    markFindingsSeen('s1');
    expect(unseenCount('s1')).toBe(0);
    expect(findingsOf('s1').every((f) => f.seen === true)).toBe(true);
    markFindingsSeen();
    expect(unseenCount()).toBe(0);
    removeFindings(EPISODES_ID, 'h:1:2');
    expect(findingsOf(EPISODES_ID)).toEqual([]);
    removeFindings('s1');
    expect(loadFound().map((f) => f.key)).toEqual(['c']);
  });

  it('sanitizes stored findings and their results', () => {
    localStorage.setItem(
      FOUND_KEY,
      JSON.stringify([
        { subId: 's1', key: 'a', at: 5, result: { Title: 'X', source: 'rutor', Seed: '3', hash: 'ZZ', sizeBytes: 10, sources: ['nnm', 4] } },
        { subId: 's1', key: 'b', at: 6, result: { source: 'rutor' } },
        { subId: '', key: 'c', at: 7, result: { Title: 'Y', source: 'rutor' } },
        { subId: EPISODES_ID, key: 'd', at: 8, result: { Title: 'Y', source: 'rutor' } },
        'junk',
      ]),
    );
    const list = loadFound();
    expect(list).toHaveLength(1);
    expect(list[0].result).toEqual({
      Title: 'X',
      Categories: '',
      Size: '',
      CreateDate: '',
      Tracker: '',
      Link: '',
      Magnet: '',
      Hash: '',
      Peer: 0,
      Seed: 0,
      source: 'rutor',
      sizeBytes: 10,
      sources: ['nnm'],
    });
    expect(sanitizeResult(res('Z', { hash: 'a'.repeat(40), date: 9, detailUrl: 'https://x' }))).toEqual(
      res('Z', { hash: 'a'.repeat(40), date: 9, detailUrl: 'https://x' }),
    );
  });
});

describe('pruneEpisodeFindings', () => {
  it('drops only the new-episodes cards of torrents that are gone', () => {
    const r = { Title: 'x', Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 1, source: 'rutor' } as SourceResult;
    const ep = (hash: string): Finding => ({ subId: EPISODES_ID, key: hash + ':1:10', at: 1, result: r, episodes: { torrentHash: hash, torrentTitle: 't', season: 1, haveTo: 8, to: 10 } });
    addFindings([ep('a'), ep('b'), { subId: 's1', key: 'k', at: 1, result: r }]);
    pruneEpisodeFindings((h) => h === 'a');
    expect(findingsOf(EPISODES_ID).map((f) => f.episodes!.torrentHash)).toEqual(['a']);
    expect(findingsOf('s1')).toHaveLength(1);
  });
});

describe('«Лучшее качество»', () => {
  it('a subscription keeps `better` only when true', () => {
    expect(sanitizeSubscription({ id: 'a', query: 'q', better: true })!.better).toBe(true);
    expect(sanitizeSubscription({ id: 'a', query: 'q', better: 'yes' })).not.toHaveProperty('better');
    expect(sanitizeSubscription({ id: 'a', query: 'q', better: false })).not.toHaveProperty('better');
    const s = addSubscription({ query: 'Северный ветер', quality: '', sources: null, notify: true, better: true }, 1)!;
    expect(s.better).toBe(true);
    expect(updateSubscription(s.id, { better: false })).not.toHaveProperty('better');
  });

  it('the best rank lives in the seen record: kept by rememberSeen, only raised, forgotten with it', () => {
    expect(bestRank('s1')).toBe(-1);
    rememberBestRank('s1', 22);
    expect(bestRank('s1')).toBe(-1); // before the first check there is no record to keep it in
    rememberSeen('s1', ['a']);
    rememberBestRank('s1', 22);
    rememberBestRank('s1', 12);
    expect(bestRank('s1')).toBe(22);
    rememberSeen('s1', ['b'], ['rutor']);
    expect(bestRank('s1')).toBe(22);
    expect(seenKeys('s1')).toEqual(['b', 'a']);
    forgetSeen('s1');
    expect(bestRank('s1')).toBe(-1);
  });

  it('better findings: sanitized, one card per film, pruned with the library', () => {
    const b = (hash: string, rank: number): Finding => ({
      subId: BETTER_ID,
      key: hash + ':' + rank,
      at: rank,
      result: res('Северный ветер (2026) 2160p WEB-DL'),
      better: { torrentHash: hash, torrentTitle: 'Северный ветер (2026) WEB-DL 1080p', have: '1080p WEB-DL', got: '4K WEB-DL' },
    });
    addFindings([b('a', 31), b('c', 31)]);
    addFindings([b('a', 32)]);
    expect(findingsOf(BETTER_ID).map((f) => f.key)).toEqual(['a:32', 'c:31']);
    expect(findingsOf(BETTER_ID)[0].better).toEqual(b('a', 32).better);
    // a better finding without its info is dropped on load
    const stored = JSON.parse(localStorage.getItem(FOUND_KEY)!);
    localStorage.setItem(FOUND_KEY, JSON.stringify(stored.concat([{ subId: BETTER_ID, key: 'x:1', at: 1, result: { Title: 'T', source: 'rutor' } }])));
    expect(findingsOf(BETTER_ID)).toHaveLength(2);
    pruneEpisodeFindings((h) => h === 'a');
    expect(findingsOf(BETTER_ID).map((f) => f.key)).toEqual(['a:32']);
  });
});
