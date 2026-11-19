import { describe, it, expect, beforeEach } from 'vitest';
import { rememberRawTitle, resetKeptQuality, torrentQuality } from '../../src/lib/keptQuality';
import { ompForReplacement } from '../../src/lib/journal';
import { seasonsOf } from '../../src/lib/seriesGroups';
import { seasonIndex } from '../../src/catalog/library';
import type { Torrent } from '../../src/api/types';

const H = 'a'.repeat(40);

beforeEach(() => resetKeptQuality());

describe('torrentQuality', () => {
  it('keeps the first release title and ignores a later clean name', () => {
    rememberRawTitle(H, 'Loki S02 1080p WEB-DL');
    rememberRawTitle(H, 'Loki');
    expect(torrentQuality({ hash: H, title: 'Loki' })).toBe('1080p');
  });
  it('uses the current title while it still names a resolution', () => {
    expect(torrentQuality({ hash: H, title: 'Loki 2160p' })).toBe('4K');
  });
  it('is empty when nothing names a resolution', () => {
    expect(torrentQuality({ hash: H, title: 'Loki' })).toBe('');
  });
  it('reads a badge and a season from the release string stored on the torrent', () => {
    const raw = 'Show S02 (24 серии из 24) 1080p';
    const data = JSON.stringify({ omp: { v: 1, h: [], rt: raw } });
    const tor: Torrent = { hash: H, title: 'Show', category: 'tv', data, stat: 0 };
    expect(torrentQuality(tor)).toBe('1080p');
    expect(seasonsOf(tor)).toEqual([2]);
    const keys = Array.from(seasonIndex([{ title: 'Show', hash: H, data }]).keys());
    expect(keys.some((k) => k.slice(-2) === '|2')).toBe(true);
  });
  it('a replacement keeps the new release string, not the old one', () => {
    const bag = ompForReplacement({ rt: 'Dune (2021) 1080p WEB-DL', w: false }, { v: 1 }, 'Dune (2021) 2160p WEB-DL');
    expect(bag.rt).toBe('Dune (2021) 2160p WEB-DL');
    expect(bag.w).toBe(false);
  });
});
