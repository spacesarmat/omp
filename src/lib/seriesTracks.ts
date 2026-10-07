// The default dub of a series («Озвучка»): the audio track (and subtitles) last picked by hand in a player, remembered
// for every season and torrent of the series. Kept in the watch journal of the torrent being played (`omp.a`, see
// src/lib/journal.ts), so the TV and the phone share it; the series' record is the newest one among its torrents.
// A record without l / g / s is a reset («по умолчанию»): the newest one wins like any other. Pure.
import { normalizeLang } from './tracks';
import { JOURNAL_KEY, parseData } from './journal';

export interface SeriesSub {
  /** Track title (or subtitle file name). */
  l: string;
  /** Language code, '' when unknown. */
  g: string;
}

export interface SeriesTracks {
  /** Unix ms of the choice (the newest record of the series wins). */
  at: number;
  /** Dub label: the audio track's own title («LostFilm», «HDrezka Studio»). */
  l?: string;
  /** Audio language code («ru»). */
  g?: string;
  /** Subtitles: off, or a track by title + language. */
  s?: 'off' | SeriesSub;
  /** Dubs seen in the series' files (the choices on the series screen), newest first. */
  k?: SeriesSub[];
}

export type SeriesTracksPatch = { l?: string; g?: string; s?: 'off' | SeriesSub; k?: SeriesSub[] } | 'reset';

export const LABEL_MAX = 80;
export const SEEN_MAX = 12;

function isObj(v: unknown): v is { [k: string]: unknown } {
  return !!v && typeof v === 'object' && !(v instanceof Array);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, LABEL_MAX) : '';
}

function sub(v: unknown): SeriesSub | null {
  if (!isObj(v)) return null;
  const l = str(v.l);
  const g = str(v.g);
  return l || g ? { l, g } : null;
}

/** A stored record, or null when absent or malformed (no time). */
export function sanitizeSeriesTracks(v: unknown): SeriesTracks | null {
  if (!isObj(v)) return null;
  const at = typeof v.at === 'number' && isFinite(v.at) && v.at > 0 ? v.at : 0;
  if (!at) return null;
  const out: SeriesTracks = { at };
  const l = str(v.l);
  const g = str(v.g);
  if (l) out.l = l;
  if (g) out.g = g;
  if (v.s === 'off') out.s = 'off';
  else {
    const s = sub(v.s);
    if (s) out.s = s;
  }
  if (v.k instanceof Array) {
    const k: SeriesSub[] = [];
    v.k.forEach((x) => {
      const s = sub(x);
      if (s && s.l && !k.some((y) => sameDub(y.l, s.l))) k.push(s);
    });
    if (k.length) out.k = k.slice(0, SEEN_MAX);
  }
  return out;
}

/** The record of one torrent's data (`omp.a`); null when there is none. */
export function seriesTracksOf(data: string | undefined | null): SeriesTracks | null {
  const p = parseData(data);
  const o = p ? p.obj[JOURNAL_KEY] : null;
  return isObj(o) ? sanitizeSeriesTracks(o.a) : null;
}

/** The series' record: the newest one among its torrents; null when none has one. */
export function newestSeriesTracks(members: { data?: string }[]): SeriesTracks | null {
  let best: SeriesTracks | null = null;
  members.forEach((m) => {
    const r = m ? seriesTracksOf(m.data) : null;
    if (r && (!best || r.at > best.at)) best = r;
  });
  return best;
}

/** The record says «по умолчанию»: a reset (or nothing chosen). */
export function isReset(r: SeriesTracks | null): boolean {
  return !!r && !r.l && !r.g && !r.s;
}

/** Seen dubs merged: `add` first, no duplicates (by label), at most SEEN_MAX. */
export function mergeSeen(add: SeriesSub[] | undefined, old: SeriesSub[] | undefined): SeriesSub[] {
  const out: SeriesSub[] = [];
  (add || []).concat(old || []).forEach((s) => {
    if (s && s.l && !out.some((y) => sameDub(y.l, s.l))) out.push({ l: s.l.slice(0, LABEL_MAX), g: s.g || '' });
  });
  return out.slice(0, SEEN_MAX);
}

/**
 * The next record of the series from its current one: an audio choice keeps the subtitles and vice versa; a reset drops
 * both. The seen dubs are kept (and the chosen one added).
 */
