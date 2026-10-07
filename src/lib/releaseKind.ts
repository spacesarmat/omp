// Kind of a found release: a film or a series (with its season and episodes), else unknown. The tracker's category
// decides first when the source gave one (a RuTracker forum, a Kinozal section, Torznab ids 2000–2999 / 5000–5999,
// TorrServer's rutor categories), then the title: series marks (S01, S01E01-08, «Сезон 2», «2 сезон», «Season 1»,
// «серии 1-8 из 8», «[1-8 из 8]», «complete series», «сериал», «[TV]»), else a year without them = a film. Anything
// else (music, games, books, a bare name) stays unknown. Pure; shared by the phone and the TV: Chromium 53 rules (no
// lookbehind, no u flag, no \b next to Cyrillic).
// Step 2 (grouping the results by TMDB title) builds on `year` and the short name of the release (releaseRow.ts).
import { parseEpisodeRange } from '../monitor/episodes';

export type ReleaseKindName = 'series' | 'movie';

export interface ReleaseKind {
  kind: ReleaseKindName | null;
  /** One season, or a pack [first, last]. Series only. */
  season?: number | [number, number];
  /** Episodes of the release; `total` is the episode count of the season («из 8»). Series only. */
  episodes?: { from: number; to: number; total?: number };
  /** Year of the release from its title (the first one), when there is one. */
  year?: number;
  /** What decided the kind. */
  by?: 'category' | 'title';
}

/** The parts of a search result the kind is read from. */
export interface KindInput {
  Title: string;
  Categories?: string;
}

// --- the tracker category --------------------------------------------------------------------------------------------

// Russian words of tracker category names (tracker data, not copy)
const CAT_SERIES = /сериал|series|tv[\s-]?shows?|тв[\s-]?шоу|телешоу|(?:^|[^a-z])tv(?:[^a-z]|$)/i;
const CAT_MOVIE = /фильм|кино|movie|film/i;
// sections that are no video at all: never a film by a year in the title
const CAT_OTHER = /музык|music|audio|аудио|игр[ыа]|games?(?:[^a-z]|$)|книг|book|софт|software|программ|xxx|эроти/i;

type CatVerdict = ReleaseKindName | 'other' | null;

/** Torznab ids: 5000–5999 TV, 2000–2999 Movies, other standard ids (1000–8999) no video of either kind. */
function numericCategory(c: string): CatVerdict {
  const ids = c.match(/\d+/g);
  if (!ids) return null;
  let tv = false;
  let movie = false;
  let other = false;
  ids.forEach((s) => {
    const n = parseInt(s, 10);
    if (n >= 5000 && n <= 5999) tv = true;
    else if (n >= 2000 && n <= 2999) movie = true;
    else if (n >= 1000 && n <= 8999) other = true;
  });
  if (tv && !movie) return 'series';
  if (movie && !tv) return 'movie';
  if (!tv && !movie && other) return 'other';
  return null;
}

/** The kind a tracker category names: 'other' for a section without video, null when it does not tell. */
export function categoryKind(categories: string | undefined): CatVerdict {
  const c = (categories || '').trim();
  if (!c) return null;
  // Torznab ids, whole items of the list (Jackett: «2000, Movies», «5000, 5040»; Prowlarr: the ids): they decide when
  // they tell; a name like «Фильмы 2021-2025» is no id
  const ids = c
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  const byId = ids.length ? numericCategory(ids.join(',')) : null;
  if (byId) return byId;
  if (CAT_SERIES.test(c)) return 'series';
  if (CAT_MOVIE.test(c)) return 'movie';
  if (CAT_OTHER.test(c)) return 'other';
  return null;
}

// --- the title -------------------------------------------------------------------------------------------------------

