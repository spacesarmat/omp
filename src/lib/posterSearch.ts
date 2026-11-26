import type { TmdbConfig } from '../api/types';
import { posterImageSize } from '../catalog/tmdb';
import { isTmdbV4Token } from '../catalog/tmdbToken';
import { yearInTitle, yearPosition } from '../sources/queryParse';

const MAX_WORDS = 4;
const MAX_LEN = 50;
// the release details that end a name: a season mark, a resolution, a source or a codec. A year is not here:
// «Бегущий по лезвию 2049» keeps its number in the name, and the year of the release is found by yearPosition
const TAIL = /\b(?:s\d{1,2}(?:e\d{1,3})?|\d{3,4}p|4k|web-?dl|web-?rip|bd-?rip|hd-?rip|dvd-?rip|blu-?ray|hdtv|x26[45]|h\.?26[45]|hevc)\b/i;

/** Short query for the poster search from a torrent title, as the TorrServer web page does. */
export function posterQuery(title: string): string {
  let q = titleCore(title).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');
  if (q.length > MAX_LEN) {
    const cut = q.slice(0, MAX_LEN);
    const sp = cut.lastIndexOf(' ');
    q = sp > 0 ? cut.slice(0, sp) : cut;
  }
  return q;
}

// The words of a release line that say which episodes it holds. Russian forms are always marks; the English ones
// only where the line punctuates them («Season: 2», « · Season 2 »), because «Open Season 2» is a name.
const MARK_RU = /^(?:сезон[аеуы]*|сезонов|серии|серий|серия|серийный|эпизод[аы]*|эпизодов)$/i;
// words that introduce a count: «Серии: 1-6 из 9», «Episodes 1-10 of 24»
const MARK_INTRO = /^(?:из|of|от|by|и|and)$/i;
const MARK_EN = /^(?:seasons?|episodes?)$/i;
const MARK_NUM = /^\d{1,4}(?:[.\u2013-]\d{1,4})?(?:й|ый|я|ая)?$/i;
const MARK_SEP = /^[-.,:;/|&·•\u2013\u2014]+$/;
const MARK_PUNCT = /[\s:.,;-]+$/;

// Nothing to trim unless the line ends with a number, a mark word or a separator: titleCore runs for every torrent.
const MAYBE_TAIL = /(?:\d|сезон[аеуы]*|сезонов|seasons?|серии|серий|серия|эпизод[аы]*|эпизодов|episodes?|из|of|от|by|[-.,:;/|&·•\u2013\u2014])\s*$/i;

/**
 * The season and episode tail of a name: «Тест 1 сезон 1-8 серия» is named «Тест», «Loki Season: 2 Episode 3» is
 * «Loki». The tail is read from the right over numbers, separators and mark words; it is dropped only where the
 * line proves it is release metadata: a count and a Russian mark («4 сезон», «1-8 серии»), a punctuated English
 * label («Season: 2») or two English labels together («Season 2 Episode 3»). A single English word inside a name
 * («Open Season 2», «Два холма 2») is not evidence, and a line that is nothing but a tail is left alone.
 */
function trimMarks(s: string): string {
  if (!MAYBE_TAIL.test(s)) return s;
  const words = s.split(/\s+/).filter(Boolean);
  const bare = (w: string): string => (w || '').replace(MARK_PUNCT, '');
  const ru = (w: string): boolean => MARK_RU.test(bare(w));
  const num = (w: string): boolean => MARK_NUM.test(bare(w));
  const intro = (w: string): boolean => MARK_INTRO.test(bare(w));
  const en = (w: string): boolean => MARK_EN.test(bare(w));
  // an English word written as a label: «Season:», or one that a separator or a preceding colon brings («Loki: Season 2»)
  const labelled = (i: number): boolean =>
    en(words[i]) && (/:/.test(words[i]) || i === 0 || MARK_SEP.test(bare(words[i - 1])) || /:$/.test(words[i - 1] || ''));
  const candidate = (i: number): boolean => ru(words[i]) || en(words[i]) || intro(words[i]) || num(words[i]) || MARK_SEP.test(bare(words[i]));
  let from = words.length;
  // the first token always stays: «1983 1 сезон» is named «1983», not nothing
  while (from > 1 && candidate(from - 1)) from--;
  const tail = words.slice(from);
  if (!tail.length || !words.length) return s;
  const kinds: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const k = bare(tail[i]).toLowerCase();
    if (en(tail[i]) && kinds.indexOf(k) < 0) kinds.push(k);
  }
  const evidence = tail.some((w) => num(w)) && (tail.some((w) => ru(w)) || tail.some((w, i) => labelled(from + i)) || kinds.length >= 2 || tail.some((w) => intro(w)));
  return evidence ? words.slice(0, from).join(' ') : s;
}

