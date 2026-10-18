import { describe, it, expect } from 'vitest';
import { parseRelease, applyFilters, sinkUnknownSeasons, sanitizeFilters, NO_FILTERS, activeFilterCount, filterChips, subQualityOf } from '../../src/sources/filters';
import { applyLanguageSetting } from '../../src/i18n';

const GB = 1024 * 1024 * 1024;
const r = (Title: string, Seed = 10, gb = 4) => ({ Title, Seed, sizeBytes: gb * GB });

describe('parseRelease', () => {
  it('reads resolution, HDR and source', () => {
    expect(parseRelease('Северный ветер (2026) WEB-DL 1080p').res).toBe(1080);
    expect(parseRelease('Северный ветер / 2026 / WEB-DLRip').source).toBe('web');
    expect(parseRelease('Северный ветер 2026 2160p HDR10 Dolby Vision').res).toBe(2160);
    expect(parseRelease('Северный ветер 2026 2160p HDR10').hdr).toBe(true);
    expect(parseRelease('Северный ветер 2026 BDRip 720p').source).toBe('bdrip');
    expect(parseRelease('Северный ветер 2026 BDRemux 1080p').source).toBe('remux');
    expect(parseRelease('Северный ветер 2026 4K').res).toBe(2160);
  });
  it('spots camrips', () => {
    expect(parseRelease('Пыльная дорога (2026) CAMRip').cam).toBe(true);
    expect(parseRelease('Пыльная дорога 2026 TS').cam).toBe(true);
    expect(parseRelease('Пыльная дорога 2026 TeleSync').cam).toBe(true);
    expect(parseRelease('Пыльная дорога 2026 WEB-DL').cam).toBe(false);
  });
  it('reads the voice-over and Russian subtitles', () => {
    expect(parseRelease('Кот и космос | Дубляж').dub).toBe(true);
    expect(parseRelease('Кот и космос [D]').dub).toBe(true);
    expect(parseRelease('Кот и космос | MVO').mvo).toBe(true);
    expect(parseRelease('Кот и космос | Многоголосый закадровый').mvo).toBe(true);
    expect(parseRelease('Кот и космос | Оригинал + Sub Rus').original).toBe(true);
    expect(parseRelease('Кот и космос | Оригинал + Sub Rus').rusSubs).toBe(true);
    expect(parseRelease('Кот и космос | Rus Sub').rusSubs).toBe(true);
  });
  it('reads seasons and partial episodes', () => {
    const a = parseRelease('Орбитальная станция / Сезон: 2 / Серии: 1-6 из 10 [2026, WEB-DL 1080p]');
    expect(a.seasons).toEqual([2]);
    expect(a.episodes).toEqual({ from: 1, to: 6, of: 10 });
    expect(parseRelease('Орбитальная станция S02 1080p').seasons).toEqual([2]);
    expect(parseRelease('Орбитальная станция (Сезоны 1-2)').seasons).toEqual([1, 2]);
    expect(parseRelease('Орбитальная станция 2 сезон').seasons).toEqual([2]);
    expect(parseRelease('Орбитальная станция / Серии: 1-10 из 10').episodes).toEqual({ from: 1, to: 10, of: 10 });
  });
  it('reads RU and EN season marks, including packs and episode ranges', () => {
    expect(parseRelease('Орбитальная станция / Сезон: 2 / WEB-DL').seasons).toEqual([2]);
    expect(parseRelease('Орбитальная станция 2 сезон WEB-DL').seasons).toEqual([2]);
    expect(parseRelease('Orbital Station S02 1080p').seasons).toEqual([2]);
    expect(parseRelease('Orbital Station S01-S03 1080p').seasons).toEqual([1, 2, 3]);
    expect(parseRelease('Орбитальная станция / Сезоны 1-3 / WEB-DL').seasons).toEqual([1, 2, 3]);
    expect(parseRelease('Orbital Station S02E01-08 1080p WEB-DL').seasons).toEqual([2]);
    expect(parseRelease('Гангстерленд / MobLand [01x01-10 из 10] (2026) WEB-DL').seasons).toEqual([1]);
    expect(parseRelease('Gangsterland Season 1 1080p').seasons).toEqual([1]);
    expect(parseRelease('Gangsterland Complete Series 1080p').allSeasons).toBe(true);
    expect(parseRelease('Gangsterland Complete Series 1080p').seasons).toEqual([]);
    expect(parseRelease('Гангстерленд (2026) WEB-DL 1080p').seasons).toEqual([]);
  });
});

