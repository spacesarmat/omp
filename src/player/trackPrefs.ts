import type { TrackPref } from '../store/trackPrefs';
import type { TrackOption } from './trackOptions';
import type { ExternalSub } from './types';
import { defaultSubChoice } from './trackOptions';
import { pickTrack, findLang, guessLangFromName } from '../lib/tracks';
import { dubOf, findDub, isReset, sameDub, seenDubs, type SeriesSub, type SeriesTracks } from '../lib/seriesTracks';

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

/** The per-torrent choice still counts: no series record, or one that says something (not a reset). */
function torrentPrefCounts(series: SeriesTracks | null, pref: TrackPref | null): TrackPref | null {
  return series && isReset(series) ? null : pref;
}

/**
 * The audio track to start with: the series' dub by label, then this torrent's own choice (label, language), then the
 * series' language, then the settings. A reset of the series («по умолчанию») drops the torrent's choice too.
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

/** The subtitles to start with: the series' choice (off, title, language), else the torrent's, else the settings. */
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
  if (want && want.l) {
    const e = findDub(embedded, want.l);
    if (e >= 0) return 'e' + e;
    for (let i = 0; i < external.length; i++) if (sameDub(external[i].label, want.l)) return 'x' + i;
  }
  const own = torrentPrefCounts(series, pref);
  if (own && own.sub) return pickSub(embedded, external, own, s);
  if (want && want.g) return defaultSubChoice(embedded, external, { subtitlesOn: true, subLang: want.g });
  return defaultSubChoice(embedded, external, s);
}

/** The series' subtitles record of a menu choice: off, or the track's title (file name) and language. */
export function seriesSubFromChoice(choice: string, embedded: TrackOption[], external: ExternalSub[]): 'off' | SeriesSub {
  if (choice === 'off') return 'off';
  const n = +choice.slice(1);
  if (choice.charAt(0) === 'e' && embedded[n]) return { l: dubOf(embedded[n]), g: embedded[n].language || '' };
  if (choice.charAt(0) === 'x' && external[n]) return { l: external[n].label, g: guessLangFromName(external[n].label) };
  return 'off';
}

/** The series' audio record of a menu choice: the dub label, the language and the dubs this file has. */
export function seriesAudioFromChoice(audio: TrackOption[], i: number): { l: string; g: string; k: SeriesSub[] } {
  const a = audio[i];
  return { l: a ? dubOf(a) : '', g: a ? a.language || '' : '', k: seenDubs(audio) };
}

/** What the native player starts with (playNative): languages, subtitles on/off and the dub / subtitle titles to prefer. */
export interface NativeTrackStart {
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  dubLabel?: string;
  subLabel?: string;
}

/**
 * The start options of the native player from the series' record and the torrent's own choice (the same order as
 * pickAudioFor / pickSubFor: the player picks by title first, then by language).
 */
export function nativeTrackStart(
  series: SeriesTracks | null,
  pref: TrackPref | null,
  s: { audioLang: string; subLang: string; subtitlesOn: boolean },
): NativeTrackStart {
  const own = torrentPrefCounts(series, pref);
  const out: NativeTrackStart = { audioLang: s.audioLang, subLang: s.subLang, subtitlesOn: s.subtitlesOn };
  const dub = (series && series.l) || (own && own.audioLabel ? dubOf({ label: own.audioLabel }) : '');
  if (dub) out.dubLabel = dub;
  const lang = (series && series.g) || (own && own.audioLang) || '';
  if (lang) out.audioLang = lang;
  const sub: 'off' | SeriesSub | null =
    series && series.s ? series.s : own && own.sub ? (own.sub === 'off' ? 'off' : { l: own.sub.label, g: own.sub.lang }) : null;
  if (sub === 'off') out.subtitlesOn = false;
  else if (sub) {
    out.subtitlesOn = true;
    if (sub.g) out.subLang = sub.g;
    if (sub.l) out.subLabel = sub.l;
  }
  return out;
}