/** The title proper of a torrent title: before « [», « (», « / », « | », the release year or its details. */
export function titleCore(title: string): string {
  let s = (title || '').trim();
  const seps = [' [', ' (', ' / ', ' | '];
  for (let i = 0; i < seps.length; i++) {
    const at = s.indexOf(seps[i]);
    if (at > 0) s = s.slice(0, at);
  }
  // release names use dots or underscores instead of spaces
  if (s.indexOf(' ') < 0) s = s.replace(/[._]+/g, ' ');
  // whichever comes first: a detail mark or the year the release was named for
  let cut = -1;
  const tail = TAIL.exec(s);
  if (tail && tail.index > 0) cut = tail.index;
  const year = yearPosition(s);
  if (year > 0 && (cut < 0 || year < cut)) cut = year;
  if (cut > 0) s = s.slice(0, cut);
  // what the cut left behind still ends with the season and the episodes: the key of the work is its name alone
  const named = trimMarks(s);
  if (named) s = named;
  return s.replace(/\s*(?:сезон|season)\s*$/i, '').replace(/[\s.,:;-]+$/, '').replace(/\s+/g, ' ').trim();
}

/** A title for comparing: lower case, «ё» read as «е», punctuation and extra spaces dropped (letters of any script kept). */
export function normTitle(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, '\u0435')
    // spaces and punctuation only: letters of any script (君の名は, Arabic) stay
    .replace(/[\s!-\/:-@[-`{-~\u00a0-\u00bf\u2010-\u205f]+/g, ' ')
    .trim();
}

const YO_MAX = 3;

/**
 * The same query with one «е» read as «ё», each «е» in turn (at most YO_MAX): TMDB finds «Супергёрл» only with «ё»,
 * while torrent titles often write «Супергерл». None when the query has no «е» or already has a «ё».
 */
export function yoVariants(query: string): string[] {
  const q = query || '';
  if (/[ёЁ]/.test(q)) return [];
  // е → ё, Е → Ё (escapes: no Russian copy in code)
  const YO: { [c: string]: string } = { '\u0435': '\u0451', '\u0415': '\u0401' };
  const out: string[] = [];
  for (let i = 0; i < q.length && out.length < YO_MAX; i++) {
    const to = YO[q.charAt(i)];
    if (to) out.push(q.slice(0, i) + to + q.slice(i + 1));
  }
  return out;
}

const CYRILLIC = /[а-яё]/i;
const LATIN = /[a-z]/i;

/**
 * The English (latin) title in torrent names: a latin part of «Супергерл / Supergirl / 2026», or a release name
 * «Supergirl.2026.BDRemux...». '' when there is none.
 */
export function latinTitle(sources: string[]): string {
  for (let i = 0; i < sources.length; i++) {
    const parts = (sources[i] || '').split(/\s+[/|]\s+/);
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j].trim();
      if (!part || CYRILLIC.test(part)) continue;
      const q = posterQuery(part);
      if (q && LATIN.test(q) && !CYRILLIC.test(q)) return q;
    }
  }
  return '';
}

/** The release year of the first source that names one, 0 when none does. */
export function sourcesYear(sources: string[]): number {
  for (let i = 0; i < sources.length; i++) {
    const y = yearInTitle(sources[i] || '');
    if (y) return y;
  }
  return 0;
}

/**
 * The searches to try for a poster, in order: the title proper, then its «ё» variants, then the English title found in
 * any of the sources (the torrent's title, name). The same query (ё read as е) is tried once.
 */
export function posterQueries(primary: string, sources: string[] = []): string[] {
  const first = posterQuery(primary);
  const seen: { [k: string]: boolean } = {};
  const out: string[] = [];
  const add = (q: string, exact?: boolean) => {
    const k = exact ? q.toLowerCase() : normTitle(q) || q.toLowerCase();
    if (!q || !k || seen[k]) return;
    seen[k] = true;
    out.push(q);
  };
  add(first);
  yoVariants(first).forEach((q) => add(q, true));
  add(latinTitle([primary].concat(sources)));
  return out;
}

function withScheme(url: string | undefined, fallback: string): string {
  const u = (url || fallback).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/\//, '');
}

export interface TmdbSearchRequest {
  url: string;
  /** Set for a v4 access token: TMDB rejects that token in api_key and accepts it as a bearer. */
  headers?: { [name: string]: string };
}

/** TMDB multi-search for a query; Russian titles and images. A v4 token is a bearer header, not api_key. */
export function tmdbSearchRequest(cfg: TmdbConfig, query: string): TmdbSearchRequest {
  return tmdbTypedSearchRequest(cfg, 'multi', query);
}

/**
 * TMDB search of one kind (`multi`, `movie` or `tv`) in Russian. The year is not sent: TMDB would drop a film dated a
 * year off, so the results are matched to the year here (yearPoster). A v4 token is a bearer header, not api_key.
 */
export function tmdbTypedSearchRequest(cfg: TmdbConfig, kind: 'multi' | 'movie' | 'tv', query: string): TmdbSearchRequest {
  let base = withScheme(cfg.APIURL, 'https://api.themoviedb.org');
  if (base.indexOf('/3/search/') < 0) base = base.replace(/\/3.*$/, '').replace(/\/search.*$/, '') + '/3/search/' + kind;
  else base = base.replace(/\/3\/search\/[a-z]+.*$/, '/3/search/' + kind);
  const key = (cfg.APIKey || '').trim();
  const bearer = isTmdbV4Token(key);
  const url =
    base +
    '?' +
    (bearer ? '' : 'api_key=' + encodeURIComponent(key) + '&') +
    'language=ru&include_image_language=ru,null,en&query=' + encodeURIComponent(query);
  if (!bearer) return { url: url };
  return { url: url, headers: { Authorization: 'Bearer ' + key } };
}

/** TMDB multi-search URL for a query; Russian titles and images. */
export function tmdbSearchUrl(cfg: TmdbConfig, query: string): string {
  return tmdbSearchRequest(cfg, query).url;
}

/** First poster among TMDB search results, or '' when there is none. */
export function firstPoster(cfg: TmdbConfig, results: unknown): string {
  if (!Array.isArray(results)) return '';
  const host = withScheme(cfg.ImageURLRu, 'https://imagetmdb.com');
  for (let i = 0; i < results.length; i++) {
    const p = results[i] && (results[i] as { poster_path?: unknown }).poster_path;
    if (typeof p === 'string' && p) return host + '/t/p/' + posterImageSize() + (p.charAt(0) === '/' ? p : '/' + p);
  }
  return '';
}

function resultYear(r: { [k: string]: unknown }): number {
  const d = typeof r.release_date === 'string' ? r.release_date : typeof r.first_air_date === 'string' ? r.first_air_date : '';
  const m = /^(\d{4})/.exec(d);
  return m ? +m[1] : 0;
}

/** The titles TMDB gives a result (Russian, original), compared as normTitle. */
function resultTitles(r: { [k: string]: unknown }): string[] {
  return ['title', 'name', 'original_title', 'original_name']
    .map((k) => (typeof r[k] === 'string' ? normTitle(r[k] as string) : ''))
    .filter(Boolean);
}

/** `rows` with the ones titled like `query` (ё read as е) first, otherwise in TMDB's order. */
function titleFirst(rows: { [k: string]: unknown }[], query: string | undefined): { [k: string]: unknown }[] {
  const q = normTitle(query || '');
  if (!q) return rows;
  const hit = rows.filter((r) => resultTitles(r).indexOf(q) >= 0);
  return hit.concat(rows.filter((r) => hit.indexOf(r) < 0));
}

/**
 * The poster of the TMDB result that matches `year`: the same year first, then a year off by one (a release dated a
 * year later); with no year, the first result with a poster. Within those, a result titled like `query` (ё read as е)
 * comes first. '' when none matches: the caller tries the next search.
 *
 * One exception: when exactly one result carries the asked name, that is the work, whatever the release line said
 * about its year. «Бегущий по лезвию 2049» is dated 2017 by TMDB, and a release line whose year we misread must not
 * send us to another film. Two results of one name (a remake) leave the decision to the year, as before.
 */
export function yearPoster(cfg: TmdbConfig, results: unknown, year: number, query?: string): string {
  if (!Array.isArray(results)) return '';
  const rows = results.filter((r) => {
    const p = r && (r as { poster_path?: unknown }).poster_path;
    return typeof p === 'string' && !!p;
  }) as { [k: string]: unknown }[];
  if (!rows.length) return '';
  const q = normTitle(query || '');
  if (q) {
    // counted over every answer, not only the ones with a picture: a remake of another year must not win because
    // the asked work happens to have no poster
    const namedAll = (results as unknown[]).filter((r) => r && typeof r === 'object' && resultTitles(r as { [k: string]: unknown }).indexOf(q) >= 0);
    if (namedAll.length === 1) {
      const named = rows.filter((r) => resultTitles(r).indexOf(q) >= 0);
      return named.length === 1 ? firstPoster(cfg, named) : '';
    }
  }
  if (!year) return firstPoster(cfg, titleFirst(rows, query));
  const same = rows.filter((r) => resultYear(r) === year);
  if (same.length) return firstPoster(cfg, titleFirst(same, query));
  const near = rows.filter((r) => Math.abs(resultYear(r) - year) === 1);
  return near.length ? firstPoster(cfg, titleFirst(near, query)) : '';
}