describe('applyFilters', () => {
  const list = [
    r('Северный ветер (2026) WEB-DL 1080p | Дубляж', 400, 8),
    r('Северный ветер / 2026 / WEB-DLRip', 180, 2),
    r('Северный ветер 2026 2160p HDR | MVO', 60, 21),
    r('Северный ветер 2026 CAMRip', 900, 1.4),
    r('Северный ветер 2026 BDRip 720p', 0, 3),
  ];
  it('no filters keep everything', () => {
    expect(applyFilters(list, NO_FILTERS).length).toBe(5);
  });
  it('resolution: titles without it pass, others must match', () => {
    const out = applyFilters(list, { ...NO_FILTERS, res: [1080] }).map((x) => x.Title);
    expect(out).toEqual(['Северный ветер (2026) WEB-DL 1080p | Дубляж', 'Северный ветер / 2026 / WEB-DLRip', 'Северный ветер 2026 CAMRip']);
  });
  it('hide camrips, minimum seeds, size range', () => {
    expect(applyFilters(list, { ...NO_FILTERS, hideCam: true }).length).toBe(4);
    expect(applyFilters(list, { ...NO_FILTERS, minSeeds: 1 }).length).toBe(4);
    expect(applyFilters(list, { ...NO_FILTERS, minGb: 2.5, maxGb: 10 }).map((x) => x.Seed)).toEqual([400, 0]);
  });
  it('voice: titles that say nothing pass', () => {
    const out = applyFilters(list, { ...NO_FILTERS, voice: ['dub'] }).map((x) => x.Seed);
    expect(out).toEqual([400, 180, 900, 0]);
  });
  it('season and full season', () => {
    const s = [r('Орбитальная станция / Сезон: 2 / Серии: 1-6 из 10'), r('Орбитальная станция / Сезон: 2 / Серии: 1-10 из 10'), r('Орбитальная станция / Сезон: 1')];
    expect(applyFilters(s, { ...NO_FILTERS, season: 2 }).length).toBe(2);
    expect(applyFilters(s, { ...NO_FILTERS, season: 2, fullSeason: true }).length).toBe(1);
  });
  it('a chosen season drops other seasons from every source title, and the count is what remains', () => {
    const s = [
      r('Гангстерленд / MobLand [01x01-10 из 10] (2026) WEB-DL 1080p JacRed', 198),
      r('Гангстерленд (сезон 1, серии 1-10 из 10) WEB-DL', 168),
      r('Gangsterland Season 1 1080p WEB-DL', 40),
      r('Gangsterland S01 1080p', 12),
      r('Гангстерленд / Сезон: 2 / Серии: 1-3 из 10 WEB-DL', 80),
      r('Gangsterland S02E01-08 1080p WEB-DL', 70),
      r('Gangsterland S01-S03 Complete 1080p', 60),
      r('Гангстерленд / Сезоны 1-3 WEB-DL', 55),
      r('Гангстерленд 1-3 сезоны WEB-DL', 54),
      r('Gangsterland Complete series 1080p', 11),
      r('Гангстерленд (2026) WEB-DL 1080p', 400),
    ];
    const out = applyFilters(s, { ...NO_FILTERS, season: 2 });
    expect(out.map((x) => x.Title)).toEqual([
      'Гангстерленд / Сезон: 2 / Серии: 1-3 из 10 WEB-DL',
      'Gangsterland S02E01-08 1080p WEB-DL',
      'Gangsterland S01-S03 Complete 1080p',
      'Гангстерленд / Сезоны 1-3 WEB-DL',
      'Гангстерленд 1-3 сезоны WEB-DL',
      'Gangsterland Complete series 1080p',
      'Гангстерленд (2026) WEB-DL 1080p',
    ]);
    const shown = sinkUnknownSeasons(out, 2);
    expect(shown.map((x) => x.Seed)).toEqual([80, 70, 60, 55, 54, 11, 400]);
    expect(shown[shown.length - 1].Title).toBe('Гангстерленд (2026) WEB-DL 1080p');
  });
});

describe('filter state', () => {
  it('sanitizes junk to no filters and counts active groups', () => {
    expect(sanitizeFilters({ res: [999, 1080], minSeeds: -3, voice: ['x'], season: 'a' })).toEqual({ ...NO_FILTERS, res: [1080] });
    const f = { ...NO_FILTERS, res: [1080] as (720 | 1080 | 2160)[], minSeeds: 5, voice: ['dub'] as ('dub' | 'mvo' | 'original')[] };
    expect(activeFilterCount(f)).toBe(3);
    expect(filterChips(f)).toEqual(['1080p', 'сиды ≥ 5', 'дубляж']);
  });
  it('labels the chips in English', () => {
    applyLanguageSetting('en');
    const f = { ...NO_FILTERS, hideCam: true, minGb: 2, maxGb: 10, minSeeds: 5, voice: ['dub', 'mvo'] as ('dub' | 'mvo' | 'original')[], rusSubs: true, season: 2, fullSeason: true };
    expect(filterChips(f)).toEqual(['no camrips', 'from 2 to 10 GB', 'seeds ≥ 5', 'dub, multi-voice', 'Rus subs', 'season 2', 'full season']);
  });
  it('maps the quality group to a subscription quality', () => {
    expect(subQualityOf(NO_FILTERS)).toBe('');
    expect(subQualityOf({ ...NO_FILTERS, res: [1080, 2160] })).toBe('1080');
    expect(subQualityOf({ ...NO_FILTERS, res: [2160] })).toBe('2160');
    expect(subQualityOf({ ...NO_FILTERS, res: [720] })).toBe('720');
  });
});
