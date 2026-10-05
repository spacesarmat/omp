// TMDB v3 for «Обзор»: the endpoint (the active TorrServer's TMDB settings, else OMP's built-in key), URL builders,
// strict sanitizers of the answers and the torrent query rule. Pure; the requests are made by client.ts.
import type { TmdbConfig } from '../api/types';
import { lang } from '../i18n';
import { ru } from '../i18n/ru';
import { discoverParams, type DiscoverQuery } from './discoverQuery';

export type Kind = 'movie' | 'tv';

export interface CatalogTitle { kind: Kind; id: number; title: string; original: string; year: number; poster: string; rating: number; }
export interface Person { name: string; photo: string; role: string; }
export interface Season { number: number; episodes: number; year: number; aired: number; }
export interface CatalogCard extends CatalogTitle { backdrop: string; genres: string[]; runtime: number; overview: string; cast: Person[]; seasons: Season[]; airing: boolean; }
export interface TmdbEndpoint { base: string; key: string; images: string; }
export interface Episode { n: number; title: string; airDate: string; runtime: number; overview: string; }
export interface SeasonDetails { number: number; name: string; airDate: string; overview: string; episodes: Episode[]; }

function withScheme(u: string | undefined, dflt: string): string {
  const s = (u || '').trim().replace(/\/+$/, '');
  if (!s) return dflt;
  return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/\//, '');
}

export function endpointOf(cfg: TmdbConfig | null, fallbackKey: string): TmdbEndpoint | null {
  const own = cfg && cfg.APIKey ? cfg.APIKey : '';
  const key = own || fallbackKey;
  if (!key) return null;
  const api = own ? withScheme(cfg!.APIURL, 'https://api.themoviedb.org') : 'https://api.themoviedb.org';
  const root = api.replace(/\/3(\/.*)?$/, '');
  const images = own ? withScheme(cfg!.ImageURLRu || cfg!.ImageURL, 'https://imagetmdb.com') : 'https://imagetmdb.com';
  return { base: root + '/3/', key: key, images: images };
}

function q(params: { [k: string]: string | number }): string {
  return Object.keys(params).map((k) => k + '=' + encodeURIComponent(String(params[k]))).join('&');
}

function url(e: TmdbEndpoint, path: string, params: { [k: string]: string | number }): string {
  const p: { [k: string]: string | number } = { api_key: e.key, language: lang.peek() === 'en' ? 'en-US' : 'ru-RU' };
  Object.keys(params).forEach((k) => { p[k] = params[k]; });
  return e.base + path + '?' + q(p);
}

export function noveltiesUrl(e: TmdbEndpoint, kind: Kind, page: number, today: string): string {
  if (kind === 'tv') return url(e, 'tv/on_the_air', { page: page, region: 'RU' });
  return url(e, 'discover/movie', {
    page: page, region: 'RU', with_release_type: 4, 'release_date.lte': today, sort_by: 'primary_release_date.desc', 'vote_count.gte': 20,
  });
}

/** «Обзор» with its sort and filters: /discover/{kind}; null when the kind has none of the chosen genres. */
export function discoverUrl(e: TmdbEndpoint, kind: Kind, query: DiscoverQuery, page: number, today: string): string | null {
  const p = discoverParams(kind, query, today);
  if (!p) return null;
  p.page = page;
  return url(e, 'discover/' + kind, p);
}

export function searchUrl(e: TmdbEndpoint, query: string, page: number): string {
  return url(e, 'search/multi', { query: query, page: page, include_adult: 'false' });
}

export function cardUrl(e: TmdbEndpoint, kind: Kind, id: number): string {
  return url(e, kind + '/' + id, { append_to_response: 'credits', include_image_language: lang.peek() === 'en' ? 'en,null' : 'ru,null,en' });
}

export function seasonUrl(e: TmdbEndpoint, id: number, season: number): string {
  return url(e, 'tv/' + id + '/season/' + season, {});
}

export function imageUrl(e: TmdbEndpoint, path: unknown, size: 'w300' | 'w780' | 'w185'): string {
  if (typeof path !== 'string' || !/^\/?[A-Za-z0-9_.-]+$/.test(path)) return '';
  return e.images + '/t/p/' + size + (path.charAt(0) === '/' ? path : '/' + path);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function year(v: unknown): number {
  const m = /^(\d{4})/.exec(str(v));
  return m ? +m[1] : 0;
}

function n(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function titleOf(e: TmdbEndpoint, o: { [k: string]: unknown }, kind: Kind): CatalogTitle | null {
  const id = n(o.id);
  if (!id) return null;
  const title = str(kind === 'movie' ? o.title : o.name);
  const original = str(kind === 'movie' ? o.original_title : o.original_name);
  if (!title && !original) return null;
  return {
    kind: kind, id: id, title: title || original, original: original || title,
    year: year(kind === 'movie' ? o.release_date : o.first_air_date),
    poster: imageUrl(e, o.poster_path, 'w300'),
    rating: Math.round(n(o.vote_average) * 10) / 10,
  };
}

export function sanitizeList(e: TmdbEndpoint, raw: unknown, kind: Kind | null): { items: CatalogTitle[]; pages: number } {
  const o = raw && typeof raw === 'object' ? (raw as { [k: string]: unknown }) : null;
  if (!o || !Array.isArray(o.results)) return { items: [], pages: 0 };
  const items: CatalogTitle[] = [];
  (o.results as unknown[]).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const x = r as { [k: string]: unknown };
    const k: Kind | null = kind || (x.media_type === 'movie' ? 'movie' : x.media_type === 'tv' ? 'tv' : null);
    if (!k) return;
    const t = titleOf(e, x, k);
    if (t) items.push(t);
  });
  return { items: items, pages: Math.min(500, Math.max(0, Math.floor(n(o.total_pages)))) };
}

