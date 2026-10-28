// Film grouping in «Мои» with the real titles of a home TorrServer (S21 report, 28.10.2026): different films of the same
// year in the «Имя / Name / 2026 / ДБ / 4K ... / Blu-Ray Remux» format were one card through the «2026» and
// «Blu-Ray Remux» parts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Torrent } from '../../src/api/types';

const tmdb = vi.hoisted(() => new Map<string, number>());
vi.mock('../../src/lib/useMovieCard', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/useMovieCard')>()),
  cachedMovieId: (hash: string) => tmdb.get(hash) || 0,
}));

import { filmKeys, isTechPart, sameReleases } from '../src/lib/duplicates';
import { filmReleases, groupPhoneLibrary } from '../src/lib/filmGroups';

const mk = (hash: string, title: string, category = 'movie'): Torrent => ({ hash, title, category, stat: 3, torrent_size: 1, timestamp: 1 });

const SUPERGIRL = mk('2a7cfe04', 'Супергерл / Supergirl / 2026 / ДБ, СТ / 4K, HEVC, HDR, HDR10+, Dolby Vision P7 / Blu-Ray Remux (2160p) | Movie Dubbing | Дубляж | [Movie Dubbing Дубляж].rus');
const SIGNAL = mk('0e9eb8e4', 'Звездный сигнал / Signal One / 2026 / ДБ / 4K, HEVC, SDR / WEB-DL (2160p) | Дубляж | Велес | [Дубляж Велес].rus');
const MINIONS = mk('7021f757', 'Миньоны и монстры / Minions & Monsters / 2026 / 4 x ДБ, ПМ, СТ / 4K, HEVC, HDR, Dolby Vision P7 / Blu-Ray Remux (2160p) | Продубляж | TVShows | WinMedia | HDRezka | LeDoyen | Дубляж | [Продубляж TVShows WinMedia HDRezka LeDoyen Дубляж].rus');
const HAIL_MARY = mk('29fbcd64', 'Проект «Конец света» / Project Hail Mary (IMAX) / 2026 / ДБ, 3 x ПМ, ЛМ, АП (Сербин), СТ / 4K, HEVC, HDR, HDR10+, DV P8 / Blu-Ray Remux (2160p) | Дубляж | MovieDalen | AlexFilm | Jaskier | LostFilm | Дубляжная | Ю. Сербин | [Дубляж MovieDalen AlexFilm Jaskier LostFilm Дубляжная Ю. Сербин].rus');
const BONE_1 = mk('7b5f3e8e', '28 лет спустя: Часть II. Храм костей / 28 Years Later: The Bone Temple (2026) WEB-DL-HEVC 2160p | 4K | HDR | Dolby Vision Profile 8 | D, P, L, A');
const BONE_2 = mk('6102c0d0', '28 лет спустя: Часть II. Храм костей / 28 Years Later: The Bone Temple (2026) UHD Blu-Ray Remux 2160p | 4K | HDR | Dolby Vision P7 | D');
const BONE_3 = mk('2cbe9a2e', '28 лет спустя: Часть II. Храм костей / 28 Years Later: The Bone Temple (2026) UHD WEB-DL-HEVC 2160p | 4K | HDR | HDR10+ | DV P8 | D, P, L, A');
const DUNE_1 = mk('9c1cf8aa', 'Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRemux 2160p | 4K | HDR10 | Dolby Vision | D, P, A');
const DUNE_2 = mk('ee21944b', 'Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRemux 2160p | 4K | HDR10 | Dolby Vision | D, P, A');
const DISCLOSURE = mk('34cf7215', 'День разоблачения / Disclosure Day (2026) UHD BDRemux 2160p | 4K | HDR10 | Dolby Vision P7 | D-Продубляж');
const UNDONE_1 = mk('7f324da3', 'Отмена (1 сезон: 1-8 серии из 8) / Undone / 2019 / ЛМ (NewStation) / WEB-DLRip | NewStation | [NewStation].rus', 'tv');
const UNDONE_2 = mk('d33630f4', 'Отмена (1 сезон: 1-8 серии из 8) / Undone / 2019 / ПМ (TVShows) / WEB-DL (1080p) | TVShows | [TVShows].rus', 'tv');
const STUART_1 = mk('b13bdced', 'Стюарт Блум не смог спасти вселенную / Stuart Fails to Save the Universe (2026) WEB-DL [H.265/2160p] [4K, HDR10, DV 8.1, 10-bit] (сезон 1, серии 1-10 из 10) Кураж Бамбей, Syncmer, LostFilm, TVShows | [Кураж-Бамбей Syncmer LostFilm TVShows].rus', 'tv');
const STUART_2 = mk('b3eed8f5', 'Стюарт Блум не смог спасти вселенную (1 сезон: 1-10 серии из 10) / Stuart Fails to Save the Universe / 2026 / ПМ, ПО (Кураж-Бамбей) / WEB-DL (1080p) | Кураж-Бамбей | LostFilm | [Кураж-Бамбей LostFilm].rus', 'tv');
const STUART_3 = mk('984637ad', 'Стюарт Блум не смог спасти вселенную (1-10 серии из 10) / Stuart Fails to Save the Universe / 2026 / ПМ, ПД, ПО, СТ / 4K, HDR, DV P8 / WEB-DL (2160p)', 'tv');

