// TMDB v3 for «Обзор»: the endpoint (the active TorrServer's TMDB settings, else OMP's built-in key), URL builders,
// strict sanitizers of the answers and the torrent query rule. Pure; the requests are made by client.ts.
import type { TmdbConfig } from '../api/types';
import { lang } from '../i18n';
import { ru } from '../i18n/ru';
import { discoverParams, type DiscoverQuery } from './discoverQuery';

export type Kind = 'movie' | 'tv';

/**
 * `digital` and `popularity` are set on «Скоро в цифре» items only (see sanitizeList's `dated`): the digital release
 * date TMDB matched in the region ('YYYY-MM-DD') and TMDB's popularity, for the order. Such items have `year` 0: the
 * date of that answer is the regional digital one, not the film's year (the tile takes the year from the card).
 */
export interface CatalogTitle {
  kind: Kind; id: number; title: string; original: string; year: number; poster: string; rating: number;
  digital?: string; popularity?: number;
}
export type PersonJob = 'cast' | 'director' | 'creator';
/** `id`: the TMDB person id (opens the person's filmography); `job`: why the person is on the card. */
export interface Person { id: number; name: string; photo: string; role: string; job: PersonJob; }
/** Actors on a card, after its directors or creators. */
export const CAST_LIMIT = 15;
/** One title of a person's filmography; `roles` are the merged character names (empty for crew credits). */
export interface Credit extends CatalogTitle { roles: string[]; genreIds: number[]; date: string; }
export interface PersonCard {
  id: number; name: string; photo: string; birth: string; death: string;
  /** TMDB's biography, trimmed; '' when TMDB has none in the language (the client may fill it in English). */
  bio: string;
  known: 'acting' | 'directing' | 'other'; acting: Credit[]; directing: Credit[];
}
/** `airDate`: 'YYYY-MM-DD' or '' (absent in cards cached before 0.17.0-beta.2: unknown). */
export interface Season { number: number; episodes: number; year: number; aired: number; airDate?: string; }
/** A series' state, language-neutral: '' when TMDB says nothing known (or a card cached without it). */
export type SeriesStatus = 'returning' | 'ended' | 'canceled' | 'production' | 'planned' | '';
/** TMDB's next_episode_to_air: `airDate` is 'YYYY-MM-DD' or '' when not dated yet. */
export interface NextEpisode { season: number; episode: number; airDate: string; }
/** A film's release dates in the user's region, each 'YYYY-MM-DD' (absent: unknown). */
export interface Releases { theatrical?: string; digital?: string; physical?: string; }
/**
 * `status`, `nextEpisode` and `lastAirDate` are optional: cards cached before 0.17.0-beta.2 have none of them, and
 * missing reads as unknown ('' / null / '').
 */
export interface CatalogCard extends CatalogTitle {
  backdrop: string; genres: string[]; runtime: number; overview: string; cast: Person[]; seasons: Season[]; airing: boolean;
  status?: SeriesStatus; nextEpisode?: NextEpisode | null; lastAirDate?: string;
  /** Films only; absent in film cards cached before 0.17.0-beta.6 (they are fetched again). */
  releases?: Releases;
}
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
export function discoverUrl(e: TmdbEndpoint, kind: Kind, query: DiscoverQuery, page: number, today: string, region?: string): string | null {
  const p = discoverParams(kind, query, today, region || discoverRegion());
  if (!p) return null;
  p.page = page;
  return url(e, 'discover/' + kind, p);
}

export function searchUrl(e: TmdbEndpoint, query: string, page: number): string {
  return url(e, 'search/multi', { query: query, page: page, include_adult: 'false' });
}

export function cardUrl(e: TmdbEndpoint, kind: Kind, id: number): string {
  return url(e, kind + '/' + id, {
    // translations: the English title of a title with no Russian (or Latin) one, in the request made anyway
    append_to_response: kind === 'movie' ? 'credits,release_dates,translations' : 'credits,translations',
    include_image_language: lang.peek() === 'en' ? 'en,null' : 'ru,null,en',
  });
}

/** The regions whose release dates count, in order: the Russian UI takes Russia's and then the US', English the US'. */
export function releaseRegions(uiLang: string = lang.peek()): string[] {
  return uiLang === 'en' ? ['US'] : ['RU', 'US'];
}

/** The TMDB discover region of the UI language. */
export function discoverRegion(uiLang: string = lang.peek()): string {
  return releaseRegions(uiLang)[0];
}

