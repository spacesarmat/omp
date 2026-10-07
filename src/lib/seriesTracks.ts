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
  /**
   * The series was reset («По умолчанию») once: the torrents' own older choices (src/store/trackPrefs.ts) no longer
   * count, also after a later choice of only audio or only subtitles. Kept by every later record.
   */
  x?: true;
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
  const l = titleText(v.l);
  const g = str(v.g);
  return l || g ? { l, g } : null;
}

/** A stored record, or null when absent or malformed (no time). */
export function sanitizeSeriesTracks(v: unknown): SeriesTracks | null {
  if (!isObj(v)) return null;
  const at = typeof v.at === 'number' && isFinite(v.at) && v.at > 0 ? v.at : 0;
  if (!at) return null;
  const out: SeriesTracks = { at };
  const l = titleText(v.l);
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
  if (v.x === true) out.x = true;
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

/** The torrents' own choices still count: no record, or one made before any reset of the series. */
export function torrentChoicesCount(r: SeriesTracks | null): boolean {
  return !r || (!r.x && !isReset(r));
}

/** The record says «по умолчанию»: a reset (or nothing chosen). */
export function isReset(r: SeriesTracks | null): boolean {
  return !!r && !r.l && !r.g && !r.s;
}

/** Seen dubs merged: `add` first, no duplicates (by label), at most SEEN_MAX. */
export function mergeSeen(add: SeriesSub[] | undefined, old: SeriesSub[] | undefined): SeriesSub[] {
  const out: SeriesSub[] = [];
  (add || []).concat(old || []).forEach((s) => {
    const l = s ? titleText(s.l) : '';
    if (l && !out.some((y) => sameDub(y.l, l))) out.push({ l, g: s.g || '' });
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
    const l = audio ? titleText(patch.l) : base && base.l ? base.l : '';
    const g = audio ? str(patch.g) : base && base.g ? base.g : '';
    if (l) out.l = l;
    if (g) out.g = g;
    const s0 = patch.s !== undefined ? patch.s : base ? base.s : undefined;
    const s = s0 && s0 !== 'off' ? sub(s0) : s0;
    if (s) out.s = s;
    if (audio && l) seenAdd.push({ l, g });
    if (patch.k) patch.k.forEach((x) => seenAdd.push(x));
  }
  const k = mergeSeen(seenAdd, base ? base.k : undefined);
  if (k.length) out.k = k;
  if (patch === 'reset' || (base && base.x)) out.x = true;
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

/** Audio / subtitle codec, format and channel words: a title made only of them names no dub. */
const CODEC_WORD = /^(?:aac|he|lc|ac3|eac3|ec3|e|ac|dts|hd|ma|es|x|truehd|thd|mlp|flac|alac|opus|mp3|mp2|mpeg|lpcm|pcm|pcm_[a-z0-9_]+|vorbis|atmos|dd|ddp|dd\+|wma|wmapro|amr|subrip|srt|ass|ssa|pgs|hdmv_pgs_subtitle|sup|vobsub|dvd_subtitle|dvdsub|dvb_subtitle|dvb_sub|dvbsub|dvb_teletext|webvtt|vtt|tx3g|mov_text|text|eia_608|cc|mono|stereo|surround|\d\.\d|\d+ch|\d+(?:k|kbps)|\d+(?:hz|khz)|\d+bit)$/;

/**
 * The text is only codec / format names (and channels): «SUBRIP», «PCM_S16LE 2.0», «AC3 5.1», «DTS-HD MA» — no dub.
 * Such a text is never stored as a dub or subtitle title nor offered on the series screen.
 */
export function isCodecLabel(s: string | undefined | null): boolean {
  const words = (s || '').toLowerCase().split(/[\s·|/,()\-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => CODEC_WORD.test(w));
}

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
  if (own) return isCodecLabel(own) ? '' : own.slice(0, LABEL_MAX);
  const label = (track.label || '').replace(/\s*\([a-z]{2,3}\)\s*$/i, '');
  const parts = label.split(/\s+·\s+/).map((p) => p.trim()).filter((p) => p && !isLangWord(p) && !isCodecLabel(p));
  return parts.join(' · ').slice(0, LABEL_MAX);
}

/** A stored title, or '' when it is only a codec name. */
function titleText(v: unknown): string {
  const s = str(v);
  return isCodecLabel(s) ? '' : s;
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
