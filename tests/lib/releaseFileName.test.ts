import { describe, expect, it } from 'vitest';
import { commonReleaseTail, parseReleaseFile, shortDeviceName } from '../../src/lib/releaseFileName';

describe('parseReleaseFile', () => {
  it('reads an anime dash number and the release tail', () => {
    expect(parseReleaseFile('Black Clover - 008 RUS JP ENG Judas BDrip HEVC 10bit.mkv')).toEqual({
      season: null,
      episode: 8,
      tail: 'RUS JP ENG Judas BDrip HEVC 10bit',
    });
  });

  it('treats underscores the same as spaces', () => {
    expect(parseReleaseFile('Black_Clover_-_006_RUS_JP_ENG_Judas.mkv')).toEqual({
      season: null,
      episode: 6,
      tail: 'RUS JP ENG Judas',
    });
  });

  it('reads SxxEyy and leaves the quality as the tail', () => {
    expect(parseReleaseFile('Show/Show.S02E03.1080p.WEB-DL.mkv')).toEqual({
      season: 2,
      episode: 3,
      tail: '1080p WEB-DL',
    });
  });

  it('has no episode for a film name', () => {
    expect(parseReleaseFile('Dune.2021.2160p.mkv')).toEqual({ season: null, episode: null, tail: '' });
  });
});

describe('commonReleaseTail', () => {
  it('returns the tail when every episode shares it', () => {
    const paths = [
      'Black Clover - 006 RUS JP ENG Judas BDrip HEVC 10bit.mkv',
      'Black Clover - 008 RUS JP ENG Judas BDrip HEVC 10bit.mkv',
    ];
    expect(commonReleaseTail(paths)).toBe('RUS JP ENG Judas BDrip HEVC 10bit');
  });

  it('stays empty when the files do not share a tail', () => {
    expect(commonReleaseTail([
      'Show - 01 1080p.mkv',
      'Show - 02 720p.mkv',
    ])).toBe('');
  });
});

describe('shortDeviceName', () => {
  it('keeps the brand and the short OLED model', () => {
    expect(shortDeviceName('[LG] webOS TV OLED55C9PLA')).toBe('LG OLED55C9');
  });

  it('leaves a name that already is short', () => {
    expect(shortDeviceName('Гостиная')).toBe('Гостиная');
  });
});
