// Phase 3 crowd estimates on the client: the seed-check answer applies them as an estimate
// (never live), the line shows the device provenance, and the ranking keeps them below a
// tracker-verified row. Existing i18n plus the one new crowdVia key.
import { describe, expect, it } from 'vitest';
import { applySeedRound, parseSeedResponse, type SeedMeasure } from '../../src/sources/seedVerify';
import { estimateSeedCount, rankScore, seedStatusLine } from '../../src/sources/seedRank';
import type { SourceResult } from '../../src/sources/types';

const HASH = 'ab'.repeat(20);
const NOW = 1_800_000_000_000;

function row(p: Partial<SourceResult> & { Title: string }): SourceResult {
  return {
    Categories: '',
    Size: '',
    CreateDate: '',
    Tracker: '',
    Link: '',
    Magnet: 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent('udp://tracker.example:6969/announce'),
    Hash: '',
    Peer: 0,
    Seed: 0,
    source: 'rutor',
    ...p,
  };
}

function crowdMeasure(p: Partial<SeedMeasure> = {}): SeedMeasure {
  return {
    infohash: HASH,
    verified: false,
    live: false,
    seeders: 7,
    leechers: 2,
    seedersMax: 0,
    seedersMedian: 0,
    peers: 0,
    dhtSeeds: 0,
    peerEstimate: 0,
    estimate: true,
    samples: 0,
    measuredAt: NOW - 3_600_000,
    source: 'crowd',
    ageMs: 3_600_000,
    ...p,
  };
}

describe('crowd estimate on the row', () => {
  it('parses source crowd and ageMs from the server answer', () => {
    const text = JSON.stringify({ items: [crowdMeasure()] });
    const measures = parseSeedResponse(text) as SeedMeasure[];
    expect(measures[0].source).toBe('crowd');
    expect(measures[0].ageMs).toBe(3_600_000);
  });

  it('applies the counts as an estimate, never live, and keeps the provenance', () => {
    const rows = applySeedRound([row({ Title: 'A', hash: HASH, Seed: 3, Peer: 1 })], [crowdMeasure()], true);
    expect(rows[0]).toMatchObject({
      Seed: 7,
      Peer: 2,
      seedCheck: 'dht',
      dhtEstimate: true,
      seedSource: 'crowd',
      seedAgeMs: 3_600_000,
    });
    expect(rows[0].seedCheck).not.toBe('live');
  });

  it('a fresh crowd zero overwrites the indexer number (a dead torrent)', () => {
    const rows = applySeedRound([row({ Title: 'A', hash: HASH, Seed: 40 })], [crowdMeasure({ seeders: 0, leechers: 0 })], true);
    expect(rows[0].Seed).toBe(0);
    expect(rows[0].seedSource).toBe('crowd');
  });

  it('shows the device provenance with the estimate mark', () => {
    const r = applySeedRound([row({ Title: 'A', hash: HASH })], [crowdMeasure()], true)[0];
    expect(seedStatusLine(r)).toBe('~7 сидов · 2 лича · по данным устройств');
    const noTracker = applySeedRound([row({ Title: 'A', hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH })], [crowdMeasure()], true)[0];
    expect(seedStatusLine(noTracker)).toBe('Нет адреса трекера · ~7 сидов · 2 лича · по данным устройств');
  });

  it('a valid crowd zero keeps the device label, never the DHT formatter', () => {
    const zero = applySeedRound([row({ Title: 'A', hash: HASH, Seed: 40 })], [crowdMeasure({ seeders: 0, leechers: 0 })], true)[0];
    expect(seedStatusLine(zero)).toBe('~0 сидов · 0 личей · по данным устройств');
    // a saved DHT sample must not cover the crowd zero
    const withDht = applySeedRound(
      [row({ Title: 'A', hash: HASH })],
      [crowdMeasure({ seeders: 0, leechers: 0, dhtSeeds: 5, peers: 9 })],
      true,
    )[0];
    expect(seedStatusLine(withDht)).toBe('~0 сидов · 0 личей · по данным устройств');
    const noTracker = applySeedRound(
      [row({ Title: 'A', hash: HASH, Magnet: 'magnet:?xt=urn:btih:' + HASH })],
      [crowdMeasure({ seeders: 0, leechers: 0 })],
      true,
    )[0];
    expect(seedStatusLine(noTracker)).toBe('Нет адреса трекера · ~0 сидов · 0 личей · по данным устройств');
  });

  it('ranks as an estimate: below a verified swarm, above an unchecked row', () => {
    const live = applySeedRound([row({ Title: 'A', hash: HASH })], [crowdMeasure({ verified: true, live: true, seeders: 2, leechers: 0, samples: 1, source: undefined, ageMs: undefined })], true)[0];
    const crowd = applySeedRound([row({ Title: 'A', hash: HASH })], [crowdMeasure({ seeders: 100 })], true)[0];
    const unchecked = row({ Title: 'A', hash: HASH, Seed: 100 });
    expect(estimateSeedCount(crowd)).toBe(100);
    expect(rankScore(live, '', NOW)).toBeGreaterThan(rankScore(crowd, '', NOW));
    expect(rankScore(crowd, '', NOW)).toBeGreaterThan(rankScore(unchecked, '', NOW));
  });
});
