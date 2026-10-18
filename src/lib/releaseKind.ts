// Kind of a found release: a film, a series (with its season and episodes), an audiobook, an e-book, else unknown.
// The tracker's category decides when the source gave one (a RuTracker forum, a Kinozal section, Torznab ids
// 2000–2999 / 3030 / 5000–5999, TorrServer's rutor categories), then the title: series marks (S01, S01E01-08,
// «Сезон 2», «2 сезон», «Season 1», «серии 1-8 из 8», «[1-8 из 8]», «complete series», «сериал», «[TV]»), else a
// year without them = a film. An audiobook title wins over a movie category: «аудиокнига», «радиоспектакль»,
// «чит.», «читает», m4b, or MP3/M4A/AAC/FLAC (Cyrillic look-alikes included) when the row is not a video and not
// a music album. FB2/EPUB/PDF/DJVU is an e-book. Books (7000) and other (80xx) become an audiobook when the title
// has a hint. Anything else (music, games, a bare name) stays unknown. Pure; shared by the phone and the TV:
// Chromium 53 rules (no lookbehind, no u flag, no \b next to Cyrillic).
// Step 2 (grouping the results by TMDB title) builds on `year` and the short name of the release (releaseRow.ts).
import { parseEpisodeRange } from '../monitor/episodes';

export type ReleaseKindName = 'series' | 'movie' | 'audiobook' | 'ebook';

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
const CAT_AUDIOBOOK = /аудиокниг|audiobook/i;
const CAT_OTHER = /музык|music|audio|аудио|игр[ыа]|games?(?:[^a-z]|$)|книг|book|софт|software|программ|xxx|эроти/i;

type CatVerdict = ReleaseKindName | 'other' | null;

/** Torznab ids: 5000–5999 TV, 2000–2999 Movies, 3030 audiobook, other standard ids (1000–8999) neither. */
function numericCategory(c: string): CatVerdict {
  const ids = c.match(/\d+/g);
  if (!ids) return null;
  let tv = false;
  let movie = false;
  let audiobook = false;
  let other = false;
  ids.forEach((s) => {
    const n = parseInt(s, 10);
    if (n >= 5000 && n <= 5999) tv = true;
    else if (n >= 2000 && n <= 2999) movie = true;
    else if (n === 3030) audiobook = true;
    else if (n >= 1000 && n <= 8999) other = true;
  });
  if (tv && !movie) return 'series';
  if (movie && !tv) return 'movie';
  if (audiobook && !tv && !movie) return 'audiobook';
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
  if (CAT_AUDIOBOOK.test(c)) return 'audiobook';
  if (CAT_SERIES.test(c)) return 'series';
  if (CAT_MOVIE.test(c)) return 'movie';
  if (CAT_OTHER.test(c)) return 'other';
  return null;
}

// --- audiobook titles ------------------------------------------------------------------------------------------------

// «чит.» / «читает» / «аудиокнига» / «радиоспектакль». «исполнитель» is not here: «Исполнитель желаний» is a film.
const BOOK_WORDS = /аудиокниг|радиоспектакл|чит\.|чита(?:ет|ют)/i;
const M4B = /(?:^|[^a-z0-9])m4b(?:[^a-z0-9]|$)/i;
const AUDIO_CONTAINER = /(?:^|[^a-z0-9])(?:mp3|m4b|m4a|aac|flac)(?:[^a-z0-9]|$)/i;
const EBOOK_EXT = /(?:^|[^a-z0-9])(?:fb2|epub|pdf|djvu)(?:[^a-z0-9]|$)/i;
const KBPS = /(?:^|[^a-z0-9])kbps(?:[^a-z0-9]|$)/i;

/**
 * Cyrillic letters that trackers type instead of Latin in «МР3», «М4В», «ААС».
 * Only the folded string is matched against format tokens; Russian words stay on the original.
 */
function foldLookalikes(s: string): string {
  return (s || '')
    .replace(/\u0410/g, 'A')
    .replace(/\u0430/g, 'a')
    .replace(/\u0412/g, 'B')
    .replace(/\u0432/g, 'b')
    .replace(/\u0415/g, 'E')
    .replace(/\u0435/g, 'e')
    .replace(/\u041a/g, 'K')
    .replace(/\u043a/g, 'k')
    .replace(/\u041c/g, 'M')
    .replace(/\u043c/g, 'm')
    .replace(/\u041e/g, 'O')
    .replace(/\u043e/g, 'o')
    .replace(/\u0420/g, 'P')
    .replace(/\u0440/g, 'p')
    .replace(/\u0421/g, 'C')
    .replace(/\u0441/g, 'c')
    .replace(/\u0422/g, 'T')
    .replace(/\u0442/g, 't')
    .replace(/\u0425/g, 'X')
    .replace(/\u0445/g, 'x');
}

