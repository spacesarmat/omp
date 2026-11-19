// Filters of search results by what a release title says (resolution, HDR, source, camrip, voice-over, subtitles,
// seasons) plus size and seeds. A title that says nothing about a group passes that group, except "hide camrips"
// and "full season only", which drop only titles that carry their marks. Shared by the phone and the TV:
// Chromium 53 rules.
import { t } from '../i18n';
import { parseEpisodeRange } from '../monitor/episodes';
import type { ParsedQuery } from './queryParse';

export type Res = 720 | 1080 | 2160 | 0;
export type Source = 'web' | 'bdrip' | 'remux';
export type Voice = 'dub' | 'mvo' | 'original';

export interface ReleaseInfo {
  res: Res;
  hdr: boolean;
  source: Source | '';
  cam: boolean;
  dub: boolean;
  mvo: boolean;
  original: boolean;
  rusSubs: boolean;
  seasons: number[];
  /** «Complete series» / «все сезоны»: every season, so a season filter keeps it. */
  allSeasons: boolean;
  episodes: { from: number; to: number; of: number } | null;
}

/** How a release relates to the asked episode. `pack` is a full season that includes it. */
export type EpisodeRole = 'episode' | 'pack' | 'other' | 'unknown';

export interface SearchFilters {
  res: Res[];
  hdr: boolean;
  source: Source[];
  hideCam: boolean;
  minGb: number;
  maxGb: number;
  minSeeds: number;
  voice: Voice[];
  rusSubs: boolean;
  season: number;
  /** Season 0 (specials). `season` stays 0, which also means «no season chosen». */
  specials: boolean;
  fullSeason: boolean;
  /** 1900-2099 taken from the query, or 0. */
  year: number;
  /** One episode taken from the query, or 0. */
  episode: number;
}

export const NO_FILTERS: SearchFilters = {
  res: [], hdr: false, source: [], hideCam: false, minGb: 0, maxGb: 0, minSeeds: 0, voice: [], rusSubs: false, season: 0, specials: false, fullSeason: false,
  year: 0, episode: 0,
};

function resOf(s: string): Res {
  if (/(^|[^0-9a-z])(2160[pi]?|4k|uhd)([^0-9a-z]|$)/i.test(s)) return 2160;
  if (/(^|[^0-9a-z])(1080[pi]?|fhdr|fhd|full[ .]?hd)([^0-9a-z]|$)/i.test(s)) return 1080;
  if (/(^|[^0-9a-z])720[pi]([^0-9a-z]|$)/i.test(s)) return 720;
  // Bare HD is 720p. HDR, FHD, FHDR, HDTV and HDRip fail the boundary after "hd".
  if (/(^|[^0-9a-z])hd([^0-9a-z]|$)/i.test(s)) return 720;
  return 0;
}

function sourceOf(s: string): Source | '' {
  if (/remux/i.test(s)) return 'remux';
  if (/web-?dl|web-?rip|webrip/i.test(s)) return 'web';
  if (/bd-?rip|bdrip|blu-?ray|hdrip/i.test(s)) return 'bdrip';
  return '';
}

// «Complete series», «all seasons», «все сезоны», «полный сериал» — the pack holds the selected season.
const COMPLETE = /(?:^|[^a-zа-яё])(?:complete[\s._-]+series|all[\s._-]+seasons|все\s+сезоны|полный\s+сериал)(?:[^a-zа-яё]|$)/i;

/** Every season a title names: one number, or each season of a pack («S01-S03», «Сезоны 1-3»). */
function seasonsOf(s: string): number[] {
  const r = parseEpisodeRange(s);
  if (r.season === undefined) return [];
  const last = r.seasonTo !== undefined && r.seasonTo >= r.season ? r.seasonTo : r.season;
  const out: number[] = [];
  for (let i = r.season; i <= last && out.length < 50; i++) out.push(i);
  return out;
}

