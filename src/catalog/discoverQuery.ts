// «Обзор»: the sort and the filters of the TMDB feed (genre, year, country, minimum rating), their sanitizer and the
// TMDB /discover parameters they become. Pure; the URL is built by tmdb.ts.
import type { CatalogTitle, Kind } from './tmdb';

export type DiscoverSort = 'popular' | 'rating' | 'date' | 'upcoming' | 'digitalSoon';
export type DiscoverYear = 'any' | 'this' | 'last' | 'range';

export interface DiscoverQuery {
  sort: DiscoverSort;
  /** Genre ids of GENRES (not TMDB ids: movie and tv ids differ). */
  genres: string[];
  year: DiscoverYear;
  /** The range («Диапазон»): 0 = open. */
  from: number;
  to: number;
  /** ISO 3166-1 code of COUNTRIES, '' = any. */
  country: string;
  /** vote_average at least (0 = any). */
  rating: number;
}

export const DISCOVER_SORTS: DiscoverSort[] = ['popular', 'rating', 'date', 'upcoming', 'digitalSoon'];
/** «Скоро в цифре»: digital releases from today up to this many days ahead. */
export const DIGITAL_SOON_DAYS = 60;
export const DISCOVER_RATINGS = [0, 6, 7, 8];
export const DISCOVER_COUNTRIES = ['RU', 'US', 'GB', 'KR', 'JP', 'FR', 'DE', 'ES', 'IT', 'IN', 'TR', 'CN'];

export const DEFAULT_DISCOVER_QUERY: DiscoverQuery = { sort: 'popular', genres: [], year: 'any', from: 0, to: 0, country: '', rating: 0 };

/** TMDB genre ids per kind (0: the kind has no such genre). */
export const GENRES: { id: string; movie: number; tv: number }[] = [
  { id: 'action', movie: 28, tv: 10759 },
  { id: 'adventure', movie: 12, tv: 10759 },
  { id: 'animation', movie: 16, tv: 16 },
  { id: 'comedy', movie: 35, tv: 35 },
  { id: 'crime', movie: 80, tv: 80 },
  { id: 'documentary', movie: 99, tv: 99 },
  { id: 'drama', movie: 18, tv: 18 },
  { id: 'family', movie: 10751, tv: 10751 },
  { id: 'fantasy', movie: 14, tv: 10765 },
  { id: 'scifi', movie: 878, tv: 10765 },
  { id: 'history', movie: 36, tv: 0 },
  { id: 'horror', movie: 27, tv: 0 },
  { id: 'music', movie: 10402, tv: 0 },
  { id: 'mystery', movie: 9648, tv: 9648 },
  { id: 'romance', movie: 10749, tv: 0 },
  { id: 'thriller', movie: 53, tv: 0 },
  { id: 'war', movie: 10752, tv: 10768 },
  { id: 'western', movie: 37, tv: 37 },
  { id: 'kids', movie: 0, tv: 10762 },
  { id: 'reality', movie: 0, tv: 10764 },
  { id: 'talk', movie: 0, tv: 10767 },
  { id: 'news', movie: 0, tv: 10763 },
];

/** Series genres left out unless chosen: talk shows, news, reality. */
export const TV_EXCLUDED = [10767, 10763, 10764];

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

function genreOf(id: string): { id: string; movie: number; tv: number } | null {
  for (let i = 0; i < GENRES.length; i++) if (GENRES[i].id === id) return GENRES[i];
  return null;
}

/** The genres of the kind ('all': every genre). */
export function genresFor(kind: Kind | 'all'): string[] {
  return GENRES.filter((g) => kind === 'all' || g[kind] > 0).map((g) => g.id);
}

function yearOf(v: unknown): number {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= MIN_YEAR && v <= MAX_YEAR ? v : 0;
}

/** Any stored value → a valid query (unknown parts → the defaults). */
export function sanitizeDiscoverQuery(v: unknown): DiscoverQuery {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as { [k: string]: unknown }) : {};
  const sort = DISCOVER_SORTS.indexOf(o.sort as DiscoverSort) >= 0 ? (o.sort as DiscoverSort) : 'popular';
  const genres: string[] = [];
  if (Array.isArray(o.genres))
    (o.genres as unknown[]).forEach((g) => {
      if (typeof g === 'string' && genreOf(g) && genres.indexOf(g) < 0) genres.push(g);
    });
  const year: DiscoverYear = o.year === 'this' || o.year === 'last' || o.year === 'range' ? o.year : 'any';
  let from = year === 'range' ? yearOf(o.from) : 0;
  let to = year === 'range' ? yearOf(o.to) : 0;
  if (from && to && from > to) {
    const x = from;
    from = to;
    to = x;
  }
  const country = typeof o.country === 'string' && DISCOVER_COUNTRIES.indexOf(o.country) >= 0 ? o.country : '';
  const rating = DISCOVER_RATINGS.indexOf(o.rating as number) >= 0 ? (o.rating as number) : 0;
  return { sort: sort, genres: genres, year: year, from: from, to: to, country: country, rating: rating };
}

/** One string per distinct query (the kept feed and the requests key on it). */
export function discoverQueryKey(q: DiscoverQuery): string {
  return [q.sort, q.genres.slice().sort().join(','), q.year, q.from, q.to, q.country, q.rating].join('|');
}

