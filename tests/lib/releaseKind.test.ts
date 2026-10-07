import { describe, it, expect, afterEach } from 'vitest';
import { categoryKind, filterByKind, getKindFilter, releaseKind, setKindFilter } from '../../src/lib/releaseKind';
import { kindFilterOptions, kindLabel, resultKindLabel } from '../../src/sources/releaseRow';

const k = (Title: string, Categories = '') => releaseKind({ Title, Categories });
const kind = (Title: string, Categories = '') => k(Title, Categories).kind;

describe('releaseKind: titles', () => {
  it('a film: a year and no series marks', () => {
    expect(k('Джентльмены / The Gentlemen (2019)')).toEqual({ kind: 'movie', year: 2019, by: 'title' });
    expect(kind('Джентльмены / The Gentlemen (2019) BDRip 1080p от HDReactor | Лицензия')).toBe('movie');
    expect(kind('Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 2160p | HDR | Dolby Vision | Дубляж')).toBe('movie');
    expect(kind('Терминатор 2: Судный день / Terminator 2: Judgment Day [1991, США, фантастика, BDRemux 1080p]')).toBe('movie');
    expect(kind('Матрица / The Matrix / 1999 / ДБ, ПМ, АП (Гаврилов) / BDRip (1080p)')).toBe('movie');
    expect(kind('Oppenheimer.2023.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FGT')).toBe('movie');
    expect(kind('1917 (2019) BDRip 1080p')).toBe('movie');
    expect(kind('Kill.Bill.Vol.1.2003.1080p.BluRay.x264')).toBe('movie');
    expect(kind('Иван Васильевич меняет профессию (1973) BDRip-AVC')).toBe('movie');
  });

  it('a series: the RuTracker way', () => {
    expect(k('Джентльмены / The Gentlemen / Сезон: 1 / Серии: 1-8 из 8 (Гай Ричи) [2024, WEB-DL 1080p]')).toEqual({
      kind: 'series',
      season: 1,
      episodes: { from: 1, to: 8, total: 8 },
      year: 2024,
      by: 'title',
    });
    const r = k('Пацаны / The Boys / Сезон: 4 / Серии: 1-3 из 8 (Филип Сгриччиа) [2024, США, WEB-DLRip] MVO (LostFilm)');
    expect(r.kind).toBe('series');
    expect(r.season).toBe(4);
    expect(r.episodes).toEqual({ from: 1, to: 3, total: 8 });
    const pack = k('Шерлок / Sherlock / Сезон: 1-4 / Серии: 1-13 из 13 [2010-2017, Великобритания, BDRip 1080p]');
    expect(pack.kind).toBe('series');
    expect(pack.season).toEqual([1, 4]);
  });

  it('a series: scene names', () => {
    const r = k('The.Gentlemen.S02.2160p.NF.WEB-DL.DDP5.1.HDR.H.265-FLUX');
    expect(r.kind).toBe('series');
    expect(r.season).toBe(2);
    expect(r.episodes).toBeUndefined();
    const ep = k('The.Last.of.Us.S01E01-08.1080p.WEB-DL');
    expect(ep.season).toBe(1);
    expect(ep.episodes).toEqual({ from: 1, to: 8 });
    expect(k('Severance.S02E05.1080p.ATVP.WEB-DL').episodes).toEqual({ from: 5, to: 5 });
    expect(kind('Breaking Bad Season 1 Complete 720p')).toBe('series');
    expect(kind('Friends.The.Complete.Series.1080p.BluRay.x265')).toBe('series');
  });

  it('a series: Kinozal and rutor', () => {
    const kz = k('Джентльмены (1-8 серии из 8) / The Gentlemen / 2024 / ПМ (HDRezka Studio) / WEB-DLRip (1080p)');
    expect(kz.kind).toBe('series');
    expect(kz.episodes).toEqual({ from: 1, to: 8, total: 8 });
    const boys = k('Пацаны (4 сезон: 1-8 серии из 8) / The Boys / 2024 / ПМ (LostFilm) / WEB-DL (1080p)');
    expect(boys.season).toBe(4);
    expect(boys.episodes).toEqual({ from: 1, to: 8, total: 8 });
    const rutor = k('Одни из нас / The Last of Us [S02] (2025) WEB-DL 1080p от Kerob | P');
    expect(rutor.kind).toBe('series');
    expect(rutor.season).toBe(2);
    expect(k('Фарго / Fargo [05x01-10 из 10] (2023) WEBRip 1080p').season).toBe(5);
    expect(kind('Слово пацана. Кровь на асфальте (2023) WEB-DL 1080p [1-8 из 8]')).toBe('series');
    expect(kind('Метод 2 сезон (2020) WEB-DL 1080p')).toBe('series');
    expect(kind('Мир Дикого запада / Westworld - Season 1 (2016) BDRip')).toBe('series');
  });

  it('mini-series and «сериал» without numbers', () => {
    expect(kind('Чернобыль / Chernobyl [2019, мини-сериал, драма, WEB-DL 1080p]')).toBe('series');
    expect(kind('Чернобыль / Chernobyl (2019) мини-сериал')).toBe('series');
    expect(kind('Ход королевы / The Queen\'s Gambit (Miniseries) 2020 WEB-DL')).toBe('series');
    expect(kind('Сериал Мастер и Маргарита 2005 DVDRip')).toBe('series');
  });

  it('anime: [TV] with episodes, [Movie]', () => {
    const tv = k('Магическая битва / Jujutsu Kaisen [TV] [1-24 из 24] [2020, WEB-DL 1080p]');
    expect(tv.kind).toBe('series');
    expect(tv.episodes).toEqual({ from: 1, to: 24, total: 24 });
    expect(kind('Frieren: Beyond Journey\'s End [TV] 1-12 из 12')).toBe('series');
    expect(kind('Атака титанов / Shingeki no Kyojin [TV-1] [2013, BDRip]')).toBe('series');
    expect(kind('Твоё имя / Kimi no Na wa [Movie] [2016, BDRip 1080p]')).toBe('movie');
  });

  it('unknown: no year and no marks, music, books, games', () => {
    expect(k('The Gentlemen 1080p')).toEqual({ kind: null });
    expect(kind('Просто название')).toBe(null);
    expect(kind('Hans Zimmer - Dune (Original Motion Picture Soundtrack) (2021) FLAC')).toBe(null);
    expect(kind('Metallica - Discography (1983-2023) MP3 320 kbps')).toBe(null);
    expect(kind('Кинг Стивен - Оно (2017) аудиокнига MP3')).toBe(null);
    expect(kind('Cyberpunk 2077 [P] [RUS + ENG] (2020) (2.1)')).toBe(null);
    expect(kind('')).toBe(null);
  });

  it('a remux listing FLAC audio stays a film', () => {
    expect(kind('Акира / Akira (1988) BDRemux 1080p | FLAC')).toBe('movie');
  });
});