export function parseRelease(title: string): ReleaseInfo {
  const s = title || '';
  const r = parseEpisodeRange(s);
  const seasons = seasonsOf(s);
  return {
    res: resOf(s),
    hdr: /hdr|dolby\s*vision|(^|[^a-z])dv([^a-z]|$)/i.test(s),
    source: sourceOf(s),
    cam: /camrip|(^|[^a-z])(ts|tc|telesync|telecine|hdts)([^a-z]|$)/i.test(s),
    dub: /дубляж|дублированн|(^|[^a-z])\[?d\]?(\]|$)|(^|\W)dub(\W|$)/i.test(s),
    mvo: /многоголос|(^|[^a-z])mvo([^a-z]|$)/i.test(s),
    original: /оригинал|original|(^|[^a-z])eng([^a-z]|$)/i.test(s),
    rusSubs: /sub\s*rus|rus\s*sub|русские\s*субтитры|субтитры/i.test(s),
    seasons,
    allSeasons: !seasons.length && COMPLETE.test(s),
    episodes: r.from !== undefined && r.to !== undefined && r.total !== undefined ? { from: r.from, to: r.to, of: r.total } : null,
  };
}

const RES: Res[] = [720, 1080, 2160];
const SOURCES: Source[] = ['web', 'bdrip', 'remux'];
const VOICES: Voice[] = ['dub', 'mvo', 'original'];

function listOf<T>(v: unknown, allowed: T[]): T[] {
  return Array.isArray(v) ? allowed.filter((a) => v.indexOf(a) >= 0) : [];
}

function num(v: unknown, max: number): number {
  return typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(v, max) : 0;
}

export function sanitizeFilters(v: unknown): SearchFilters {
  const o = v && typeof v === 'object' ? (v as { [k: string]: unknown }) : {};
  return {
    res: listOf(o.res, RES),
    hdr: o.hdr === true,
    source: listOf(o.source, SOURCES),
    hideCam: o.hideCam === true,
    minGb: num(o.minGb, 1000),
    maxGb: num(o.maxGb, 1000),
    minSeeds: num(o.minSeeds, 100000),
    voice: listOf(o.voice, VOICES),
    rusSubs: o.rusSubs === true,
    season: Math.floor(num(o.season, 99)),
    specials: o.specials === true,
    fullSeason: o.fullSeason === true,
    year: yearNum(o.year),
    episode: epNum(o.episode),
  };
}

function yearNum(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0;
  return n >= 1900 && n <= 2099 ? n : 0;
}

function epNum(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0;
  return n >= 1 && n <= 999 ? n : 0;
}

/**
 * A release against an asked episode.
 * `episode` - this file (or a partial pack) contains it.
 * `pack` - a full season that includes it, with no single-episode cut.
 * `other` - a different episode or a different season.
 * `unknown` - the title names neither.
 */
export function episodeRole(title: string, season: number, episode: number): EpisodeRole {
  if (!episode) return 'unknown';
  const info = parseRelease(title);
  const range = parseEpisodeRange(title);
  if (season && info.seasons.length && info.seasons.indexOf(season) < 0 && !info.allSeasons) return 'other';
  if (range.from !== undefined && range.to !== undefined) {
    if (episode < range.from || episode > range.to) return 'other';
    const full = range.from === 1 && range.total !== undefined && range.to >= range.total;
    return full ? 'pack' : 'episode';
  }
  if (info.allSeasons || info.seasons.length) return 'pack';
  return 'unknown';
}

/** Groups with a choice (each counts once): the "Filters · N" chip. */
export function activeFilterCount(f: SearchFilters): number {
  return filterChips(f).length;
}

const SOURCE_LABEL: { [k: string]: string } = { web: 'WEB-DL', bdrip: 'BDRip', remux: 'Remux' };

function voiceLabel(v: Voice): string {
  return v === 'dub' ? t('filters.dub') : v === 'mvo' ? t('filters.mvo') : t('filters.original');
}

