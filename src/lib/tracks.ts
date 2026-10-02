import type { FfprobeResult } from '../api/types';

const LANG: { [k: string]: string } = {
  ru: 'ru', rus: 'ru', russian: 'ru', 'русский': 'ru',
  en: 'en', eng: 'en', english: 'en', 'английский': 'en',
  uk: 'uk', ukr: 'uk', ukrainian: 'uk', 'украинский': 'uk',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  es: 'es', spa: 'es', spanish: 'es',
  it: 'it', ita: 'it', italian: 'it',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
  ko: 'ko', kor: 'ko', korean: 'ko',
  und: '',
};

export const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'ja', label: '日本語' },
];

export function normalizeLang(s?: string): string {
  if (!s) return '';
  const k = s.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(LANG, k)) return LANG[k];
  return k.split(/[-_]/)[0].slice(0, 2);
}

export function guessLangFromName(name: string): string {
  const tokens = name.toLowerCase().split(/[ ._\-()[\]]+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(LANG, tokens[i]) && LANG[tokens[i]]) return LANG[tokens[i]];
  }
  return '';
}

export interface TrackInfo {
  index: number;
  kind: 'audio' | 'subtitle';
  codec: string;
  language: string;
  title: string;
  channels?: number;
  isDefault: boolean;
  forced: boolean;
}

export function tracksFromProbe(probe: FfprobeResult | null): TrackInfo[] {
  if (!probe) return [];
  const counters = { audio: 0, subtitle: 0 };
  const out: TrackInfo[] = [];
  probe.streams.forEach((s) => {
    if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') return;
    const kind = s.codec_type as 'audio' | 'subtitle';
    const tags = s.tags || {};
    const disp = s.disposition || {};
    out.push({
      index: counters[kind]++,
      kind,
      codec: s.codec_name || '',
      language: normalizeLang(tags.language),
      title: tags.title || '',
      channels: s.channels,
      isDefault: disp.default === 1,
      forced: disp.forced === 1,
    });
  });
  return out;
}

function channelLabel(n?: number): string {
  if (!n) return '';
  if (n === 1) return 'mono';
  if (n === 2) return '2.0';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return n + 'ch';
}

export function describeTrack(t: TrackInfo): string {
  const codec = (t.codec.toUpperCase() + ' ' + channelLabel(t.channels)).trim();
  return [t.language.toUpperCase(), codec, t.title].filter(Boolean).join(' · ');
}

export function findLang(tracks: { language: string }[], lang: string): number {
  if (!lang) return -1;
  for (let i = 0; i < tracks.length; i++) if (normalizeLang(tracks[i].language) === lang) return i;
  return -1;
}

export function pickTrack(tracks: { language: string; isDefault?: boolean }[], preferred: string): number {
  if (!tracks.length) return -1;
  const byLang = findLang(tracks, preferred);
  if (byLang >= 0) return byLang;
  for (let i = 0; i < tracks.length; i++) if (tracks[i].isDefault) return i;
  return 0;
}