describe('releaseKind: tracker categories first', () => {
  it('names of RuTracker forums, Kinozal and NNM-Club sections', () => {
    expect(categoryKind('Зарубежные сериалы (HD Video)')).toBe('series');
    expect(categoryKind('Русские сериалы')).toBe('series');
    expect(categoryKind('Мультсериалы (HD Video)')).toBe('series');
    expect(categoryKind('Сериалы')).toBe('series');
    expect(categoryKind('Фильмы 2021-2025')).toBe('movie');
    expect(categoryKind('Зарубежное кино (HD Video)')).toBe('movie');
    expect(categoryKind('Наше кино')).toBe('movie');
    expect(categoryKind('Мультфильмы')).toBe('movie');
    expect(categoryKind('Фильмы')).toBe('movie');
    expect(categoryKind('Аниме (HD Video)')).toBe(null);
    expect(categoryKind('Аниме')).toBe(null);
    expect(categoryKind('Музыка')).toBe('other');
    expect(categoryKind('Игры для Windows')).toBe('other');
    expect(categoryKind('')).toBe(null);
    expect(categoryKind(undefined)).toBe(null);
  });

  it('TorrServer rutor categories', () => {
    expect(categoryKind('Series')).toBe('series');
    expect(categoryKind('TVShow')).toBe('series');
    expect(categoryKind('Movie')).toBe('movie');
    expect(categoryKind('CartoonMovie')).toBe('movie');
  });

  it('Torznab ids', () => {
    expect(categoryKind('5000, 5040')).toBe('series');
    expect(categoryKind('5070')).toBe('series');
    expect(categoryKind('2000, 2040, 100002')).toBe('movie');
    expect(categoryKind('3000, 3040')).toBe('other');
    expect(categoryKind('2000, 5000')).toBe(null);
    expect(categoryKind('100001')).toBe(null);
    // Jackett lists the ids and the names together
    expect(categoryKind('2000, Movies')).toBe('movie');
    expect(categoryKind('5000, TV')).toBe('series');
    expect(categoryKind('5070, TV/Anime, 100045')).toBe('series');
    expect(categoryKind('100001, Movies')).toBe('movie');
    expect(categoryKind('3000, Audio')).toBe('other');
  });

  it('a category wins over the title; the title still gives the season', () => {
    // a series section with a year in the title: a series, its parts from the title
    const r = k('Джентльмены / The Gentlemen / Сезон: 1 / Серии: 1-8 из 8 [2024, WEB-DL 1080p]', 'Зарубежные сериалы (HD Video)');
    expect(r).toEqual({ kind: 'series', season: 1, episodes: { from: 1, to: 8, total: 8 }, year: 2024, by: 'category' });
    expect(k('Шоу без меток', 'Сериалы')).toEqual({ kind: 'series', by: 'category' });
    expect(kind('The Gentlemen 1080p', '2000')).toBe('movie');
    expect(kind('Some Title (2019)', 'Музыка')).toBe(null);
    // an anime section tells nothing: the title decides
    expect(kind('Магическая битва [TV] [1-24 из 24]', 'Аниме (HD Video)')).toBe('series');
  });

  it('keeps the answer for the same row', () => {
    const a = k('Джентльмены / The Gentlemen (2019)');
    expect(k('Джентльмены / The Gentlemen (2019)')).toBe(a);
  });
});