/** Short labels of the active groups, in the sheet's order. */
export function filterChips(f: SearchFilters): string[] {
  const out: string[] = [];
  if (f.res.length) out.push(f.res.map((r) => (r === 2160 ? '4K' : r + 'p')).join(', '));
  if (f.hdr) out.push('HDR');
  if (f.source.length) out.push(f.source.map((s) => SOURCE_LABEL[s]).join(', '));
  if (f.hideCam) out.push(t('filters.noCam'));
  if (f.minGb || f.maxGb) {
    out.push((f.minGb ? t('filters.from') + ' ' + f.minGb + ' ' : '') + (f.maxGb ? t('filters.to') + ' ' + f.maxGb + ' ' : '') + t('common.gb'));
  }
  if (f.minSeeds) out.push(t('filters.seeds', { n: f.minSeeds }));
  if (f.voice.length) out.push(f.voice.map(voiceLabel).join(', '));
  if (f.rusSubs) out.push(t('filters.rusSubs'));
  if (f.year) out.push(t('filters.year', { n: f.year }));
  if (f.specials) out.push(t('library.season', { n: 0 }));
  else if (f.season) out.push(t('filters.season', { n: f.season }));
  if (f.episode) out.push(t('filters.episode', { n: f.episode }));
  if (f.fullSeason) out.push(t('filters.fullSeason'));
  return out;
}

export interface FilterChip {
  key: string;
  label: string;
}

/** Active filters as chips the person can remove. Same order as filterChips. */
export function filterChipList(f: SearchFilters): FilterChip[] {
  const labels = filterChips(f);
  const keys: string[] = [];
  if (f.res.length) keys.push('res');
  if (f.hdr) keys.push('hdr');
  if (f.source.length) keys.push('source');
  if (f.hideCam) keys.push('hideCam');
  if (f.minGb || f.maxGb) keys.push('size');
  if (f.minSeeds) keys.push('seeds');
  if (f.voice.length) keys.push('voice');
  if (f.rusSubs) keys.push('rusSubs');
  if (f.year) keys.push('year');
  if (f.specials) keys.push('specials');
  else if (f.season) keys.push('season');
  if (f.episode) keys.push('episode');
  if (f.fullSeason) keys.push('fullSeason');
  const out: FilterChip[] = [];
  for (let i = 0; i < keys.length; i++) out.push({ key: keys[i], label: labels[i] || keys[i] });
  return out;
}

/** The filters with one chip turned off. */
export function clearFilterChip(f: SearchFilters, key: string): SearchFilters {
  if (key === 'res') return { ...f, res: [] };
  if (key === 'hdr') return { ...f, hdr: false };
  if (key === 'source') return { ...f, source: [] };
  if (key === 'hideCam') return { ...f, hideCam: false };
  if (key === 'size') return { ...f, minGb: 0, maxGb: 0 };
  if (key === 'seeds') return { ...f, minSeeds: 0 };
  if (key === 'voice') return { ...f, voice: [] };
  if (key === 'rusSubs') return { ...f, rusSubs: false };
  if (key === 'year') return { ...f, year: 0 };
  if (key === 'specials') return { ...f, specials: false };
  if (key === 'season') return { ...f, season: 0 };
  if (key === 'episode') return { ...f, episode: 0 };
  if (key === 'fullSeason') return { ...f, fullSeason: false };
  return f;
}

/** Quality means resolution and HDR. Voice-over includes Russian subtitles. */
export function relaxFilters(f: SearchFilters, what: 'year' | 'quality' | 'voice'): SearchFilters {
  if (what === 'year') return { ...f, year: 0 };
  if (what === 'quality') return { ...f, res: [], hdr: false };
  return { ...f, voice: [], rusSubs: false };
}

export function qualityFiltered(f: SearchFilters): boolean {
  return f.res.length > 0 || f.hdr;
}

export function voiceFiltered(f: SearchFilters): boolean {
  return f.voice.length > 0 || f.rusSubs;
}