export function personUrl(e: TmdbEndpoint, id: number): string {
  return url(e, 'person/' + id, { append_to_response: 'combined_credits' });
}

/** The plain person in English (no credits): the biography fallback of a person TMDB has no text for in the UI language. */
export function personBioUrl(e: TmdbEndpoint, id: number): string {
  return url(e, 'person/' + id, { language: 'en-US' });
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

// a Latin (with its accented letters) or a Cyrillic letter; built from codes so the source stays ASCII
const READABLE = new RegExp(
  '[A-Za-z' + String.fromCharCode(0xc0) + '-' + String.fromCharCode(0x24f) + String.fromCharCode(0x400) + '-' + String.fromCharCode(0x4ff) + ']',
);

/** The title reads for a Russian or English user: it has Latin or Cyrillic letters (not only Chinese, Korean, …). */
export function readableTitle(s: string): boolean {
  return READABLE.test(s || '');
}

function personOf(e: TmdbEndpoint, x: { [k: string]: unknown }, job: PersonJob, role: string): Person {
  return { id: n(x.id), name: str(x.name), photo: imageUrl(e, x.profile_path, 'w185'), role: role, job: job };
}

function titleOf(e: TmdbEndpoint, o: { [k: string]: unknown }, kind: Kind): CatalogTitle | null {
  const id = n(o.id);
  if (!id) return null;
  let title = str(kind === 'movie' ? o.title : o.name);
  const original = str(kind === 'movie' ? o.original_title : o.original_name);
  if (!title && !original) return null;
  // no Russian title: TMDB gives the original («仙逆剧场版»); an original in Latin letters reads better
  if (!readableTitle(title) && readableTitle(original)) title = original;
  return {
    kind: kind, id: id, title: title || original, original: original || title,
    year: year(kind === 'movie' ? o.release_date : o.first_air_date),
    poster: imageUrl(e, o.poster_path, 'w300'),
    rating: Math.round(n(o.vote_average) * 10) / 10,
  };
}

/**
 * A TMDB list answer. `dated`: a /discover answer asked with region + with_release_type, whose release_date is «the
 * first date based on your query» (TMDB's discover docs), i.e. the regional date of that release type: it is kept as
 * `digital` and is not the film's year.
 */
export function sanitizeList(e: TmdbEndpoint, raw: unknown, kind: Kind | null, dated?: boolean): { items: CatalogTitle[]; pages: number } {
  const o = raw && typeof raw === 'object' ? (raw as { [k: string]: unknown }) : null;
  if (!o || !Array.isArray(o.results)) return { items: [], pages: 0 };
  const items: CatalogTitle[] = [];
  (o.results as unknown[]).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const x = r as { [k: string]: unknown };
    const k: Kind | null = kind || (x.media_type === 'movie' ? 'movie' : x.media_type === 'tv' ? 'tv' : null);
    if (!k) return;
    const t = titleOf(e, x, k);
    if (!t) return;
    if (dated) {
      t.digital = date(str(x.release_date).slice(0, 10));
      t.popularity = n(x.popularity);
      t.year = 0;
    }
    items.push(t);
  });
  return { items: items, pages: Math.min(500, Math.max(0, Math.floor(n(o.total_pages)))) };
}

/** The en title of a card answer's translations (en-US first); '' when there is none or it is not readable. */
export function englishTitle(o: { [k: string]: unknown }, kind: Kind): string {
  const tr = o.translations && typeof o.translations === 'object' ? (o.translations as { translations?: unknown }).translations : null;
  if (!Array.isArray(tr)) return '';
  let best = '';
  (tr as unknown[]).forEach((x) => {
    const r = (x || {}) as { [k: string]: unknown };
    if (r.iso_639_1 !== 'en') return;
    const d = (r.data || {}) as { [k: string]: unknown };
    const s = str(kind === 'movie' ? d.title : d.name);
    if (!s || !readableTitle(s)) return;
    if (!best || r.iso_3166_1 === 'US') best = s;
  });
  return best;
}

