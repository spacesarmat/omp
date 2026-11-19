// Studios a season can offer before anyone has played it: external audio files, or one ffprobe of a video.
import type { FfprobeResult } from '../api/types';
import { playableFiles, type TorrentFile } from './episodes';
import { releaseTracks } from './externalTracks';
import { seenDubs, type SeriesSub } from './seriesTracks';
import { normalizeLang, tracksFromProbe } from './tracks';

/** Studios named by external audio files («Rus Sound/LostFilm/…mka»). */
export function externalDubSeen(files: TorrentFile[]): SeriesSub[] {
  return seenDubs(releaseTracks(files).audio.map((a) => ({ title: a.studio, language: normalizeLang(a.lang) })));
}

/** Named audio tracks from ffprobe. A track with no studio title is left out. */
export function probeDubSeen(probe: FfprobeResult | null): SeriesSub[] {
  return seenDubs(
    tracksFromProbe(probe)
      .filter((t) => t.kind === 'audio')
      .map((t) => ({ title: t.title, language: t.language, channels: t.channels })),
  );
}

/** The first playable file to probe; null when the release lists none. */
export function probeFileId(files: TorrentFile[]): number | null {
  const video = playableFiles(files)[0];
  return video ? video.id : null;
}
