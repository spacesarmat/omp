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
  subtitles?: ExternalSub[];
}