describe('kind badge', () => {
  it('names the kind with the parts that are known', () => {
    expect(resultKindLabel({ Title: 'Джентльмены / The Gentlemen (2019)' })).toBe('Фильм');
    expect(resultKindLabel({ Title: 'Джентльмены / The Gentlemen / Сезон: 2 / Серии: 1-8 из 8 [2026, WEB-DL 1080p]' })).toBe('Сериал · S02 · 1–8 из 8');
    expect(resultKindLabel({ Title: 'The.Gentlemen.S01.2160p.WEB-DL' })).toBe('Сериал · S01');
    expect(resultKindLabel({ Title: 'Шоу', Categories: 'Сериалы' })).toBe('Сериал');
    expect(kindLabel({ kind: 'series', season: [1, 3] })).toBe('Сериал · S01–S03');
    expect(kindLabel({ kind: 'series', episodes: { from: 1, to: 6 } })).toBe('Сериал · 1–6');
    expect(kindLabel({ kind: 'series', season: 3, episodes: { from: 5, to: 5 } })).toBe('Сериал · S03 · серия 5');
    expect(resultKindLabel({ Title: 'Просто название' })).toBe('');
  });
});

describe('kind filter', () => {
  afterEach(() => setKindFilter('all'));
  const rows = [
    { Title: 'Джентльмены / The Gentlemen (2019)' },
    { Title: 'The.Gentlemen.S02.2160p.WEB-DL' },
    { Title: 'Просто название' },
  ];
  it('shows unknown kinds only under «Все»', () => {
    expect(filterByKind(rows, 'all')).toEqual(rows);
    expect(filterByKind(rows, 'movie')).toEqual([rows[0]]);
    expect(filterByKind(rows, 'series')).toEqual([rows[1]]);
  });
  it('is kept for the session; a bad value is «Все»', () => {
    expect(getKindFilter()).toBe('all');
    setKindFilter('series');
    expect(getKindFilter()).toBe('series');
    setKindFilter('x' as never);
    expect(getKindFilter()).toBe('all');
    expect(kindFilterOptions().map((o) => o.label)).toEqual(['Все', 'Фильмы', 'Сериалы']);
  });
});
