export interface ExternalSub {
  url: string;
  label: string;
  ext: string;
}

export interface PlayItem {
  url: string;
  title: string;
  hash?: string;
  fileIndex?: number;
  poster?: string;
  torrentTitle?: string;
  /** TMDB episode title the phone already resolved, so the TV shows it without matching the pack again. */
  episodeTitle?: string;
  subtitles?: ExternalSub[];
}
