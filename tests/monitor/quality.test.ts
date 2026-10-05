import { describe, it, expect } from 'vitest';
import { isBetter, qualityLabel, qualityRank } from '../../src/monitor/quality';

const T = (q: string) => 'Северный ветер (2026) ' + q;

describe('qualityRank', () => {
  it('orders the resolution first, then the source', () => {
    expect(qualityRank(T('CAMRip'))).toBe(0);
    expect(qualityRank(T(''))).toBe(1);
    expect(qualityRank(T('WEB-DL 720p'))).toBe(12);
    expect(qualityRank(T('TS 1080p'))).toBe(20);
    expect(qualityRank(T('1080p'))).toBe(21);
    expect(qualityRank(T('WEBRip 1080p'))).toBe(22);
    expect(qualityRank(T('BDRip 1080p'))).toBe(23);
    expect(qualityRank(T('HDRip 1080p'))).toBe(23);
    expect(qualityRank(T('BDRemux 1080p'))).toBe(24);
    expect(qualityRank(T('2160p WEB-DL HDR'))).toBe(32);
    expect(qualityRank(T('2160p Remux'))).toBe(34);
  });
});

describe('isBetter', () => {
  it('known resolutions: the higher one, then the better source', () => {
    expect(isBetter(T('2160p WEB-DL'), T('WEB-DL 1080p'))).toBe(true);
    expect(isBetter(T('BDRip 1080p'), T('WEB-DL 1080p'))).toBe(true);
    expect(isBetter(T('BDRemux 1080p'), T('BDRip 1080p'))).toBe(true);
    expect(isBetter(T('WEB-DL 1080p'), T('WEBRip 1080p'))).toBe(false);
    expect(isBetter(T('2160p Remux'), T('2160p Remux'))).toBe(false);
    expect(isBetter(T('WEB-DL 720p'), T('CAMRip 1080p'))).toBe(false);
  });

  it('a non-camrip beats a camrip of the same resolution, never the other way round', () => {
    expect(isBetter(T('1080p'), T('CAMRip 1080p'))).toBe(true);
    expect(isBetter(T('TS 1080p'), T('1080p'))).toBe(false);
  });

  it('both resolutions unknown: only the source decides', () => {
    expect(isBetter(T('WEB-DL'), T('CAMRip'))).toBe(true);
    expect(isBetter(T('Remux'), T('BDRip'))).toBe(true);
    expect(isBetter(T('DVDRip'), T('WEB-DL'))).toBe(false);
  });

  it('one resolution unknown: a known one wins only over an unknown-resolution camrip', () => {
    expect(isBetter(T('WEB-DL 1080p'), T('CAMRip'))).toBe(true);
    expect(isBetter(T('WEB-DL 1080p'), T('BDRip'))).toBe(false);
    expect(isBetter(T('TS 1080p'), T('CAMRip'))).toBe(false);
    expect(isBetter(T('Remux'), T('WEB-DL 720p'))).toBe(false);
    expect(isBetter(T('WEB-DL'), T('CAMRip 720p'))).toBe(false);
  });
});

describe('qualityLabel', () => {
  it('resolution and source as the user reads them', () => {
    expect(qualityLabel(T('WEB-DL 1080p'))).toBe('1080p WEB-DL');
    expect(qualityLabel(T('WEBRip 720p'))).toBe('720p WEB-DL');
    expect(qualityLabel(T('2160p BDRemux HDR'))).toBe('4K Remux');
    expect(qualityLabel(T('BluRay'))).toBe('BDRip');
    expect(qualityLabel(T('CAMRip'))).toBe('CAMRip');
    expect(qualityLabel(T('TS 1080p'))).toBe('1080p CAMRip');
    expect(qualityLabel(T(''))).toBe('');
  });
});