// series words without a number: «сериал», «мини-сериал», «complete series», «miniseries», «[TV]» of anime, «TV-1»
const SERIES_WORDS = /сериал|(?:^|[^a-z])(?:complete[\s._-]+series|mini-?series|tv[\s._-]?series|tv-\d{1,2})(?:[^a-z]|$)|\[\s*tv\s*\]|сезон|(?:^|[^a-z])seasons?(?:[^a-z]|$)/i;
// a film said in so many words: «[Movie]» / «[Фильм]» of anime, «полнометражный»
const MOVIE_WORDS = /\[\s*(?:movie|фильм)\s*\]|полнометражн/i;
// not a video release: music, books, games (unless the title also has video marks: a remux may list FLAC audio)
const NOT_VIDEO =
  /(?:^|[^a-z])(?:flac|mp3|lossless|discography|album|ost|fb2|epub|pdf|djvu|kbps|soundtrack)(?:[^a-z]|$)|дискограф|альбом|аудиокниг|саундтрек|\[p\]|\[l\]/i;
const VIDEO_MARKS = /(?:^|[^a-z0-9])(?:2160p|1080[pi]|720p|480p|4k|uhd|web-?dl|web-?rip|bd-?rip|blu-?ray|hd-?rip|dvd-?rip|dvd\d?|hdtv|remux|x26[45]|h[ .]?26[45]|hevc|avc|xvid|divx|mkv|avi)(?:[^a-z0-9]|$)/i;
const YEAR = /(?:^|[^0-9])(19[0-9][0-9]|20[0-4][0-9])(?:[^0-9]|$)/;

function yearOf(title: string): number | undefined {
  const m = YEAR.exec(title);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Season and episodes of a series title (the parts that are known). */
function seriesParts(title: string, out: ReleaseKind): boolean {
  const r = parseEpisodeRange(title);
  let found = false;
  if (r.season !== undefined) {
    out.season = r.seasonTo !== undefined ? [r.season, r.seasonTo] : r.season;
    found = true;
  }
  if (r.from !== undefined && r.to !== undefined) {
    out.episodes = r.total !== undefined ? { from: r.from, to: r.to, total: r.total } : { from: r.from, to: r.to };
    found = true;
  }
  return found;
}

function detect(r: KindInput): ReleaseKind {
  const title = (r.Title || '').replace(/[._]+/g, ' ');
  const year = yearOf(title);
  const out: ReleaseKind = { kind: null };
  if (year !== undefined) out.year = year;
  const cat = categoryKind(r.Categories);
  if (cat === 'other') return out;
  if (cat === 'series') {
    out.kind = 'series';
    out.by = 'category';
    seriesParts(title, out);
    return out;
  }
  if (cat === 'movie') {
    out.kind = 'movie';
    out.by = 'category';
    return out;
  }
  if (NOT_VIDEO.test(title) && !VIDEO_MARKS.test(title)) return out;
  if (seriesParts(title, out) || SERIES_WORDS.test(title)) {
    out.kind = 'series';
    out.by = 'title';
    return out;
  }
  if (year !== undefined || MOVIE_WORDS.test(title)) {
    out.kind = 'movie';
    out.by = 'title';
  }
  return out;
}

// results are read again on every render: the answer is kept per title and category (bounded)
const CACHE_MAX = 2000;
let cache: { [key: string]: ReleaseKind } = {};
let cached = 0;

/** The kind of a search result (see the head of the file). */
export function releaseKind(r: KindInput): ReleaseKind {
  const key = (r.Categories || '') + '\u0001' + (r.Title || '');
  const hit = cache[key];
  if (hit) return hit;
  if (cached >= CACHE_MAX) {
    cache = {};
    cached = 0;
  }
  const v = detect(r);
  cache[key] = v;
  cached++;
  return v;
}

// --- the filter ------------------------------------------------------------------------------------------------------

export type KindFilter = 'all' | 'movie' | 'series';

export const KIND_FILTERS: KindFilter[] = ['all', 'movie', 'series'];

/** Rows of the filter: everything under «Все», only the films / series otherwise (an unknown kind only under «Все»). */
export function filterByKind<T extends KindInput>(list: T[], f: KindFilter): T[] {
  if (f === 'all') return list;
  return list.filter((r) => releaseKind(r).kind === f);
}

// the filter of the search screens: kept while the app runs (one screen per bundle)
let sessionFilter: KindFilter = 'all';

export function getKindFilter(): KindFilter {
  return sessionFilter;
}

export function setKindFilter(f: KindFilter): void {
  sessionFilter = KIND_FILTERS.indexOf(f) >= 0 ? f : 'all';
}
