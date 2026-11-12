// Voice-over of one season. A series-wide choice (omp.a) is the default of every season until that season
// stores its own (omp.as). A priority list (omp.ap) picks the first studio the season actually has.
import { t } from '../i18n';
import { withOmp } from './journal';
import { newestSeriesTracks, sameDub, seriesTracksOf } from './seriesTracks';

export interface SeasonVoiceRec {
  at: number;
  l: string;
  m?: true;
}

export interface VoiceBag {
  seasons: { [n: number]: SeasonVoiceRec };
  priority: string[];
  seriesStudio: string;
}

function isObj(v: unknown): v is { [k: string]: unknown } {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function bagOf(data: string | undefined): { seasons: { [n: number]: SeasonVoiceRec }; priority: string[]; priorityAt: number; tracksAt: number; studio: string } {
  const empty = { seasons: {}, priority: [] as string[], priorityAt: 0, tracksAt: 0, studio: '' };
  if (!data) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (e) {
    return empty;
  }
  if (!isObj(parsed)) return empty;
  const omp = parsed.omp;
  if (!isObj(omp)) return empty;
  const seasons: { [n: number]: SeasonVoiceRec } = {};
  if (isObj(omp.as)) {
    const bag = omp.as;
    Object.keys(bag).forEach((k) => {
      const n = +k;
      const row = bag[k];
      if (!n || !isObj(row) || typeof row.l !== 'string' || typeof row.at !== 'number') return;
      const rec: SeasonVoiceRec = { at: row.at, l: row.l };
      if (row.m === true) rec.m = true;
      seasons[n] = rec;
    });
  }
  const tracks = seriesTracksOf(data);
  const priority = omp.ap instanceof Array ? omp.ap.filter((x) => typeof x === 'string' && x) as string[] : [];
  const priorityAt = typeof omp.apt === 'number' ? omp.apt : 0;
  return { seasons, priority, priorityAt, tracksAt: tracks ? tracks.at : 0, studio: tracks && tracks.l ? tracks.l : '' };
}

/** The newest season choices, priority list and series-wide studio across the torrents. */
export function readVoice(list: (string | undefined | null)[]): VoiceBag {
  const seasons: { [n: number]: SeasonVoiceRec } = {};
  let priority: string[] = [];
  let priorityAt = 0;
  let studio = '';
  let studioAt = 0;
  list.forEach((data) => {
    if (!data) return;
    const bag = bagOf(data);
    Object.keys(bag.seasons).forEach((k) => {
      const n = +k;
      const prev = seasons[n];
      if (!prev || bag.seasons[n].at >= prev.at) seasons[n] = bag.seasons[n];
    });
    if (bag.priority.length && bag.priorityAt >= priorityAt) {
      priority = bag.priority;
      priorityAt = bag.priorityAt;
    }
    if (bag.studio && bag.tracksAt >= studioAt) {
      studio = bag.studio;
      studioAt = bag.tracksAt;
    }
  });
  return { seasons, priority, seriesStudio: studio };
}

export function withSeasonVoice(
  obj: { [k: string]: unknown },
  season: number,
  rec: SeasonVoiceRec,
  priority?: string[],
): { [k: string]: unknown } {
  return withOmp(obj, (omp) => {
    const prev = isObj(omp.as) ? { ...(omp.as as { [k: string]: unknown }) } : {};
    const row: { [k: string]: unknown } = { at: rec.at, l: rec.l };
    if (rec.m) row.m = true;
    prev[String(season)] = row;
    omp.as = prev;
    if (priority) {
      omp.ap = priority.slice();
      omp.apt = rec.at;
    }
  });
}

function hasStudio(available: string[], studio: string): boolean {
  return !!studio && available.some((s) => sameDub(s, studio));
}

export interface SeasonPick {
  studio: string;
  source: 'manual' | 'priority' | 'series' | 'fallback' | 'none';
  toast: string;
}

/** Which studio this season plays. A missing inherited studio falls back and explains itself. */
export function pickSeasonVoice(opts: {
  season: number;
  available: string[];
  data: (string | undefined | null)[];
  priority?: string[];
}): SeasonPick {
  const bag = readVoice(opts.data);
  const priority = opts.priority !== undefined ? opts.priority : bag.priority;
  const own = bag.seasons[opts.season];
  if (own && own.l && (!opts.available.length || hasStudio(opts.available, own.l))) {
    return { studio: own.l, source: 'manual', toast: '' };
  }
  for (let i = 0; i < priority.length; i++) {
    if (hasStudio(opts.available, priority[i])) return { studio: priority[i], source: 'priority', toast: '' };
  }
  if (bag.seriesStudio && (!opts.available.length || hasStudio(opts.available, bag.seriesStudio))) {
    return { studio: bag.seriesStudio, source: 'series', toast: '' };
  }
  if (opts.available.length) {
    const picked = opts.available[0];
    const missing = bag.seriesStudio || (priority[0] || '');
    const toast = missing ? t('series.dubMissing', { n: opts.season, studio: missing, picked }) : '';
    return { studio: picked, source: 'fallback', toast };
  }
  return { studio: '', source: 'none', toast: '' };
}

/**
 * The studio playback should use for one season of a torrent. A manual season choice wins over the
 * newer series-wide record, so season 1 does not inherit season 2's later pick.
 */
export function playbackStudio(data: (string | undefined | null)[], season: number): string {
  if (!(season > 0)) return '';
  const bag = readVoice(data);
  const own = bag.seasons[season];
  return own && own.l ? own.l : '';
}

/** True when this season's studio is not the one the others share. */
export function voiceDiffers(studio: string, others: string[]): boolean {
  const rest = others.filter((s) => !!s);
  if (!studio || !rest.length) return false;
  return rest.some((s) => !sameDub(s, studio));
}

/** Studios remembered on these torrents (the choices a season can offer). */
export function studiosOf(list: { data?: string | null | undefined }[]): string[] {
  const rec = newestSeriesTracks(list.map((m) => ({ data: m.data || undefined })));
  const out: string[] = [];
  const push = (l: string | undefined) => {
    if (!l || out.some((x) => sameDub(x, l))) return;
    out.push(l);
  };
  if (rec) {
    push(rec.l);
    (rec.k || []).forEach((s) => push(s.l));
  }
  list.forEach((m) => {
    const own = m.data ? seriesTracksOf(m.data) : null;
    if (!own) return;
    push(own.l);
    (own.k || []).forEach((s) => push(s.l));
  });
  return out;
}
