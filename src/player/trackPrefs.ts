import type { TrackPref } from '../store/trackPrefs';
import type { TrackOption } from './trackOptions';
import type { ExternalSub } from './types';
import { defaultSubChoice } from './trackOptions';
import { pickTrack, findLang, guessLangFromName, normalizeLang } from '../lib/tracks';
import { dubOf, findDub, sameDub, seenDubs, torrentChoicesCount, type SeriesSub, type SeriesTracks } from '../lib/seriesTracks';

export function pickAudio(audio: TrackOption[], pref: TrackPref | null, fallbackLang: string): number {
  if (pref) {
    if (pref.audioLabel) {
      for (let i = 0; i < audio.length; i++) if (audio[i].label === pref.audioLabel) return i;
    }
    if (pref.audioLang) {
      const i = findLang(audio, pref.audioLang);
      if (i >= 0) return i;
    }
  }
  return pickTrack(audio, fallbackLang);
}

export function pickSub(
  embedded: TrackOption[],
  external: ExternalSub[],
  pref: TrackPref | null,
  s: { subtitlesOn: boolean; subLang: string },
): string {
  if (pref && pref.sub) {
    if (pref.sub === 'off') return 'off';
    const { lang, label } = pref.sub;
    for (let i = 0; i < embedded.length; i++) if (embedded[i].label === label) return 'e' + i;
    for (let i = 0; i < external.length; i++) if (external[i].label === label) return 'x' + i;
    if (lang) {
      const e = findLang(embedded, lang);
      if (e >= 0) return 'e' + e;
      for (let i = 0; i < external.length; i++) if (guessLangFromName(external[i].label) === lang) return 'x' + i;
    }
  }
  return defaultSubChoice(embedded, external, s);
}

export function subPrefFromChoice(
  choice: string,
  embedded: TrackOption[],
  external: ExternalSub[],
): 'off' | { lang: string; label: string } {
  if (choice === 'off') return 'off';
  const n = +choice.slice(1);
  if (choice.charAt(0) === 'e' && embedded[n]) return { lang: embedded[n].language, label: embedded[n].label };
  if (choice.charAt(0) === 'x' && external[n]) return { lang: guessLangFromName(external[n].label), label: external[n].label };
  return 'off';
}

// ---- the series' default dub («Озвучка», src/lib/seriesTracks.ts) ----
// One start order on both players (LG here, Android TV through nativeTrackStart): the series' dub by title → this
// torrent's own remembered choice → the series' language → the settings.

/** The per-torrent choice still counts: no series record, or one made before any reset of the series. */
function torrentPrefCounts(series: SeriesTracks | null, pref: TrackPref | null): TrackPref | null {
  return torrentChoicesCount(series) ? pref : null;
}

function langOk(a: string | undefined, b: string | undefined): boolean {
  return !a || !b || normalizeLang(a) === normalizeLang(b);
}

/**
 * The audio track to start with: the series' dub by label, then this torrent's own choice (label, language), then the
 * series' language, then the settings. A reset of the series («по умолчанию») drops the torrents' older choices.
 */
export function pickAudioFor(audio: TrackOption[], series: SeriesTracks | null, pref: TrackPref | null, fallbackLang: string): number {
  if (!series) return pickAudio(audio, pref, fallbackLang);
  const byDub = findDub(audio, series.l);
  if (byDub >= 0) return byDub;
  const own = torrentPrefCounts(series, pref);
  if (own) {
    if (own.audioLabel) {
      for (let i = 0; i < audio.length; i++) if (audio[i].label === own.audioLabel) return i;
    }
    if (own.audioLang) {
      const i = findLang(audio, own.audioLang);
      if (i >= 0) return i;
    }
  }
  if (series.g) {
    const i = findLang(audio, series.g);
    if (i >= 0) return i;
  }
  return pickTrack(audio, fallbackLang);
}

/**
 * Subtitles titled `want.l` («Надписи», a file name); when both sides know their language it must be the same one
 * («Forced» of another language is another track). '' when none.
 */
function findSubTitled(embedded: TrackOption[], external: ExternalSub[], want: SeriesSub): string {
  if (!want.l) return '';
  for (let i = 0; i < embedded.length; i++) {
    if (sameDub(dubOf(embedded[i]), want.l) && langOk(embedded[i].language, want.g)) return 'e' + i;
  }
  for (let i = 0; i < external.length; i++) {
    if (sameDub(external[i].label, want.l) && langOk(guessLangFromName(external[i].label), want.g)) return 'x' + i;
  }
  return '';
}

