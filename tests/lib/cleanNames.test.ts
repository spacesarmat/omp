import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  torrentName, seriesName, seriesGroupOf, episodeOf, episodeSubLine, episodeCode, playerHeading, isFilmFile,
  episodeNameOf, resetCleanNames,
} from '../../src/lib/cleanNames';
import { matchSeries, resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames, realEpisodeName } from '../../src/lib/episodeNames';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { lang } from '../../src/i18n';
import type { Torrent } from '../../src/api/types';

const files = (...paths: string[]) => JSON.stringify({ TorrServer: { Files: paths.map((p, i) => ({ id: i + 1, path: p, length: 1 })) } });
const tor = (hash: string, title: string, category: string | undefined, ...paths: string[]): Torrent => ({ hash, title, category, stat: 5, data: files(...paths) });

// what the LG library really held: English-only titles and a name derived from the files
const ahs = tor('a1', 'American Horror Story · Сезон 13', 'tv', 'AHS/American.Horror.Story.S13E01.mkv', 'AHS/American.Horror.Story.S13E02.mkv');
const futurama = tor('b1', 'Futurama.S14E09.1080p.ColdFilm.mkv', 'tv', 'Futurama.S14E09.1080p.ColdFilm.mkv');
const film = tor('c1', 'Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv', 'movie', 'Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv');
const avatar = tor('d1', 'Аватар: Пламя и Пепел / Avatar: Fire and Ash (Джеймс Кэмерон) [2025, фантастика, WEB-DL 2160p] Sub (Rus, Ukr, Eng)', 'movie', 'Avatar.Fire.and.Ash.2025.mkv');

/** A TMDB stand-in that answers in the UI language, like the real client (language=ru-RU / en-US). */
function catalog() {
  const names: { [q: string]: [number, string, string] } = {
    'american horror story': [1, 'Американская история ужасов', 'American Horror Story'],
    futurama: [2, 'Футурама', 'Futurama'],
  };
  const find = (q: string) => {
    const k = Object.keys(names).filter((n) => q.toLowerCase().indexOf(n) >= 0)[0];
    return k ? names[k] : null;
  };
  return {
    search: (q: string) => {
      const hit = find(q);
      if (!hit) return Promise.resolve({ items: [], pages: 1 });
      const title = lang.peek() === 'en' ? hit[2] : hit[1];
      return Promise.resolve({ items: [{ kind: 'tv', id: hit[0], title: title, original: hit[2], year: 2011, poster: '', rating: 7 }], pages: 1 });
    },
    card: (_k: string, id: number) => {
      const hit = Object.keys(names).map((k) => names[k]).filter((x) => x[0] === id)[0];
      return Promise.resolve({ kind: 'tv', id: id, title: lang.peek() === 'en' ? hit[2] : hit[1], original: hit[2], year: 2011, seasons: [] });
    },
    season: () => Promise.resolve({ episodes: [{ n: 1, title: 'Спокойная жизнь' }, { n: 2, title: 'Эпизод 2' }] }),
  };
}

beforeEach(() => {
  resetSeriesMatches();
  resetEpisodeNames();
  resetCleanNames();
  lang.value = 'ru';
  setCatalogProvider(() => Promise.resolve(catalog() as any));
});
afterEach(() => {
  setCatalogProvider(null);
  lang.value = 'ru';
});

