import { describe, expect, it } from 'vitest';
import { lang } from '../../src/i18n';
import { freshnessScore, orderSearch, rankSearchResults, seasonScore, seedStatusLine, visibleSeedLine } from '../../src/sources/seedRank';
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
      row({ Title: 'Show S02', Seed: 3, seedCheck: 'dht', dhtPeers: 80, dhtSeeds: 8, dhtEstimate: true }),
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

describe('one seed status', () => {
  const HASH = 'ab'.repeat(20);
  const magnet = 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent('udp://tracker.example:6969/announce');

  it('puts the mark first and keeps a missing tracker address with the DHT count', () => {
    lang.value = 'ru';
    expect(seedStatusLine(row({ Title: 'A', Seed: 4, seedCheck: 'unverified' }))).toBe('не проверено · 4 сида · по данным трекера');
    expect(seedStatusLine(row({ Title: 'B', Seed: 0, seedCheck: 'unverified' }))).toBe('не проверено');
    expect(seedStatusLine(row({ Title: 'C', Seed: 2, Peer: 1, seedCheck: 'live' }))).toBe('2 сида · 1 лич · сейчас');
    expect(seedStatusLine(row({ Title: 'D', hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH, seedCheck: 'dht', dhtPeers: 80, dhtSeeds: 8, dhtEstimate: true }))).toBe(
      'Нет адреса трекера · ~8 сидов по DHT',
    );
    expect(seedStatusLine(row({ Title: 'E', hash: HASH, Magnet: magnet, seedCheck: 'dht', dhtPeers: 80, dhtSeeds: 8, dhtEstimate: true }))).toBe('~8 сидов по DHT');
    expect(seedStatusLine(row({ Title: 'P', hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH, seedCheck: 'dht', dhtPeers: 8 }))).toBe('Нет адреса трекера');
    expect(seedStatusLine(row({ Title: 'F', Seed: 9 }))).toBe('');
  });

  it('does not let a device scrape or a busy check replace the round', () => {
    lang.value = 'ru';
    const unverified = row({ Title: 'A', Seed: 4, seedCheck: 'unverified' });
    const opts = {
      indexerText: '4 сида · по данным трекера',
      liveText: '0 сидов · 0 личей',
      liveMode: 'live',
      probe: { phase: 'idle', line: '' },
      trackers: true,
      canCheck: true,
    };
    expect(visibleSeedLine(unverified, opts)).toBe('не проверено · 4 сида · по данным трекера');
    expect(visibleSeedLine(row({ Title: 'A', Seed: 4 }), { ...opts, probe: { phase: 'busy', line: '' } })).toBe('4 сида · по данным трекера');
    expect(visibleSeedLine(row({ Title: 'A', Seed: 4 }), { ...opts, probe: { phase: 'done', line: '≈0 пиров онлайн · по DHT · Нет адреса трекера' } })).toBe(
      '≈0 пиров онлайн · по DHT · Нет адреса трекера',
    );
    expect(visibleSeedLine(row({ Title: 'A', Seed: 3 }), { ...opts, trackers: false, canCheck: false, liveMode: 'search' })).toBe('Нет адреса трекера');
    expect(visibleSeedLine(row({ Title: 'A', Seed: 3 }), { ...opts, trackers: false, canCheck: true, liveMode: 'search' })).toBe('4 сида · по данным трекера');
  });
});
