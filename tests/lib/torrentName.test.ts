import { describe, it, expect } from 'vitest';
import { isPlaceholderTitle, deriveName, displayTitle, torrentFiles } from '../../src/lib/torrentName';

const HEX = '8bae2398df95c853c6329816fc828f79dd947c1f';
const f = (path: string, id = 1) => ({ id, path, length: 1000 });

describe('isPlaceholderTitle', () => {
  it('detects infohash:, bare hashes and empty titles', () => {
    expect(isPlaceholderTitle('infohash:' + HEX)).toBe(true);
    expect(isPlaceholderTitle('INFOHASH:' + HEX.toUpperCase())).toBe(true);
    expect(isPlaceholderTitle(HEX)).toBe(true);
    expect(isPlaceholderTitle('MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U')).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('   ')).toBe(true);
    expect(isPlaceholderTitle(undefined)).toBe(true);
  });
  it('catches a title equal to the torrent hash', () => {
    expect(isPlaceholderTitle('abc', 'ABC')).toBe(true);
    expect(isPlaceholderTitle('infohash:abc', 'abc')).toBe(true);
  });
  it('keeps real titles', () => {
    expect(isPlaceholderTitle('Moon Garden S01 1080p')).toBe(false);
    expect(isPlaceholderTitle('infohash')).toBe(false);
    expect(isPlaceholderTitle(HEX + '0')).toBe(false);
  });
});

describe('deriveName', () => {
  it('names a series with its season', () => {
    const files = [1, 2, 3].map((n) => f('Moon.Garden.S13E0' + n + '.1080p.WEBRip.SomeGroup.mkv', n));
    expect(deriveName(files, 'x')).toBe('Moon Garden · Сезон 13');
  });
  it('names several seasons as a range', () => {
    const files = [f('Moon.Garden.S01E01.720p.mkv', 1), f('Moon.Garden.S03E02.720p.mkv', 2), f('Moon.Garden.S02E01.720p.mkv', 3)];
    expect(deriveName(files, 'x')).toBe('Moon Garden · Сезоны 1–3');
  });
  it('uses the release folder for numbered episodes in season folders', () => {
    const files = [f('Silver Lake/Season 2/01 - Pilot.mkv', 1), f('Silver Lake/Season 2/02 - Next.mkv', 2)];
    expect(deriveName(files, 'x')).toBe('Silver Lake · Сезон 2');
  });
  it('cleans a single movie and adds the year', () => {
    expect(deriveName([f('Paper.Boats.2019.2160p.BluRay.x265-GRP.mkv')], 'x')).toBe('Paper Boats (2019)');
    expect(deriveName([f('Paper Boats.mkv')], 'x')).toBe('Paper Boats');
  });
  it('ignores subtitles and falls back when nothing is playable', () => {
    expect(deriveName([f('a.srt')], 'fb')).toBe('fb');
    expect(deriveName([], 'fb')).toBe('fb');
    expect(deriveName(undefined, 'fb')).toBe('fb');
  });
});

describe('displayTitle', () => {
  const data = JSON.stringify({ TorrServer: { Files: [1, 2].map((n) => f('Moon.Garden.S02E0' + n + '.1080p.mkv', n)) } });
  it('derives the name for a placeholder from stored data', () => {
    expect(displayTitle({ hash: HEX, title: 'infohash:' + HEX, data })).toBe('Moon Garden · Сезон 2');
  });
  it('prefers live file stats and falls back to name, then to the title', () => {
    expect(displayTitle({ hash: HEX, title: '', file_stats: [f('Paper.Boats.2019.mkv')] })).toBe('Paper Boats (2019)');
    expect(displayTitle({ hash: HEX, title: 'infohash:' + HEX, name: 'Some Release' })).toBe('Some Release');
    expect(displayTitle({ hash: HEX, title: 'infohash:' + HEX })).toBe('infohash:' + HEX);
  });
  it('never replaces a real title', () => {
    expect(displayTitle({ hash: HEX, title: 'My Own Name', data })).toBe('My Own Name');
  });
  it('reads files from data safely', () => {
    expect(torrentFiles({ hash: 'h', data: 'garbage' })).toEqual([]);
    expect(torrentFiles({ hash: 'h', data: '{}' })).toEqual([]);
  });
});
