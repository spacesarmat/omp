import type { TrackPref } from '../store/trackPrefs';
import type { TrackOption } from './trackOptions';
import type { ExternalSub } from './types';
import { defaultSubChoice } from './trackOptions';
import { pickTrack, findLang, guessLangFromName } from '../lib/tracks';

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