describe('torrentName: the TV names a torrent like the phone', () => {
  const list = [ahs, futurama, film, avatar];

  it('uses the short title until the series is matched (the cause of the English tiles)', () => {
    expect(torrentName(ahs, list)).toBe('American Horror Story · Сезон 13');
    expect(torrentName(futurama, list)).toBe('Futurama');
  });

  it('uses the TMDB name in the UI language once the series is matched', async () => {
    await matchSeries(seriesGroupOf(ahs, list)!);
    await matchSeries(seriesGroupOf(futurama, list)!);
    expect(torrentName(ahs, list)).toBe('Американская история ужасов');
    expect(torrentName(futurama, list)).toBe('Футурама');
    expect(seriesName(seriesGroupOf(ahs, list)!)).toBe('Американская история ужасов');
  });

  it('keeps a separate match per language', async () => {
    await matchSeries(seriesGroupOf(futurama, list)!);
    lang.value = 'en';
    expect(torrentName(futurama, list)).toBe('Futurama');
    await matchSeries(seriesGroupOf(futurama, list)!);
    expect(torrentName(futurama, list)).toBe('Futurama');
    lang.value = 'ru';
    expect(torrentName(futurama, list)).toBe('Футурама');
  });

  it('names a film by its short title, never the file name or the full tracker title', () => {
    expect(seriesGroupOf(film, list)).toBeNull();
    expect(torrentName(film, list)).toBe('Signal One');
    expect(torrentName(avatar, list)).toBe('Аватар: Пламя и Пепел');
  });
});

describe('episode lines', () => {
  it('reads the season and episode, with anime-style numbers and the season from the title', () => {
    expect(episodeOf('Dark.Matter.S02E01.1080p.mkv')).toEqual({ season: 2, episode: 1 });
    expect(episodeOf('Yu_Ling_Shi_[11]_[HEVC].mkv')).toEqual({ season: null, episode: 11 });
    expect(episodeOf('[Double-Raws] Saikyosoubi - 01 RAW [1080p].mkv')).toEqual({ season: null, episode: 1 });
    expect(episodeOf('Show [01v2].mkv', 'Show / Сезон: 2 / Серии: 1-10 из 10')).toEqual({ season: 2, episode: 1 });
    expect(episodeOf('Movie.2024.1080p.mkv')).toEqual({ season: null, episode: null });
    expect(episodeOf('Film [1080p].mkv')).toEqual({ season: null, episode: null });
  });

  it('builds «Сезон 2 · Серия 1» plus the real TMDB name, «Фильм» for a film, nothing for an unnumbered file', () => {
    expect(episodeSubLine({ season: 2, episode: 1 }, 'Спокойная жизнь', false)).toBe('Сезон 2 · Серия 1 · Спокойная жизнь');
    expect(episodeSubLine({ season: 2, episode: 1 }, 'Эпизод 1', false)).toBe('Сезон 2 · Серия 1');
    expect(episodeSubLine({ season: null, episode: 11 }, '', false)).toBe('Серия 11');
    expect(episodeSubLine({ season: null, episode: null }, '', true)).toBe('Фильм');
    expect(episodeSubLine({ season: null, episode: null }, '', false)).toBe('');
  });

  it('tells a film from an episode', () => {
    expect(isFilmFile(film, 'Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv')).toBe(true);
    expect(isFilmFile(ahs, 'AHS/American.Horror.Story.S13E01.mkv')).toBe(false);
    expect(isFilmFile(tor('e1', 'Something', undefined, 'Something.mkv'), 'Something.mkv')).toBe(true);
    expect(isFilmFile(tor('e2', 'Pack', undefined, 'a.mkv', 'b.mkv'), 'a.mkv')).toBe(false);
  });

  it('gets the real episode name from TMDB, not a placeholder', async () => {
    expect(await episodeNameOf(ahs, { season: 13, episode: 1 })).toBe('Спокойная жизнь');
    expect(await episodeNameOf(ahs, { season: 13, episode: 2 })).toBe('');
    expect(await episodeNameOf(ahs, { season: null, episode: 2 })).toBe('');
    expect(realEpisodeName('Episode 7')).toBe('');
  });
});

describe('the player heading', () => {
  it('is «Name · S02E01 · Episode name», a film its name', () => {
    expect(episodeCode({ season: 2, episode: 1 })).toBe('S02E01');
    expect(episodeCode({ season: null, episode: 11 })).toBe('E11');
    expect(playerHeading('Тёмная материя', 'S02E01', 'Спокойная жизнь')).toBe('Тёмная материя · S02E01 · Спокойная жизнь');
    expect(playerHeading('Тёмная материя', 'S02E01', 'Эпизод 1')).toBe('Тёмная материя · S02E01');
    expect(playerHeading('Аватар', '', 'ignored')).toBe('Аватар');
  });
});
