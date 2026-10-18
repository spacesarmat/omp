// Whether a library torrent is a book: the category the user (or the search) stored, or a
// file list that is only audio a book is shipped as. A video with an extra mp3 stays a video.
// Pure; shared by the phone. Chromium 53 rules.
import { parseTorrentData } from '../api/torrserver';
import type { TorrentFile } from './episodes';
import { playableFiles } from './episodes';
import { isAudiobookAudio } from './audiobookTracks';

export interface AudiobookTorrentInput {
  category?: string;
  file_stats?: TorrentFile[];
  data?: string;
}

function listedFiles(tor: AudiobookTorrentInput): TorrentFile[] {
  return tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
}

/**
 * An audiobook: category «audiobook», or every playable file is audio (mp3, m4b, …).
 * An empty file list is not enough — the category has to say so.
 */
export function isAudiobookTorrent(tor: AudiobookTorrentInput | null | undefined): boolean {
  if (!tor) return false;
  if (tor.category === 'audiobook') return true;
  const files = playableFiles(listedFiles(tor));
  return files.length > 0 && files.every((f) => isAudiobookAudio(f.path));
}
