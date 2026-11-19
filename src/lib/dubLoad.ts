// Studios a season can offer before anyone has played it: external audio files, or one ffprobe of a video.
import type { FfprobeResult } from '../api/types';
import { parseEpisode, playableFiles, type TorrentFile } from './episodes';
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

/**
 * Files the dub row may look at for one season of a pack: that season's videos and the external audio matched to
 * them. A release that does not number this season stays whole, so a single-season torrent still has its studios.
 */
export function seasonDubFiles(files: TorrentFile[], season: number): TorrentFile[] {
  if (!(season > 0) || !files.length) return files;
  const tracks = releaseTracks(files);
  const videos = tracks.videos.filter((file) => parseEpisode(file.path).season === season);
  if (!videos.length) {
    const named = files.filter((file) => parseEpisode(file.path).season === season);
    return named.length ? named : files;
  }
  const keep = new Set<number>();
  videos.forEach((video) => {
    keep.add(video.id);
    const row = tracks.byVideo[video.id];
    if (row) row.audio.forEach((track) => keep.add(track.file.id));
  });
  tracks.unmatched.forEach((track) => {
    if (track.kind === 'audio' && parseEpisode(track.file.path).season === season) keep.add(track.file.id);
  });
  return files.filter((file) => keep.has(file.id));
}