export function sanitizeCard(e: TmdbEndpoint, raw: unknown, kind: Kind): CatalogCard | null {
  const o = raw && typeof raw === 'object' ? (raw as { [k: string]: unknown }) : null;
  if (!o) return null;
  const t = titleOf(e, o, kind);
  if (!t) return null;
  const genres = Array.isArray(o.genres) ? (o.genres as unknown[]).map((g) => str(g && (g as { name?: unknown }).name)).filter(Boolean) : [];
  const runtimes = Array.isArray(o.episode_run_time) ? (o.episode_run_time as unknown[]).map(n).filter(Boolean) : [];
  const credits = o.credits && typeof o.credits === 'object' ? (o.credits as { cast?: unknown }).cast : null;
  const cast: Person[] = Array.isArray(credits)
    ? (credits as unknown[]).slice(0, 8).map((c) => {
        const x = (c || {}) as { [k: string]: unknown };
        return { name: str(x.name), photo: imageUrl(e, x.profile_path, 'w185'), role: str(x.character) };
      }).filter((p) => !!p.name)
    : [];
  const last = o.last_episode_to_air && typeof o.last_episode_to_air === 'object' ? (o.last_episode_to_air as { [k: string]: unknown }) : null;
  const lastSeason = last ? n(last.season_number) : 0;
  const lastEp = last ? n(last.episode_number) : 0;
  const seasons: Season[] = kind === 'tv' && Array.isArray(o.seasons)
    ? (o.seasons as unknown[]).map((s) => {
        const x = (s || {}) as { [k: string]: unknown };
        const num = n(x.season_number);
        const eps = n(x.episode_count);
        return { number: num, episodes: eps, year: year(x.air_date), aired: num < lastSeason ? eps : num === lastSeason ? Math.min(eps, lastEp) : 0 };
      }).filter((s) => s.number > 0).sort((a, b) => b.number - a.number)
    : [];
  return {
    kind: t.kind, id: t.id, title: t.title, original: t.original, year: t.year, poster: t.poster, rating: t.rating,
    backdrop: imageUrl(e, o.backdrop_path, 'w780'),
    genres: genres,
    runtime: kind === 'movie' ? n(o.runtime) : runtimes.length ? runtimes[0] : 0,
    overview: str(o.overview),
    cast: cast,
    seasons: seasons,
    airing: kind === 'tv' && (o.in_production === true || !!o.next_episode_to_air),
  };
}

/** The text trimmed and cut to `max` characters. */
function text(v: unknown, max: number): string {
  const s = str(v);
  return s.length > max ? s.slice(0, max).replace(/\s+$/, '') : s;
}

/** 'YYYY-MM-DD' or ''. */
function date(v: unknown): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

const MAX_EPISODES = 200;

/**
 * A season of a series (TMDB tv/{id}/season/{n}): its name, date, overview and up to 200 episodes in order.
 * `season` is the asked number, used when the answer has none; null for a non-object or an error body.
 */
export function sanitizeSeason(raw: unknown, season: number): SeasonDetails | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { [k: string]: unknown }) : null;
  if (!o || o.success === false) return null;
  const own = o.season_number;
  const num = typeof own === 'number' && isFinite(own) && own >= 0 ? Math.floor(own) : season;
  const episodes: Episode[] = [];
  const list = Array.isArray(o.episodes) ? (o.episodes as unknown[]) : [];
  for (let i = 0; i < list.length && episodes.length < MAX_EPISODES; i++) {
    const x = list[i] && typeof list[i] === 'object' ? (list[i] as { [k: string]: unknown }) : null;
    if (!x) continue;
    const en = Math.floor(n(x.episode_number));
    if (en <= 0) continue;
    const rt = Math.round(n(x.runtime));
    episodes.push({
      n: en,
      title: text(x.name, 200),
      airDate: date(x.air_date),
      runtime: rt > 0 && rt < 1000 ? rt : 0,
      overview: text(x.overview, 1500),
    });
  }
  episodes.sort((a, b) => a.n - b.n);
  return { number: num, name: text(o.name, 100), airDate: date(o.air_date), overview: text(o.overview, 1500), episodes: episodes };
}

// The season word is a search query for Russian trackers, not UI copy: it stays Russian even in the English UI.
export function torrentQuery(t: { title: string; original: string; year: number; kind: Kind }, season?: number): string {
  const name = t.title || t.original;
  if (t.kind === 'tv') return season ? name + ' ' + ru.catalog.querySeason.replace('{n}', String(season)) : name;
  return t.year ? name + ' ' + t.year : name;
}
