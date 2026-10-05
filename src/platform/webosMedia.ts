import { hasLuna, lunaCall } from './luna';
import { t } from '../i18n';

interface TrackLike {
  enabled?: boolean;
  mode?: string;
  language?: string;
  label?: string;
  kind?: string;
}

function list(x: unknown): TrackLike[] | null {
  const l = x as { length?: number } | undefined;
  if (!l || typeof l.length !== 'number') return null;
  const out: TrackLike[] = [];
  for (let i = 0; i < (l.length as number); i++) out.push((l as any)[i]);
  return out;
}

function mediaId(video: HTMLVideoElement): string | undefined {
  return (video as any).mediaId;
}

function isSubtitleTrack(t: TrackLike): boolean {
  const k = t.kind || '';
  return k === 'subtitles' || k === 'captions' || k === '';
}

function filterSubtitleTracks(tracks: TrackLike[]): TrackLike[] {
  return tracks.filter(isSubtitleTrack);
}

export function audioTrackList(video: HTMLVideoElement): { language: string; label: string }[] {
  const at = list((video as any).audioTracks) || [];
  return at.map((tr, i) => ({ language: tr.language || '', label: tr.label || t('common.audioTrackN', { n: i + 1 }) }));
}

export function textTrackList(video: HTMLVideoElement): { language: string; label: string }[] {
  const tt = list((video as any).textTracks) || [];
  const st = filterSubtitleTracks(tt);
  return st.map((tr, i) => ({ language: tr.language || '', label: tr.label || t('common.subtitlesN', { n: i + 1 }) }));
}

export function selectAudioTrack(video: HTMLVideoElement, index: number): boolean {
  const at = list((video as any).audioTracks);
  if (at && at.length > index) {
    at.forEach((t, i) => { t.enabled = i === index; });
    return true;
  }
  const id = mediaId(video);
  if (id && hasLuna()) {
    lunaCall('luna://com.webos.media/selectTrack', { mediaId: id, type: 'audio', index }).catch(() => undefined);
    return true;
  }
  return false;
}

export function selectTextTrack(video: HTMLVideoElement, index: number): boolean {
  const tt = list((video as any).textTracks);
  if (tt && tt.length > 0) {
    const st = filterSubtitleTracks(tt);
    if (st.length > 0) {
      tt.forEach((t, i) => {
        if (isSubtitleTrack(t)) {
          const stIndex = st.indexOf(t);
          t.mode = stIndex === index ? 'showing' : 'disabled';
        }
      });
      return true;
    }
  }
  const id = mediaId(video);
  if (id && hasLuna()) {
    if (index < 0) {
      lunaCall('luna://com.webos.media/setSubtitleEnable', { mediaId: id, enable: false }).catch(() => undefined);
    } else {
      lunaCall('luna://com.webos.media/selectTrack', { mediaId: id, type: 'text', index })
        .then(() => lunaCall('luna://com.webos.media/setSubtitleEnable', { mediaId: id, enable: true }))
        .catch(() => undefined);
    }
    return true;
  }
  return false;
}
