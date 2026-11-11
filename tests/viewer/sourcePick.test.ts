import { describe, expect, it } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { deviceCaps, pickBadge, pickDefaultSource, rankViewerSources, speedFit } from '../../src/viewer/sourcePick';
import type { SourceResult } from '../../src/sources/types';

applyLanguageSetting('ru');

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

describe('viewer source rank', () => {
  const phone = { device: deviceCaps('phone'), speedBps: 0, now: NOW };
  const tv = { device: deviceCaps('tv'), speedBps: 0, now: NOW };

  it('prefers a phone-friendly 1080p AVC over a heavier 4K DV with fewer practical seeds', () => {
    const list = [
      row({ Title: 'Film 2020 2160p DV HEVC', Seed: 8, seedCheck: 'live', seedCheckAt: NOW, sizeBytes: 40 * 1024 * 1024 * 1024 }),
      row({ Title: 'Film 2020 1080p AVC', Seed: 6, seedCheck: 'live', seedCheckAt: NOW, sizeBytes: 4 * 1024 * 1024 * 1024 }),
    ];
    const pick = pickDefaultSource(list, 'film', phone);
    expect(pick && pick.row.Title).toContain('1080p');
    expect(pick && pick.reason).toBe('codec');
    expect(pick && pick.badge).toBe('для телефона');
  });

  it('keeps 4K HDR for a TV when the seeds are close', () => {
    const list = [
      row({ Title: 'Film 2020 1080p AVC', Seed: 6, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Film 2020 2160p HDR HEVC', Seed: 8, seedCheck: 'live', seedCheckAt: NOW }),
    ];
    const ranked = rankViewerSources(list, 'film', tv);
    expect(ranked[0].Title).toContain('2160p');
    const pick = pickDefaultSource(list, 'film', tv);
    expect(pick && (pick.reason === 'seeds' || pick.reason === 'codec' || pick.reason === 'quality')).toBe(true);
  });

  it('uses a DHT estimate when the tracker was not checked', () => {
    const list = [
      row({ Title: 'Quiet 1080p', Seed: 0, seedCheck: 'unverified' }),
      row({ Title: 'DHT 1080p AVC', Seed: 0, seedCheck: 'dht', dhtEstimate: true, dhtSeeds: 12 }),
    ];
    const pick = pickDefaultSource(list, 'dht', phone);
    expect(pick && pick.row.Title).toBe('DHT 1080p AVC');
    expect(pick && pick.badge).toBe(pickBadge('dht', phone.device));
  });

  it('penalises a huge file on a slow link and prefers the smaller one', () => {
    const slow = { device: deviceCaps('phone'), speedBps: 200 * 1024, now: NOW };
    const big = 40 * 1024 * 1024 * 1024;
    const small = 2 * 1024 * 1024 * 1024;
    expect(speedFit(big, slow.speedBps)).toBeLessThan(0);
    expect(speedFit(small, slow.speedBps)).toBeGreaterThanOrEqual(0);
    const list = [
      row({ Title: 'Film 1080p', Seed: 10, seedCheck: 'live', seedCheckAt: NOW, sizeBytes: big }),
      row({ Title: 'Film 720p', Seed: 10, seedCheck: 'live', seedCheckAt: NOW, sizeBytes: small }),
    ];
    const pick = pickDefaultSource(list, 'film', slow);
    expect(pick && pick.row.Title).toContain('720p');
    expect(pick && pick.reason).toBe('speed');
  });

  it('does not invent a pick for an empty list', () => {
    expect(pickDefaultSource([], 'q', phone)).toBeNull();
  });

  it('lets a community playback rank beat a locally nicer codec', () => {
    const list = [
      row({ Title: 'Film 2020 1080p AVC', Seed: 40, seedCheck: 'live', seedCheckAt: NOW }),
      row({ Title: 'Film 2020 2160p DV HEVC', Seed: 4, seedCheck: 'live', seedCheckAt: NOW, communityRank: 8000, communityReason: 'community' }),
    ];
    const pick = pickDefaultSource(list, 'film', phone);
    expect(pick && pick.row.Title).toContain('2160p');
  });
});
