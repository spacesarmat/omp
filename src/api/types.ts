import type { TorrentFile } from '../lib/episodes';

export type { TorrentFile };

export interface Torrent {
  hash: string;
  title: string;
  name?: string;
  category?: string;
  poster?: string;
  data?: string;
  timestamp?: number;
  stat: number;
  stat_string?: string;
  torrent_size?: number;
  loaded_size?: number;
  preloaded_bytes?: number;
  download_speed?: number;
  upload_speed?: number;
  total_peers?: number;
  active_peers?: number;
  connected_seeders?: number;
  file_stats?: TorrentFile[];
}

export interface CacheState {
  Hash?: string;
  Capacity: number;
  Filled: number;
  PiecesLength: number;
  PiecesCount: number;
  Torrent?: Torrent;
}

export interface ViewedEntry {
  hash: string;
  file_index: number;
  timecode?: number;
}

export interface SearchResult {
  Title: string;
  Categories: string;
  Size: string;
  CreateDate: string;
  Tracker: string;
  Link: string;
  Magnet: string;
  Hash: string;
  Peer: number;
  Seed: number;
}

export interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name: string;
  codec_tag_string?: string;
  profile?: string;
  channels?: number;
  width?: number;
  height?: number;
  color_transfer?: string;
  /** Bit/s, as ffprobe gives it (a string). */
  bit_rate?: string;
  disposition?: { default?: number; forced?: number };
  tags?: { [k: string]: string };
}

export interface FfprobeChapter {
  start_time: string;
  end_time: string;
  tags?: { title?: string };
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  chapters?: FfprobeChapter[];
  format?: { duration?: string; bit_rate?: string; format_name?: string };
}

/** TorrServer `/tmdb/settings`: an empty APIKey means posters cannot be looked up. */
export interface TmdbConfig {
  APIKey?: string;
  APIURL?: string;
  ImageURL?: string;
  ImageURLRu?: string;
}

export interface ServerSettings {
  CacheSize: number;
  PreloadCache: number;
  ReaderReadAHead: number;
  ConnectionsLimit: number;
  DownloadRateLimit: number;
  UploadRateLimit: number;
  TorrentDisconnectTimeout: number;
  TrackTimecode?: boolean;
  [key: string]: unknown;
}
