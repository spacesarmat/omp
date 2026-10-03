import { describe, it, expect, beforeEach } from 'vitest';
import {
  SUBS_KEY,
  SEEN_KEY,
  FOUND_KEY,
  SEEN_MAX,
  FOUND_MAX,
  loadSubs,
  getSubscription,
  addSubscription,
  updateSubscription,
  removeSubscription,
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
} from '../../src/monitor/subs';
import { EPISODES_ID, type Finding } from '../../src/monitor/types';
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