/** Title marks that are an audiobook without a tracker category: book words, or m4b. */
export function strongAudiobookTitle(title: string): boolean {
  const raw = title || '';
  if (BOOK_WORDS.test(raw)) return true;
  return M4B.test(foldLookalikes(raw));
}

/** FB2, EPUB, PDF, DJVU, including Cyrillic look-alikes of those Latin letters. */
export function ebookTitle(title: string): boolean {
  return EBOOK_EXT.test(foldLookalikes(title || ''));
}

/**
 * Hints for a books/other row (7000, 80xx): book words, «исполнитель», MP3, M4B, AAC, FLAC, kbps.
 * MP3 and kbps alone are also music, so this is not used without that category.
 */
export function looseAudiobookTitle(title: string): boolean {
  const raw = title || '';
  if (BOOK_WORDS.test(raw) || /исполнител/i.test(raw)) return true;
  const folded = foldLookalikes(raw);
  return AUDIO_CONTAINER.test(folded) || KBPS.test(folded);
}

/** NNM-Club's 7000 and RuTor 8000 / MegaPeer 8010, where audiobooks are not filed as 3030. */
export function looseAudiobookCategory(categories: string | undefined): boolean {
  const ids = (categories || '').match(/\d+/g);
  if (!ids) return false;
  for (let i = 0; i < ids.length; i++) {
    const n = parseInt(ids[i], 10);
    if (n === 7000 || (n >= 8000 && n <= 8099)) return true;
  }
  return false;
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
const MUSIC_ALBUM = /(?:^|[^a-z])(?:ost|album|discography|soundtrack)(?:[^a-z]|$)|дискограф|альбом|саундтрек/i;

/**
 * A movie-section row whose title is an audio container (MP3, M4B, AAC, FLAC, Cyrillic «МР3»)
 * and is not a video release or a music album. The forum tag «Фильм» does not win.
 */
export function movieCategoryAudiobook(title: string, categories: string | undefined): boolean {
  if (categoryKind(categories) !== 'movie') return false;
  const raw = title || '';
  if (!AUDIO_CONTAINER.test(foldLookalikes(raw))) return false;
  if (VIDEO_MARKS.test(raw) || MUSIC_ALBUM.test(raw)) return false;
  return true;
}
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
  // A narrator credit, m4b, or an audio container filed as a film is an audiobook even when the
  // tracker says «Фильм». An e-book (FB2/EPUB/PDF/DJVU) is not a film and not something to watch.
  if (strongAudiobookTitle(title) || movieCategoryAudiobook(title, r.Categories)) {
    out.kind = 'audiobook';
    out.by = 'title';
    return out;
  }
  if (ebookTitle(title) && !VIDEO_MARKS.test(title)) {
    out.kind = 'ebook';
    out.by = 'title';
    return out;
  }
  const cat = categoryKind(r.Categories);
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
  if (cat === 'audiobook' || strongAudiobookTitle(title) || (looseAudiobookCategory(r.Categories) && looseAudiobookTitle(title))) {
    out.kind = 'audiobook';
    out.by = cat === 'audiobook' ? 'category' : 'title';
    return out;
  }
  if (cat === 'other') return out;
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

export type KindFilter = 'all' | 'movie' | 'series' | 'audiobook';

export const KIND_FILTERS: KindFilter[] = ['all', 'movie', 'series', 'audiobook'];

/** Rows of the filter: everything under «Все», only the films / series / audiobooks otherwise (an unknown kind only under «Все»). */
export function filterByKind<T extends KindInput>(list: T[], f: KindFilter): T[] {
  if (f === 'all') return list;
  return list.filter((r) => releaseKind(r).kind === f);
}

/**
 * «Аудиокниги» is a search mode, not only a client filter: indexers run the audiobook query
 * (Torznab cat 3030 plus an open search). The other kinds filter the rows of a normal search.
 */
export function searchModeForKind(f: KindFilter): 'audiobook' | undefined {
  return f === 'audiobook' ? 'audiobook' : undefined;
}

// the filter of the search screens: kept while the app runs (one screen per bundle)
let sessionFilter: KindFilter = 'all';

export function getKindFilter(): KindFilter {
  return sessionFilter;
}

export function setKindFilter(f: KindFilter): void {
  sessionFilter = KIND_FILTERS.indexOf(f) >= 0 ? f : 'all';
}
