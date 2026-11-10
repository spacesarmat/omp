import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/state.mjs';
import { mergeSettings } from '../src/services.mjs';
import {
  applyVote,
  blendScore,
  coldScore,
  deviceFit,
  learnedScore,
  parseFeed,
  parseSignalBody,
  releasesToWarm,
  removeDelta,
  renderFeed,
  scoreOf,
  titleKeyOf,
  voteDelta,
  voterHash,
  watchRankEnabled,
} from '../src/watchRank.mjs';
import { chooseBests } from '../src/watchFollow.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function item(title: string, hash: string, seeds: string) {
  return (
    '<item><title>' +
    title +
    '</title><torznab:attr name="seeders" value="' +
    seeds +
    '"/><torznab:attr name="infohash" value="' +
    hash +
    '"/></item>'
  );
}

function feed(items: string) {
  return '<?xml version="1.0"?><rss><channel>' + items + '</channel></rss>';
}

describe('watch rank score', () => {
  it('is on unless an admin turns it off', () => {
    expect(watchRankEnabled(emptyState().settings)).toBe(true);
    expect(watchRankEnabled({ watchRankEnabled: false })).toBe(false);
    expect(mergeSettings(emptyState().settings, { watchRankEnabled: 'false' }).watchRankEnabled).toBe(false);
    expect(mergeSettings(emptyState().settings, {}).watchRankEnabled).toBe(true);
  });

  it('uses seeds until samples exist, then blends toward what played', () => {
    expect(coldScore(0, 0)).toBe(0);
    expect(coldScore(100, 0)).toBeGreaterThan(coldScore(10, 0));
    expect(coldScore(0, 50)).toBeGreaterThan(0);
    expect(coldScore(0, 50)).toBeLessThan(coldScore(50, 0));
    const learned = learnedScore(
      { samples: 10, completed: 8, switched: 1, ttffMs: 8000, rebufferN: 2, rebufferMs: 1000, watchedSum: 800, codecOk: 9, codecFail: 1 },
      'tv',
      'Show S01E01 2160p HDR HEVC',
    );
    expect(learned).not.toBeNull();
    expect(blendScore(learned, 20, 0)).toBe(20);
    const mid = blendScore(learned, 20, 8);
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(learned as number);
    expect(blendScore(learned, 20, 80)).toBeGreaterThan(mid);
  });

  it('prefers 4K on a TV that plays it and 1080p on a phone', () => {
    const tv4 = deviceFit('Film 2160p HDR HEVC', 'tv', 0.9);
    const tv1080 = deviceFit('Film 1080p', 'tv', 0.9);
    const phone4 = deviceFit('Film 2160p HDR HEVC', 'phone', 0.2);
    const phone1080 = deviceFit('Film 1080p', 'phone', 0.9);
    expect(tv4).toBeGreaterThan(tv1080);
    expect(phone1080).toBeGreaterThan(phone4);
    expect(deviceFit('Film 2160p HDR', 'tv', 0.2)).toBeLessThan(0);
  });

  it('counts one vote per account and device, and a repeat replaces it', () => {
    expect(voterHash('acc', 'dev')).toHaveLength(64);
    expect(voterHash('acc', 'dev')).toBe(voterHash('acc', 'dev'));
    expect(voterHash('acc', 'other')).not.toBe(voterHash('acc', 'dev'));
    expect(voterHash('', 'dev')).toBe('');
    const first = { completed: true, switched: false, ttffMs: 1000, rebufferN: 0, rebufferMs: 0, watchedPct: 90, codecOk: true };
    const again = { completed: false, switched: true, ttffMs: 4000, rebufferN: 2, rebufferMs: 500, watchedPct: 20, codecOk: false };
    const once = applyVote(null, null, first);
    expect(once.samples).toBe(1);
    expect(once.completed).toBe(1);
    const replaced = applyVote(once, first, again);
    expect(replaced.samples).toBe(1);
    expect(replaced.completed).toBe(0);
    expect(replaced.switched).toBe(1);
    expect(replaced.codecOk).toBe(0);
    expect(replaced.codecFail).toBe(1);
    expect(voteDelta(first, again).samples).toBe(0);
    expect(removeDelta(again).samples).toBe(-1);
  });

  it('leaves a cold feed unchanged, ranks a learned row first, and drops a ban', () => {
    const xml = feed(item('Slow', A, '10') + item('Fast', B, '2'));
    const cold = renderFeed(parseFeed(xml), { stats: {}, mods: {}, voices: {}, deviceClass: 'tv' });
    expect(cold.changed).toBe(false);
    expect(cold.xml).toBe(xml);
    const learned = renderFeed(parseFeed(xml), {
      stats: {
        [B]: { samples: 4, completed: 4, switched: 0, ttffMs: 2000, rebufferN: 0, rebufferMs: 0, watchedSum: 400, codecOk: 4, codecFail: 0 },
      },
      mods: {},
      voices: { show: 'LostFilm' },
      deviceClass: 'tv',
    });
    expect(learned.changed).toBe(true);
    expect(learned.xml.indexOf(B)).toBeLessThan(learned.xml.indexOf(A));
    expect(learned.xml).toContain('omp_reason" value="community"');
    const pinned = scoreOf(null, 10, 'phone', 'x', { pinned: true, banned: false });
    expect(pinned.reason).toBe('pinned');
    expect(pinned.rank).toBeGreaterThan(100000);
    const banned = renderFeed(parseFeed(xml), {
      stats: {},
      mods: { [A]: { pinned: false, banned: true } },
      voices: {},
      deviceClass: 'phone',
    });
    expect(banned.xml).not.toContain(A);
    expect(banned.xml).toContain(B);
  });

  it('rejects an oversized batch and stores nothing when help is off', () => {
    const off = parseSignalBody({ help: '0', items: [{ infohash: A }] });
    expect(off.ok).toBe(true);
    expect(off.help).toBe(false);
    const items = [];
    for (let i = 0; i < 21; i++) items.push({ infohash: A });
    expect(parseSignalBody({ items }).ok).toBe(false);
    const parsed = parseSignalBody({
      payload: JSON.stringify({
        deviceClass: 'tv',
        codecs: 'h264,hevc,nope',
        items: [{ infohash: A, file: 2, title: 'Show S01E03 1080p', watchedPct: 40, ttffMs: 1500, voice: 'LostFilm', codecOk: true }],
      }),
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].deviceClass).toBe('tv');
    expect(parsed.items[0].episode).toBe(3);
    expect(parsed.items[0].codecs).toEqual(['h264', 'hevc']);
    expect(parsed.items[0].follow).toBe(true);
    expect(titleKeyOf('Show S01E01 1080p WEB-DL', '')).toBe(titleKeyOf('Show S01E02 720p BluRay', ''));
    const bad = renderFeed(parseFeed(feed(item('Bad', A, '1') + item('Healthy', B, '200'))), {
      stats: {
        [A]: { samples: 1, completed: 0, switched: 1, ttffMs: 20000, rebufferN: 5, rebufferMs: 8000, watchedSum: 5, codecOk: 0, codecFail: 1 },
      },
      mods: {},
      voices: {},
      deviceClass: 'tv',
    });
    expect(bad.xml.indexOf(B)).toBeLessThan(bad.xml.indexOf(A));
    expect(releasesToWarm([{ infohash: A, seeds: 0, title: 'x' }, { infohash: B, seeds: 4, title: 'Y' }])).toEqual([
      { infohash: B, title: 'Y', seeds: 4, sizeBytes: 0 },
    ]);
  });

  it('picks a per-episode best and lets a pin win', () => {
    const best = chooseBests(
      {
        stats: [
          { infohash: A, title: 'Show S01E02 1080p', season: 1, episode: 2, samples: 5, completed: 1, switched: 3, ttffMs: 20000, rebufferN: 10, rebufferMs: 9000, watchedSum: 100, codecOk: 1, codecFail: 4 },
          { infohash: B, title: 'Show S01E02 2160p HDR', season: 1, episode: 2, samples: 5, completed: 5, switched: 0, ttffMs: 4000, rebufferN: 0, rebufferMs: 0, watchedSum: 450, codecOk: 5, codecFail: 0 },
        ],
        seen: [
          { infohash: A, seeds: 100, dhtSeeds: 0, sizeBytes: 1 },
          { infohash: B, seeds: 20, dhtSeeds: 0, sizeBytes: 2 },
        ],
        mods: {},
      },
      'tv',
      'LostFilm',
      { season: 1, episode: 2 },
    );
    const row = best.find((x) => x.episode === 2);
    expect(row && row.infohash).toBe(B);
    expect(row && row.voice).toBe('LostFilm');
    const pinned = chooseBests(
      {
        stats: [],
        seen: [
          { infohash: A, title: 'A', season: 1, episode: 1, seeds: 50, dhtSeeds: 0, sizeBytes: 1 },
          { infohash: B, title: 'B', season: 1, episode: 1, seeds: 1, dhtSeeds: 0, sizeBytes: 1 },
        ],
        mods: { [B]: { pinned: true, banned: false } },
      },
      'phone',
      '',
      { season: 1, episode: 1 },
    );
    expect(pinned[0].infohash).toBe(B);
    expect(pinned[0].reason).toBe('pinned');
  });

  it('keeps every episode of one season pack', () => {
    const best = chooseBests(
      {
        stats: [
          { infohash: A, title: 'Pack', season: 1, episode: 1, samples: 4, completed: 0, switched: 3, ttffMs: 20000, rebufferN: 8, rebufferMs: 9000, watchedSum: 40, codecOk: 0, codecFail: 4 },
          { infohash: A, title: 'Pack', season: 1, episode: 2, samples: 4, completed: 4, switched: 0, ttffMs: 3000, rebufferN: 0, rebufferMs: 0, watchedSum: 380, codecOk: 4, codecFail: 0 },
        ],
        seen: [
          { infohash: A, title: 'Pack', season: 1, episode: 1, seeds: 10, dhtSeeds: 0, sizeBytes: 1 },
          { infohash: A, title: 'Pack', season: 1, episode: 2, seeds: 10, dhtSeeds: 0, sizeBytes: 1 },
        ],
        mods: {},
      },
      'tv',
      '',
      { season: 1, episode: 2 },
    );
    const e1 = best.find((x) => x.episode === 1);
    const e2 = best.find((x) => x.episode === 2);
    expect(e1 && e1.infohash).toBe(A);
    expect(e2 && e2.infohash).toBe(A);
    expect(e2 && e2.score).toBeGreaterThan(e1 ? e1.score : 0);
  });
});
