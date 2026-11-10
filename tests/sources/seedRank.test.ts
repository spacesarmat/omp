import { describe, expect, it } from 'vitest';
import { freshnessScore, orderSearch, rankSearchResults, seasonScore } from '../../src/sources/seedRank';
import type { SourceResult } from '../../src/sources/types';

const NOW = 1_700_000_000_000;

function row(p: Partial<SourceResult> & { Title: string }): SourceResult {
  return {
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
    ...p,
  };
}

describe('seed ranking', () => {
  it('keeps the tracker seed order until a check round exists', () => {
    const list = [
      row({ Title: 'Old', Seed: 2 }),
      row({ Title: 'Hot', Seed: 40 }),
    ];
    expect(orderSearch(list, 'seeds', 'hot', NOW).map((r) => r.Title)).toEqual(['Hot', 'Old']);
  });

  it('puts a checked swarm above a larger unchecked count', () => {
    const list = [
      row({ Title: 'Tracker says 5000', Seed: 5000, seedCheck: 'unverified' }),
      row({ Title: 'Live one', Seed: 1, seedCheck: 'live', seedCheckAt: NOW }),
    ];
    expect(rankSearchResults(list, 'live', NOW).map((r) => r.Title)).toEqual(['Live one', 'Tracker says 5000']);
  });

  it('ranks a fresh measurement above an older one with the same seeds', () => {
    const list = [
      row({ Title: 'Stale', Seed: 10, seedCheck: 'live', seedCheckAt: NOW - 5 * 60 * 60 * 1000 }),
      row({ Title: 'Fresh', Seed: 10, seedCheck: 'live', seedCheckAt: NOW - 60 * 1000 }),
    ];
    expect(rankSearchResults(list, 'show', NOW)[0].Title).toBe('Fresh');
    expect(freshnessScore(0)).toBeGreaterThan(freshnessScore(60 * 60 * 1000));
    expect(freshnessScore(7 * 60 * 60 * 1000)).toBe(0);
  });

  it('prefers the asked season, then quality, and keeps a dead checked row above an unchecked one', () => {
    const query = 'Show S02';
    expect(seasonScore('Show S02E01', [2])).toBe(1);
    expect(seasonScore('Show S01', [2])).toBe(-1);
    expect(seasonScore('Show', [2])).toBe(0);
    const list = [
      row({ Title: 'Show S01 2160p', Seed: 20, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Show S02 720p', Seed: 20, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Show S02 1080p', Seed: 20, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Show S02', Seed: 0, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Show S02 WEB-DL', Seed: 400, seedCheck: 'unverified' }),
      row({ Title: 'Show S02', Seed: 3, seedCheck: 'dht', dhtPeers: 8 }),
    ];
    const titles = rankSearchResults(list, query, NOW).map((r) => r.Title);
    expect(titles[0]).toBe('Show S02 1080p');
    expect(titles.indexOf('Show S02 720p')).toBeLessThan(titles.indexOf('Show S01 2160p'));
    expect(titles.indexOf('Show S02')).toBeLessThan(titles.indexOf('Show S02 WEB-DL'));
    expect(titles[titles.length - 1]).toBe('Show S02 WEB-DL');
  });

  it('leaves a date sort alone', () => {
    const list = [
      row({ Title: 'A', Seed: 1, date: 1, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'B', Seed: 9, date: 5, seedCheck: 'unverified' }),
    ];
    expect(orderSearch(list, 'date', 'a', NOW).map((r) => r.Title)).toEqual(['B', 'A']);
  });
});