export function nextSeriesTracks(base: SeriesTracks | null, patch: SeriesTracksPatch, now: number): SeriesTracks {
  const out: SeriesTracks = { at: now };
  const seenAdd: SeriesSub[] = [];
  if (patch !== 'reset') {
    const audio = patch.l !== undefined || patch.g !== undefined;
    const l = audio ? str(patch.l) : base && base.l ? base.l : '';
    const g = audio ? str(patch.g) : base && base.g ? base.g : '';
    if (l) out.l = l;
    if (g) out.g = g;
    const s = patch.s !== undefined ? patch.s : base ? base.s : undefined;
    if (s) out.s = s;
    if (audio && l) seenAdd.push({ l, g });
    if (patch.k) patch.k.forEach((x) => seenAdd.push(x));
  }
  const k = mergeSeen(seenAdd, base ? base.k : undefined);
  if (k.length) out.k = k;
  return out;
}

/** A copy of `obj` with omp.a set to `rec`; write it with serializeData (which keeps `a`). */
export function withSeriesTracks(obj: { [k: string]: unknown }, rec: SeriesTracks): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isObj(old) ? { ...old } : { v: 1, h: [] };
  omp.a = rec;
  out[JOURNAL_KEY] = omp;
  return out;
}

// ---- dub labels ----

/** A dub label for comparing: lowercase, ё → е, punctuation and spacing collapsed. */
export function normDub(s: string | undefined | null): string {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, String.fromCharCode(0x435))
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim();
}

/**
 * Two dub labels name the same dub: equal once normalised, or the shorter one (3+ characters) is a whole-word part of
 * the longer one («LostFilm» ~ «MVO | LostFilm», «HDrezka Studio» ~ «hdrezka studio 18+»).
 */
export function sameDub(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normDub(a);
  const y = normDub(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (short.length < 3) return false;
  return (' ' + long + ' ').indexOf(' ' + short + ' ') >= 0;
}

const CODEC = /^(?:e-?ac-?3|ac-?3|aac|dts(?:-?hd)?(?: ma)?|truehd|flac|opus|mp3|mp2|pcm|vorbis|atmos|ddp?(?:\+)?|dd)(?:\s+(?:\d\.\d|mono|stereo|\d+ch))?$/i;
const CHANNELS = /^(?:\d\.\d|mono|stereo|\d+ch)$/i;

function isLangWord(s: string): boolean {
  const k = s.toLowerCase().trim();
  return LANG_WORD.test(k);
}

const LANG_WORD = /^(?:русский|английский|украинский|немецкий|французский|испанский|итальянский|японский|китайский|корейский|english|russian|ukrainian|german|french|spanish|italian|japanese|chinese|korean|deutsch|français|español|українська|日本語|und|ru|en|uk|de|fr|es|it|ja|zh|ko|rus|eng|ukr|ger|deu|fre|fra|spa|ita|jpn|chi|zho|kor)$/;

/**
 * The dub of a track: its own title when known, else the label without the language and codec parts
 * («Русский · LostFilm · AC3 2.0» → «LostFilm», «RU · AC3 2.0 · HDrezka Studio» → «HDrezka Studio»); '' when nothing is left.
 */
export function dubOf(track: { title?: string; label?: string }): string {
  const own = (track.title || '').trim();
  if (own) return own.slice(0, LABEL_MAX);
  const label = (track.label || '').replace(/\s*\([a-z]{2,3}\)\s*$/i, '');
  const parts = label.split(/\s+·\s+/).map((p) => p.trim()).filter((p) => p && !isLangWord(p) && !CODEC.test(p) && !CHANNELS.test(p));
  return parts.join(' · ').slice(0, LABEL_MAX);
}

/** Index of the track with the dub `label`; -1 when none. */
export function findDub(tracks: { title?: string; label?: string }[], label: string | undefined): number {
  if (!label) return -1;
  for (let i = 0; i < tracks.length; i++) if (sameDub(dubOf(tracks[i]), label)) return i;
  return -1;
}

/** The seen dubs of a track list (label + language), for the series screen's choices. */
export function seenDubs(tracks: { title?: string; label?: string; language?: string }[]): SeriesSub[] {
  return mergeSeen(
    tracks.map((t) => ({ l: dubOf(t), g: normalizeLang(t.language) })),
    undefined,
  );
}