const LIBRARY = [BONE_1, BONE_2, BONE_3, SIGNAL, MINIONS, SUPERGIRL, STUART_1, STUART_2, DISCLOSURE, UNDONE_1, UNDONE_2, DUNE_1, STUART_3, DUNE_2, HAIL_MARY];

beforeEach(() => tmdb.clear());

describe('filmKeys: only the names before the year, never tags', () => {
  it('the slash format keeps the two names and drops the year, translation and video parts', () => {
    expect(filmKeys(SUPERGIRL)).toEqual(['супергерл|2026', 'supergirl|2026']);
    expect(filmKeys(SIGNAL)).toEqual(['звездный сигнал|2026', 'signal one|2026']);
    expect(filmKeys(MINIONS)).toEqual(['миньоны и монстры|2026', 'minions monsters|2026']);
    expect(filmKeys(HAIL_MARY)).toEqual(['проект конец света|2026', 'project hail mary|2026']);
    expect(filmKeys(BONE_1)).toEqual(['28 лет спустя часть ii храм костей|2026', '28 years later the bone temple|2026']);
  });

  it('tag parts and season ranges are not names; a number is a name only first', () => {
    for (const p of ['2026', 'ДБ, СТ', '4 x ДБ, ПМ, СТ', '4K, HEVC, HDR, HDR10+, Dolby Vision P7', 'Blu-Ray Remux', 'WEB-DL', 'ЛМ', 'Сезон: 5', 'Серии: 1-22 из 22', 'S4E1-8 of 8']) {
      expect(isTechPart(p), p).toBe(true);
    }
    for (const p of ['Supergirl', 'Миньоны и монстры', 'Project Hail Mary', 'Dune: Part Two']) expect(isTechPart(p), p).toBe(false);
    expect(filmKeys(mk('n1', '1917 / 1917 (2019) BDRip 1080p'))).toEqual(['1917|2019']);
    expect(filmKeys(mk('n2', '2012 (2009) BDRip 1080p'))).toEqual(['2012|2009']);
  });

  it('the first part is the film name even when it looks like a tag; a season or episode word needs a number', () => {
    expect(filmKeys(mk('c1', 'Cam (2018) BDRip 1080p'))).toEqual(['cam|2018']);
    for (const p of ['Season of the Witch', 'Episode One', 'Сезон охоты']) expect(isTechPart(p), p).toBe(false);
    // two releases of «Cam» are still one card
    const cams = [mk('c4', 'Cam (2018) BDRip 1080p'), mk('c5', 'Cam (2018) WEB-DL 2160p')];
    expect(filmReleases(cams, cams[0]).map((x) => x.hash)).toEqual(['c4', 'c5']);
  });
});

describe('«Мои» film cards with the real library', () => {
  it('Supergirl, Signal One and Minions & Monsters are three cards; 28 Years Later x3 and Dune x2 stay one card each', () => {
    const items = groupPhoneLibrary(LIBRARY);
    const films = items.filter((x) => x.kind === 'film').map((x) => (x.kind === 'film' ? x.members.map((m) => m.hash).sort() : []));
    expect(films).toEqual([[BONE_1.hash, BONE_2.hash, BONE_3.hash].sort(), [DUNE_1.hash, DUNE_2.hash].sort()]);
    for (const lone of [SUPERGIRL, SIGNAL, MINIONS, HAIL_MARY, DISCLOSURE]) {
      expect(items.some((x) => x.kind === 'torrent' && x.tor.hash === lone.hash), lone.title.slice(0, 20)).toBe(true);
    }
    expect(filmReleases(LIBRARY, SUPERGIRL).map((x) => x.hash)).toEqual([SUPERGIRL.hash]);
    expect(filmReleases(LIBRARY, BONE_2).length).toBe(3);
  });

  it('the series Отмена and Стюарт Блум are still one series card each', () => {
    const series = groupPhoneLibrary(LIBRARY).filter((x) => x.kind === 'series');
    const names = series.map((x) => (x.kind === 'series' ? x.members.length : 0)).sort();
    expect(names).toEqual([2, 3]);
  });

  it('«Такая раздача уже есть» no longer names another film', () => {
    expect(sameReleases([SIGNAL, MINIONS, HAIL_MARY], SUPERGIRL)).toEqual([]);
    expect(sameReleases([BONE_1, SUPERGIRL], BONE_3)).toEqual([BONE_1]);
  });

  it('two releases matched to different TMDB films are never one card, even when a name key is shared', () => {
    const A = mk('t1', 'Дюна / Dune (2021) BDRip 1080p');
    const B = mk('t2', 'Dune (2021) 2160p WEB-DL');
    const C = mk('t3', 'Дюна / Dune (2021) WEB-DL 720p');
    expect(filmReleases([A, B, C], A).length).toBe(3);
    tmdb.set('t1', 438631);
    tmdb.set('t2', 999999);
    expect(filmReleases([A, B, C], A).map((x) => x.hash)).toEqual(['t1', 't3']);
    expect(filmReleases([A, B, C], B).map((x) => x.hash)).toEqual(['t2']);
    // A is another TMDB film; C is not matched yet, so its name still counts
    expect(sameReleases([A, C], B)).toEqual([C]);
    expect(sameReleases([B, C], A)).toEqual([C]);
  });
});