/** «Фильтры · N»: the chosen genres plus one per other set filter. */
export function discoverFilterCount(q: DiscoverQuery): number {
  // «Скоро в цифре» has its own dates: the year filter does not apply and does not count
  const year = q.year !== 'any' && q.sort !== 'digitalSoon';
  return q.genres.length + (year ? 1 : 0) + (q.country ? 1 : 0) + (q.rating ? 1 : 0);
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** 'YYYY-MM-DD' + `days` days (negative: back). */
export function addDays(today: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return today;
  const d = new Date(+m[1], +m[2] - 1, +m[3] + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function nextDay(today: string): string {
  return addDays(today, 1);
}

function uniq(list: number[]): number[] {
  return list.filter((x, i) => x > 0 && list.indexOf(x) === i);
}

/**
 * The /discover/{kind} parameters of the query (page and language are added by the URL builder); null when the kind
 * has none of the chosen genres (that kind gives nothing). `today` is the local 'YYYY-MM-DD'.
 */
export function discoverParams(kind: Kind, q: DiscoverQuery, today: string, region?: string): { [k: string]: string | number } | null {
  const p: { [k: string]: string | number } = { include_adult: 'false' };
  // «Скоро в цифре»: films with a digital release in the region from today up to DIGITAL_SOON_DAYS ahead, soonest first
  if (q.sort === 'digitalSoon' && kind !== 'movie') return null;
  const field = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  const chosen = uniq(q.genres.map((g) => {
    const x = genreOf(g);
    return x ? x[kind] : 0;
  }));
  if (q.genres.length && !chosen.length) return null;
  if (chosen.length) p.with_genres = chosen.join('|');
  if (kind === 'tv') {
    const without = TV_EXCLUDED.filter((id) => chosen.indexOf(id) < 0);
    if (without.length) p.without_genres = without.join(',');
  }

  let votes = 0;
  if (q.sort === 'digitalSoon') {
    p.with_release_type = 4;
    p.region = region || 'RU';
    // release_date.* (not primary_release_date.*) is the date of the region and release type asked: sort on it. The
    // client sorts each page again by that date anyway (another region's page is merged in), so a TMDB that ignored
    // this sort (popularity.desc then) would still give dated pages in order
    p.sort_by = 'release_date.asc';
    p['release_date.gte'] = today;
    p['release_date.lte'] = addDays(today, DIGITAL_SOON_DAYS);
    if (q.rating) {
      p['vote_average.gte'] = q.rating;
      p['vote_count.gte'] = 50;
    }
    if (q.country) p.with_origin_country = q.country;
    return p;
  }
  if (q.sort === 'popular' || q.sort === 'upcoming') p.sort_by = 'popularity.desc';
  else if (q.sort === 'rating') {
    p.sort_by = 'vote_average.desc';
    votes = kind === 'movie' ? 200 : 100;
  } else {
    p.sort_by = field + '.desc';
    // the newest titles nobody has rated are noise
    votes = kind === 'movie' ? 20 : 10;
  }
  if (q.rating) {
    p['vote_average.gte'] = q.rating;
    if (votes < 50) votes = 50;
  }
  if (votes) p['vote_count.gte'] = votes;

  // the dates: the year filter, then what the sort needs (released up to today / not yet out)
  const thisYear = +today.slice(0, 4) || new Date().getFullYear();
  let gte = '';
  let lte = '';
  if (q.year === 'this' || q.year === 'last') {
    const y = q.year === 'this' ? thisYear : thisYear - 1;
    gte = y + '-01-01';
    lte = y + '-12-31';
  } else if (q.year === 'range') {
    if (q.from) gte = q.from + '-01-01';
    if (q.to) lte = q.to + '-12-31';
  }
  if (q.sort === 'date' && (!lte || lte > today)) lte = today;
  if (q.sort === 'upcoming') {
    const tomorrow = nextDay(today);
    if (!gte || gte < tomorrow) gte = tomorrow;
  }
  if (gte) p[field + '.gte'] = gte;
  if (lte) p[field + '.lte'] = lte;

  if (q.country) p.with_origin_country = q.country;
  return p;
}

/**
 * «Скоро в цифре»: the films of one page (the region's, plus the next region's when filled) with a known digital date
 * from today up to DIGITAL_SOON_DAYS ahead, soonest first, the more popular first on one day; one entry per film (the
 * first region's date wins). Only within a page: TMDB pages each region on its own, so a later page may hold a date
 * earlier than the last one of the page before (it is appended, never merged into the shown ones).
 */
export function digitalSoonItems(items: CatalogTitle[], today: string): CatalogTitle[] {
  const last = addDays(today, DIGITAL_SOON_DAYS);
  const seen: { [id: number]: boolean } = {};
  const out = items.filter((x) => {
    const d = x.digital;
    if (!d || d < today || d > last || seen[x.id]) return false;
    seen[x.id] = true;
    return true;
  });
  out.sort((a, b) => {
    const da = a.digital as string;
    const db = b.digital as string;
    if (da !== db) return da < db ? -1 : 1;
    return (b.popularity || 0) - (a.popularity || 0) || a.id - b.id;
  });
  return out;
}
