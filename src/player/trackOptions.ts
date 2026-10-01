import type { FfprobeResult } from '../api/types';
import { tracksFromProbe, describeTrack, normalizeLang, findLang, guessLangFromName } from '../lib/tracks';
import { audioTrackList, textTrackList } from '../platform/webosMedia';
import type { ExternalSub } from './types';

export interface TrackOption {
  label: string;
  language: string;
  isDefault: boolean;
}

function fromProbe(probe: FfprobeResult | null, kind: 'audio' | 'subtitle'): TrackOption[] {
  return tracksFromProbe(probe)
    .filter((t) => t.kind === kind)
    .map((t) => ({ label: describeTrack(t), language: t.language, isDefault: t.isDefault }));
}

function fromVideo(list: { language: string; label: string }[]): TrackOption[] {
  return list.map((t) => ({
    label: t.label + (t.language ? ' (' + t.language + ')' : ''),
    language: normalizeLang(t.language),
    isDefault: false,
  }));
}

export function audioOptions(probe: FfprobeResult | null, video: HTMLVideoElement | null): TrackOption[] {
  const p = fromProbe(probe, 'audio');
  if (p.length) return p;
  return video ? fromVideo(audioTrackList(video)) : [];
}

export function embeddedSubOptions(probe: FfprobeResult | null, video: HTMLVideoElement | null): TrackOption[] {
  const p = fromProbe(probe, 'subtitle');
  if (p.length) return p;
  return video ? fromVideo(textTrackList(video)) : [];
}

export function defaultAudioIndex(options: TrackOption[]): number {
  for (let i = 0; i < options.length; i++) if (options[i].isDefault) return i;
  return 0;
}

export function subtitleMenu(embedded: TrackOption[], external: ExternalSub[]): { label: string; value: string }[] {
  return [{ label: 'Выкл', value: 'off' }]
    .concat(embedded.map((t, i) => ({ label: t.label, value: 'e' + i })))
    .concat(external.map((s, i) => ({ label: s.label + ' (файл)', value: 'x' + i })));
}

export function defaultSubChoice(
  embedded: TrackOption[],
  external: ExternalSub[],
  s: { subtitlesOn: boolean; subLang: string },
): string {
  if (!s.subtitlesOn) return 'off';
  const e = findLang(embedded, s.subLang);
  if (e >= 0) return 'e' + e;
  for (let i = 0; i < external.length; i++) if (guessLangFromName(external[i].label) === s.subLang) return 'x' + i;
  return 'off';
}