/**
 * Parsed year, season and episode become chips.
 * A new search replaces the year. A season or episode stays only when the person set it
 * and the previous query did not.
 */
export function applyParsedFilters(f: SearchFilters, parsed: ParsedQuery, prev: ParsedQuery | null): SearchFilters {
  const season = parsed.season ? parsed.season : prev && f.season === prev.season ? 0 : f.season;
  const episode = parsed.episode ? parsed.episode : prev && f.episode === prev.episode ? 0 : f.episode;
  const specials = parsed.season ? false : f.specials;
  return { ...f, year: parsed.year, season: season, episode: episode, specials: specials };
}

/**
 * What is stored between app launches. Year, season and episode taken from the query are not stored:
 * after a restart they would look like a choice made in the sheet and hide other releases.
 */
export function filtersForStorage(f: SearchFilters, parsed: ParsedQuery): SearchFilters {
  return {
    ...f,
    year: parsed.year && f.year === parsed.year ? 0 : f.year,
    season: parsed.season && f.season === parsed.season ? 0 : f.season,
    episode: parsed.episode && f.episode === parsed.episode ? 0 : f.episode,
  };
}

function sizeGb(r: { sizeBytes?: number }): number {
  return r.sizeBytes ? r.sizeBytes / (1024 * 1024 * 1024) : 0;
}

export function applyFilters<T extends { Title: string; Seed: number; sizeBytes?: number }>(list: T[], f: SearchFilters): T[] {
  return list.filter((r) => {
    const i = parseRelease(r.Title);
    if (f.res.length && i.res && f.res.indexOf(i.res) < 0) return false;
    if (f.hdr && !i.hdr) return false;
    if (f.source.length && i.source && f.source.indexOf(i.source) < 0) return false;
    if (f.hideCam && i.cam) return false;
    const gb = sizeGb(r);
    if (gb && f.minGb && gb < f.minGb) return false;
    if (gb && f.maxGb && gb > f.maxGb) return false;
    if (f.minSeeds && (r.Seed || 0) < f.minSeeds) return false;
    if (f.voice.length && (i.dub || i.mvo || i.original)) {
      const ok = (f.voice.indexOf('dub') >= 0 && i.dub) || (f.voice.indexOf('mvo') >= 0 && i.mvo) || (f.voice.indexOf('original') >= 0 && i.original);
      if (!ok) return false;
    }
    if (f.rusSubs && !i.rusSubs) return false;
    // a named season set must include the choice; a pack («S01-S03», «1-3 сезоны») and «Complete series» stay;
    // a title with no season stays (sorted below the matches)
    const want = f.specials ? 0 : f.season;
    if ((f.specials || f.season) && !i.allSeasons && i.seasons.length && i.seasons.indexOf(want) < 0) return false;
    // an asked episode keeps the file that has it and the full-season pack that includes it
    if (f.episode && episodeRole(r.Title, want, f.episode) === 'other') return false;
    if (f.fullSeason && i.episodes && (i.episodes.from > 1 || i.episodes.to < i.episodes.of)) return false;
    return true;
  });
}

/** With a season chosen, titles that never name a season go under the ones that match. Order inside each part stays. Specials use season 0, which is otherwise «no season». */
export function sinkUnknownSeasons<T extends { Title: string }>(list: T[], season: number, specials = false): T[] {
  if (!season && !specials) return list;
  const known: T[] = [];
  const unknown: T[] = [];
  for (let i = 0; i < list.length; i++) {
    const info = parseRelease(list[i].Title);
    if (info.seasons.length || info.allSeasons) known.push(list[i]);
    else unknown.push(list[i]);
  }
  return known.concat(unknown);
}

/** The subscription quality the filters imply: the lowest chosen resolution ('' = any). */
export function subQualityOf(f: SearchFilters): '' | '720' | '1080' | '2160' {
  if (!f.res.length) return '';
  const min = f.res.reduce((a, b) => (b < a ? b : a));
  return (String(min) as '720' | '1080' | '2160');
}
