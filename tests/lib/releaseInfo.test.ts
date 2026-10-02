import { describe, it, expect } from 'vitest';
import { parseReleaseInfo, releaseBadges, displayBadge } from '../../src/lib/releaseInfo';

const b = (t: string) => releaseBadges(parseReleaseInfo(t));

describe('parseReleaseInfo', () => {
  it('parses real titles', () => {
    expect(b('Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv')).toEqual(['2160p', 'HEVC', 'WEB-DL', '2026']);
    expect(b('Star.Trek.Strange.New.Worlds.S04.1080p.Ru.Ultradox')).toEqual(['1080p']);
    expect(b('Clevatess II Majuu no Ou to Itsuwari no Yuusha Denshou [WEB-DL 1080p]')).toEqual(['1080p', 'WEB-DL']);
    expect(b('Внешняя угроза / The Outer Threat [2026, Канада, США, Триллер, WEB-DLRip-AVC] MVO')).toEqual(['AVC', 'WEBRip', '2026']);
    expect(b('Трудно быть богом / Сезон: 1 [2026, Фантастика, драма, WEBRip 1080p]')).toEqual(['1080p', 'WEBRip', '2026']);
    expect(b('Матрица / The Matrix / 1999-2021 / UHD BDRemux 2160p | 4K | HDR | Dolby Vision Profile 8')).toEqual(['2160p', 'DV', 'Remux', '1999']);
  });
  it('handles other markers', () => {
    expect(b('Movie.2010.4K.HDR10+.HEVC.BluRay')).toEqual(['2160p', 'HDR10+', 'HEVC', 'BluRay', '2010']);
    expect(b('Show.720p.HDTV.x264')).toEqual(['720p', 'AVC', 'HDTV']);
    expect(b('Film.AV1.HDR.WEBRip')).toEqual(['HDR', 'AV1', 'WEBRip']);
    expect(b('Futurama.S14E09.1080p.ColdFilm.mkv')).toEqual(['1080p']);
    expect(b('Просто название')).toEqual([]);
  });
  it('shows 2160p as 4K on cards', () => {
    expect(displayBadge('2160p')).toBe('4K');
    expect(displayBadge('1080p')).toBe('1080p');
  });
});