/** The subtitles to start with: the series' title (or off), the torrent's choice, the series' language, the settings. */
export function pickSubFor(
  embedded: TrackOption[],
  external: ExternalSub[],
  series: SeriesTracks | null,
  pref: TrackPref | null,
  s: { subtitlesOn: boolean; subLang: string },
): string {
  if (!series) return pickSub(embedded, external, pref, s);
  const want = series.s;
  if (want === 'off') return 'off';
  if (want) {
    const hit = findSubTitled(embedded, external, want);
    if (hit) return hit;
  }
  const own = torrentPrefCounts(series, pref);
  if (own && own.sub) {
    if (own.sub === 'off') return 'off';
    const { lang, label } = own.sub;
    for (let i = 0; i < embedded.length; i++) if (embedded[i].label === label) return 'e' + i;
    for (let i = 0; i < external.length; i++) if (external[i].label === label) return 'x' + i;
    if (lang) {
      const e = findLang(embedded, lang);
      if (e >= 0) return 'e' + e;
      for (let i = 0; i < external.length; i++) if (guessLangFromName(external[i].label) === lang) return 'x' + i;
    }
  }
  if (want && want.g) {
    const c = defaultSubChoice(embedded, external, { subtitlesOn: true, subLang: normalizeLang(want.g) });
    if (c !== 'off') return c;
  }
  return defaultSubChoice(embedded, external, s);
}

/** The series' subtitles record of a menu choice: off, or the track's title (none when only a codec) and language. */
export function seriesSubFromChoice(choice: string, embedded: TrackOption[], external: ExternalSub[]): 'off' | SeriesSub {
  if (choice === 'off') return 'off';
  const n = +choice.slice(1);
  if (choice.charAt(0) === 'e' && embedded[n]) return { l: dubOf(embedded[n]), g: embedded[n].language || '' };
  if (choice.charAt(0) === 'x' && external[n]) return { l: external[n].label, g: guessLangFromName(external[n].label) };
  return 'off';
}

/** The series' audio record of a menu choice: the dub label (none when only a codec), the language, the file's dubs. */
export function seriesAudioFromChoice(audio: TrackOption[], i: number): { l: string; g: string; k: SeriesSub[] } {
  const a = audio[i];
  return { l: a ? dubOf(a) : '', g: a ? a.language || '' : '', k: seenDubs(audio) };
}

/**
 * One step of the native player's start order: a track by title (`l`, with `g` its language when known), else by
 * language (`g` alone); `off: true` turns the subtitles off.
 */
export interface NativeTrackPick {
  l?: string;
  g?: string;
  off?: true;
}

/** What the native player starts with (playNative): languages and subtitles on/off for the engine, and the start order. */
export interface NativeTrackStart {
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  audioPick?: NativeTrackPick[];
  subPick?: NativeTrackPick[];
}

/**
 * The start options of the native player: the same order as pickAudioFor / pickSubFor on LG, as a list the player
 * walks on every item (the first step that finds a track wins; the settings close it). The engine's own language
 * preference is the first language of the list.
 */
export function nativeTrackStart(
  series: SeriesTracks | null,
  pref: TrackPref | null,
  s: { audioLang: string; subLang: string; subtitlesOn: boolean },
): NativeTrackStart {
  const own = torrentPrefCounts(series, pref);
  const out: NativeTrackStart = { audioLang: s.audioLang, subLang: s.subLang, subtitlesOn: s.subtitlesOn };

  const audio: NativeTrackPick[] = [];
  if (series && series.l) audio.push({ l: series.l });
  const ownDub = own && own.audioLabel ? dubOf({ label: own.audioLabel }) : '';
  if (ownDub) audio.push({ l: ownDub });
  if (own && own.audioLang) audio.push({ g: own.audioLang });
  if (series && series.g) audio.push({ g: series.g });
  if (audio.length) {
    audio.push({ g: s.audioLang });
    out.audioPick = audio;
    const lang = audio.filter((p) => !!p.g)[0];
    out.audioLang = lang && lang.g ? lang.g : s.audioLang;
  }

  const subs: NativeTrackPick[] = [];
  const want = series ? series.s : undefined;
  if (want === 'off') subs.push({ off: true });
  else {
    if (want && want.l) subs.push(want.g ? { l: want.l, g: want.g } : { l: want.l });
    const o = own ? own.sub : undefined;
    if (o === 'off') subs.push({ off: true });
    else if (o) {
      const l = dubOf({ label: o.label });
      if (l) subs.push(o.lang ? { l, g: o.lang } : { l });
      if (o.lang) subs.push({ g: o.lang });
    }
    if (want && want.g) subs.push({ g: want.g });
  }
  if (subs.length) {
    subs.push(s.subtitlesOn ? { g: s.subLang } : { off: true });
    out.subPick = subs;
    out.subtitlesOn = !subs[0].off;
    const g = subs.filter((p) => !!p.g)[0];
    if (g && g.g) out.subLang = g.g;
  }
  return out;
}
