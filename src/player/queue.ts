import type { TorrServerClient } from '../api/torrserver';
import type { Torrent } from '../api/types';
import { TorrentFile, fileKind, baseName, extOf, playableFiles, matchSubtitles, subtitleLabel } from '../lib/episodes';
import type { PlayItem } from './types';

export function buildTorrentQueue(c: TorrServerClient, t: Torrent, files: TorrentFile[]): PlayItem[] {
  const subs = files.filter((f) => fileKind(f.path) === 'subtitle');
  const playable = playableFiles(files);
  return playable.map((f) => ({
    url: c.streamUrl(t.hash, f.id, baseName(f.path)),
    title: playable.length > 1 ? baseName(f.path) : t.title || baseName(f.path),
    hash: t.hash,
    fileIndex: f.id,
    poster: t.poster,
    subtitles: matchSubtitles(f, subs).map((s) => ({
      url: c.streamUrl(t.hash, s.id, baseName(s.path)),
      label: subtitleLabel(s, f),
      ext: extOf(s.path),
    })),
  }));
}
