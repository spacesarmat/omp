import { t } from '../i18n';
import type { FfprobeResult } from '../api/types';
import { tracksFromProbe, describeTrack, normalizeLang, findLang, guessLangFromName } from '../lib/tracks';
import { subtitleKind } from '../lib/subCodec';
import { audioTrackList, textTrackList } from '../platform/webosMedia';
import type { ExternalSub } from './types';

export interface TrackOption {
  label: string;
  language: string;
  isDefault: boolean;
  /** The track's own title (the dub: «LostFilm»), '' when the file has none. */
  title?: string;
  /** Audio channels (ffprobe), for the «Озвучка» row of the series screen; absent when unknown. */
  channels?: number;
  /** ffprobe codec name. Subtitles only. */
  codec?: string;
  /** ffprobe stream index. Subtitles only. */
  stream?: number;
}

function fromProbe(probe: FfprobeResult | null, kind: 'audio' | 'subtitle'): TrackOption[] {
  return tracksFromProbe(probe)
    .filter((t) => t.kind === kind)
    .map((tr) => {
      let label = describeTrack(tr);
      if (kind === 'subtitle' && subtitleKind(tr.codec) === 'image') label = label + ' · ' + t('tvPlayer.imageSub');
      const o: TrackOption = { label: label, language: tr.language, isDefault: tr.isDefault, title: tr.title || undefined };
      if (tr.channels) o.channels = tr.channels;
      if (kind === 'subtitle') {
        o.codec = tr.codec;
        o.stream = tr.stream;
      }
      return o;
    });
}

function fromVideo(list: { language: string; label: string }[]): TrackOption[] {
  return list.map((t) => ({
    label: t.label + (t.language ? ' (' + t.language + ')' : ''),
    language: normalizeLang(t.language),
    isDefault: false,
    title: t.label || undefined,
  }));
}

export function audioOptions(probe: FfprobeResult | null, video: HTMLVideoElement | null): TrackOption[] {
  const p = fromProbe(probe, 'audio');
  if (p.length) {
    if (video) {
      const v = audioTrackList(video);
      if (v.length > 0 && v.length !== p.length) {
        return fromVideo(v);
      }
    }
    return p;
  }
  return video ? fromVideo(audioTrackList(video)) : [];
}

/**
 * Embedded subtitles. ffprobe wins whenever it listed any: the TV and the phone player only report tracks they
 * can decode themselves, so a shorter HTML list used to drop PGS and leave the SRT tracks.
 */
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
  return [{ label: t('player.off'), value: 'off' }]
    .concat(embedded.map((t, i) => ({ label: t.label, value: 'e' + i })))
    .concat(external.map((s, i) => ({ label: t('player.subFile', { label: s.label }), value: 'x' + i })));
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
