// Filters of search results by what a release title says (resolution, HDR, source, camrip, voice-over, subtitles,
// seasons) plus size and seeds. A title that says nothing about a group passes that group, except "hide camrips"
// and "full season only", which drop only titles that carry their marks. Shared by the phone and the TV:
// Chromium 53 rules.
import { t } from '../i18n';

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
  episodes: { from: number; to: number; of: number } | null;
}

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
  fullSeason: boolean;
}

export const NO_FILTERS: SearchFilters = {
  res: [], hdr: false, source: [], hideCam: false, minGb: 0, maxGb: 0, minSeeds: 0, voice: [], rusSubs: false, season: 0, fullSeason: false,
};

function resOf(s: string): Res {
  if (/(^|[^0-9a-z])(2160[pi]?|4k|uhd)([^0-9a-z]|$)/i.test(s)) return 2160;
  if (/(^|[^0-9])1080[pi]/i.test(s)) return 1080;
  if (/(^|[^0-9])720p/i.test(s)) return 720;
  return 0;
}

function sourceOf(s: string): Source | '' {
  if (/remux/i.test(s)) return 'remux';
  if (/web-?dl|web-?rip|webrip/i.test(s)) return 'web';
  if (/bd-?rip|bdrip|blu-?ray|hdrip/i.test(s)) return 'bdrip';
  return '';
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b && out.length < 50; i++) out.push(i);
  return out;
}

function seasonsOf(s: string): number[] {
  let m = /сезоны?:?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/i.exec(s);
  if (m) return range(+m[1], +m[2]);
  m = /сезон:?\s*(\d{1,2})/i.exec(s) || /(\d{1,2})\s*сезон/i.exec(s) || /(?:^|[^a-z])s(\d{1,2})(?:e\d{1,3})?(?:[^0-9]|$)/i.exec(s);
  return m ? [+m[1]] : [];
}

export function parseRelease(title: string): ReleaseInfo {
  const s = title || '';
  const ep = /серии:?\s*(\d{1,4})\s*[-–]\s*(\d{1,4})\s*из\s*(\d{1,4})/i.exec(s);
  return {
    res: resOf(s),
    hdr: /hdr|dolby\s*vision|(^|[^a-z])dv([^a-z]|$)/i.test(s),
    source: sourceOf(s),
    cam: /camrip|(^|[^a-z])(ts|tc|telesync|telecine|hdts)([^a-z]|$)/i.test(s),
    dub: /дубляж|дублированн|(^|[^a-z])\[?d\]?(\]|$)|(^|\W)dub(\W|$)/i.test(s),
    mvo: /многоголос|(^|[^a-z])mvo([^a-z]|$)/i.test(s),
    original: /оригинал|original|(^|[^a-z])eng([^a-z]|$)/i.test(s),
    rusSubs: /sub\s*rus|rus\s*sub|русские\s*субтитры|субтитры/i.test(s),
    seasons: seasonsOf(s),
    episodes: ep ? { from: +ep[1], to: +ep[2], of: +ep[3] } : null,
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
    fullSeason: o.fullSeason === true,
  };
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
    out.push((f.minGb ? t('filters.from') + ' ' + f.minGb + ' ' : '') + (f.maxGb ? t('filters.to') + ' ' + f.maxGb + ' ' : '') + t('filters.gb'));
  }
  if (f.minSeeds) out.push(t('filters.seeds', { n: f.minSeeds }));
  if (f.voice.length) out.push(f.voice.map(voiceLabel).join(', '));
  if (f.rusSubs) out.push(t('filters.rusSubs'));
  if (f.season) out.push(t('filters.season', { n: f.season }));
  if (f.fullSeason) out.push(t('filters.fullSeason'));
  return out;
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
    if (f.season && i.seasons.length && i.seasons.indexOf(f.season) < 0) return false;
    if (f.fullSeason && i.episodes && (i.episodes.from > 1 || i.episodes.to < i.episodes.of)) return false;
    return true;
  });
}

/** The subscription quality the filters imply: the lowest chosen resolution ('' = any). */
export function subQualityOf(f: SearchFilters): '' | '720' | '1080' | '2160' {
  if (!f.res.length) return '';
  const min = f.res.reduce((a, b) => (b < a ? b : a));
  return (String(min) as '720' | '1080' | '2160');
}
