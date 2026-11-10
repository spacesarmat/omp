import type { TorrServerClient } from '../api/torrserver';
import type { Torrent } from '../api/types';
import { rememberedCacheSource, rewritePlaybackUrl } from '../cache/cacheNode';
import { TorrentFile, fileKind, baseName, extOf, playableFiles, matchSubtitles, subtitleLabel } from '../lib/episodes';
import type { PlayItem } from './types';
import { displayTitle } from '../lib/torrentName';

export function buildTorrentQueue(c: TorrServerClient, t: Torrent, files: TorrentFile[]): PlayItem[] {
  const subs = files.filter((f) => fileKind(f.path) === 'subtitle');
  const playable = playableFiles(files);
  const source = rememberedCacheSource(t.hash);
  const stream = (id: number, path: string) => rewritePlaybackUrl(c.streamUrl(t.hash, id, baseName(path)), t.hash, source);
  return playable.map((f) => ({
    url: stream(f.id, f.path),
    title: playable.length > 1 ? baseName(f.path) : displayTitle(t) || baseName(f.path),
    hash: t.hash,
    fileIndex: f.id,
    poster: t.poster,
    torrentTitle: displayTitle(t) || undefined,
    subtitles: matchSubtitles(f, subs).map((s) => ({
      url: stream(s.id, s.path),
      label: subtitleLabel(s, f),
      ext: extOf(s.path),
    })),
  }));
}