export function sanitizeCard(e: TmdbEndpoint, raw: unknown, kind: Kind): CatalogCard | null {
  const o = raw && typeof raw === 'object' ? (raw as { [k: string]: unknown }) : null;
  if (!o) return null;
  const t = titleOf(e, o, kind);
  if (!t) return null;
  // still not readable: the English translation of the same answer (append_to_response=translations)
  if (!readableTitle(t.title)) {
    const en = englishTitle(o, kind);
    if (en) t.title = en;
  }
  const genres = Array.isArray(o.genres) ? (o.genres as unknown[]).map((g) => str(g && (g as { name?: unknown }).name)).filter(Boolean) : [];
  const runtimes = Array.isArray(o.episode_run_time) ? (o.episode_run_time as unknown[]).map(n).filter(Boolean) : [];
  const credits = o.credits && typeof o.credits === 'object' ? (o.credits as { [k: string]: unknown }) : {};
  const eachObj = (list: unknown, f: (x: { [k: string]: unknown }) => void) => {
    if (Array.isArray(list)) (list as unknown[]).forEach((c) => { if (c && typeof c === 'object') f(c as { [k: string]: unknown }); });
  };
  const valid = (p: Person) => !!p.name && p.id > 0;
  // directors (films) or creators (series) first, then the actors
  const heads: Person[] = [];
  const addHead = (x: { [k: string]: unknown }, job: PersonJob) => {
    const p = personOf(e, x, job, '');
    if (valid(p) && !heads.some((h) => h.id === p.id)) heads.push(p);
  };
  if (kind === 'movie') eachObj(credits.crew, (x) => { if (x.job === 'Director') addHead(x, 'director'); });
  else eachObj(o.created_by, (x) => addHead(x, 'creator'));
  const actors: Person[] = [];
  eachObj(credits.cast, (x) => { actors.push(personOf(e, x, 'cast', str(x.character))); });
  const cast: Person[] = heads.concat(actors.filter(valid).slice(0, CAST_LIMIT));
  const last = o.last_episode_to_air && typeof o.last_episode_to_air === 'object' ? (o.last_episode_to_air as { [k: string]: unknown }) : null;
  const lastSeason = last ? n(last.season_number) : 0;
  const lastEp = last ? n(last.episode_number) : 0;
  const seasons: Season[] = kind === 'tv' && Array.isArray(o.seasons)
    ? (o.seasons as unknown[]).map((s) => {
        const x = (s || {}) as { [k: string]: unknown };
        const num = n(x.season_number);
        const eps = n(x.episode_count);
        return {
          number: num, episodes: eps, year: year(x.air_date), aired: num < lastSeason ? eps : num === lastSeason ? Math.min(eps, lastEp) : 0,
          airDate: date(x.air_date),
        };
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
    status: kind === 'tv' ? statusOf(o.status) : '',
    nextEpisode: kind === 'tv' ? nextEpisodeOf(o.next_episode_to_air) : null,
    lastAirDate: kind === 'tv' ? date(o.last_air_date) : '',
    releases: kind === 'movie' ? releasesOf(o.release_dates, releaseRegions()) : undefined,
  };
}

/** An appearance as oneself (TMDB character «Self», «Himself - Host», «(archive footage)» ...): not a role, left out of the filmography. */
function isSelfRole(character: string): boolean {
  const c = character.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  if (/^(self|himself|herself|themselves|камео|в роли самого себя|в роли самой себя)$/.test(c)) return true;
  return /^(self|himself|herself)\s*-/.test(c);
}

/** The biography of a plain person answer (personBioUrl): '' when absent. */
export function sanitizePersonBio(raw: unknown): string {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? str((raw as { [k: string]: unknown }).biography) : '';
}

/** A person with the filmography: combined_credits' cast as acting, crew directors (and series creators) as directing. */
export function sanitizePerson(e: TmdbEndpoint, raw: unknown): PersonCard | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { [k: string]: unknown }) : null;
  if (!o) return null;
  const id = n(o.id);
  const name = str(o.name);
  if (id <= 0 || !name) return null;
  const cc = o.combined_credits && typeof o.combined_credits === 'object' ? (o.combined_credits as { [k: string]: unknown }) : {};
  // `take`: the role of the credit ('' for crew), null to skip it
  const collect = (list: unknown, take: (x: { [k: string]: unknown }, kind: Kind) => string | null): Credit[] => {
    const out: Credit[] = [];
    const byKey: { [k: string]: Credit } = {};
    if (!Array.isArray(list)) return out;
    (list as unknown[]).forEach((r) => {
      const x = r && typeof r === 'object' ? (r as { [k: string]: unknown }) : null;
      const kind: Kind | null = x ? (x.media_type === 'movie' ? 'movie' : x.media_type === 'tv' ? 'tv' : null) : null;
      if (!x || !kind) return;
      const role = take(x, kind);
      if (role === null) return;
      const t = titleOf(e, x, kind);
      if (!t) return;
      const key = kind + ':' + t.id;
      let c = byKey[key];
      if (!c) {
        c = {
          ...t, popularity: n(x.popularity), roles: [], date: date(kind === 'movie' ? x.release_date : x.first_air_date),
          genreIds: Array.isArray(x.genre_ids) ? (x.genre_ids as unknown[]).filter((g): g is number => typeof g === 'number') : [],
        };
        byKey[key] = c;
        out.push(c);
      }
      if (role && c.roles.indexOf(role) < 0) c.roles.push(role);
    });
    return out;
  };
  const dept = str(o.known_for_department);
  return {
    id: id, name: name, photo: imageUrl(e, o.profile_path, 'w300'), birth: date(o.birthday), death: date(o.deathday),
    bio: str(o.biography),
    known: dept === 'Acting' ? 'acting' : dept === 'Directing' ? 'directing' : 'other',
    acting: collect(cc.cast, (x) => { const ch = str(x.character); return isSelfRole(ch) ? null : ch; }),
    directing: collect(cc.crew, (x, kind) => (x.job === 'Director' || (kind === 'tv' && x.job === 'Creator') ? '' : null)),
  };
}

/** The earliest date of each TMDB release type in one region's list. */
function regionDates(list: unknown): { [type: number]: string } {
  const out: { [type: number]: string } = {};
  if (!Array.isArray(list)) return out;
  (list as unknown[]).forEach((r) => {
    const x = r && typeof r === 'object' ? (r as { [k: string]: unknown }) : null;
    if (!x) return;
    const type = Math.floor(n(x.type));
    const d = date(str(x.release_date).slice(0, 10));
    if (!type || !d) return;
    if (!out[type] || d < out[type]) out[type] = d;
  });
  return out;
}

/**
 * A film's release dates (TMDB release_dates: 3 theatrical, 2 limited when there is no 3, 4 digital, 5 physical):
 * each date from the first of `regions` that has it; the earliest date of a type within a region.
 */
export function releasesOf(raw: unknown, regions: string[]): Releases {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { [k: string]: unknown }) : null;
  const results = o && Array.isArray(o.results) ? (o.results as unknown[]) : [];
  const byRegion: { [code: string]: { [type: number]: string } } = {};
  results.forEach((r) => {
    const x = r && typeof r === 'object' ? (r as { [k: string]: unknown }) : null;
    const code = x ? str(x.iso_3166_1).toUpperCase() : '';
    if (x && code && regions.indexOf(code) >= 0) byRegion[code] = regionDates(x.release_dates);
  });
  const out: Releases = {};
  const pick = (types: number[]): string => {
    for (let i = 0; i < regions.length; i++) {
      const d = byRegion[regions[i]];
      if (!d) continue;
      for (let j = 0; j < types.length; j++) if (d[types[j]]) return d[types[j]];
    }
    return '';
  };
  // a region's limited release stands for its theatrical one only when it has none
  let theatrical = '';
  for (let i = 0; i < regions.length && !theatrical; i++) {
    const d = byRegion[regions[i]];
    if (d) theatrical = d[3] || d[2] || '';
  }
  const digital = pick([4]);
  const physical = pick([5]);
  if (theatrical) out.theatrical = theatrical;
  if (digital) out.digital = digital;
  if (physical) out.physical = physical;
  return out;
}

const STATUSES: { [k: string]: SeriesStatus } = {
  'returning series': 'returning',
  ended: 'ended',
  canceled: 'canceled',
  cancelled: 'canceled',
  'in production': 'production',
  planned: 'planned',
  pilot: 'planned',
};

/** TMDB's status of a series as a code; '' for anything else. */
export function statusOf(v: unknown): SeriesStatus {
  const k = str(v).toLowerCase().replace(/\s+/g, ' ');
  return Object.prototype.hasOwnProperty.call(STATUSES, k) ? STATUSES[k] : '';
}

/** next_episode_to_air: null unless it has a season and an episode number (whole, positive, sane). */
export function nextEpisodeOf(v: unknown): NextEpisode | null {
  const x = v && typeof v === 'object' && !Array.isArray(v) ? (v as { [k: string]: unknown }) : null;
  if (!x) return null;
  const season = Math.floor(n(x.season_number));
  const episode = Math.floor(n(x.episode_number));
  if (season <= 0 || season > 1000 || episode <= 0 || episode > 10000) return null;
  return { season: season, episode: episode, airDate: date(x.air_date) };
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
