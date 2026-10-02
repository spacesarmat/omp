export interface TorrentFile {
  id: number;
  path: string;
  length: number;
}

export type FileKind = 'video' | 'audio' | 'subtitle' | 'playlist' | 'other';

const VIDEO = ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'ts', 'm2ts', 'mts', 'webm', 'wmv', 'mpg', 'mpeg', 'vob', 'flv', '3gp', 'ogv'];
const AUDIO = ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wav', 'ac3', 'dts', 'eac3', 'mka', 'wma', 'ape'];
const SUBS = ['srt', 'vtt', 'ass', 'ssa'];
const PLAYLISTS = ['m3u', 'm3u8'];

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '');
}

export function fileKind(path: string): FileKind {
  const e = extOf(path);
  if (VIDEO.indexOf(e) >= 0) return 'video';
  if (AUDIO.indexOf(e) >= 0) return 'audio';
  if (SUBS.indexOf(e) >= 0) return 'subtitle';
  if (PLAYLISTS.indexOf(e) >= 0) return 'playlist';
  return 'other';
}

export interface EpisodeInfo {
  season: number | null;
  episode: number | null;
}

export function parseEpisode(path: string): EpisodeInfo {
  const name = baseName(path);
  let m = /s(\d{1,2})[ ._-]?e(\d{1,3})/i.exec(name);
  if (m) return { season: +m[1], episode: +m[2] };
  m = /(?:^|[^\d])(\d{1,2})x(\d{2,3})(?:[^\d]|$)/i.exec(name);
  if (m) return { season: +m[1], episode: +m[2] };

  const dir = path.split('/').slice(0, -1).join('/');
  const sm = /(?:season|сезон)[ ._-]?(\d{1,2})/i.exec(dir) || /(?:^|\/)s(\d{1,2})(?:\/|$)/i.exec(dir);
  const season = sm ? +sm[1] : null;
  const named = /(?:^|[ ._-])(?:ep?|episode|серия)[ ._-]?(\d{1,3})(?:[^\d]|$)/i.exec(name);
  // a bare leading number counts as an episode only inside a season folder (otherwise it's a track number)
  const leading = /^(\d{1,3})[ ._-]/.exec(name);
  const episode = named ? +named[1] : season !== null && leading ? +leading[1] : null;
  return { season, episode };
}

export function episodeLabel(path: string): string {
  const e = parseEpisode(path);
  if (e.episode === null) return '';
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return (e.season !== null ? 'S' + pad(e.season) : '') + 'E' + pad(e.episode);
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface Season {
  season: number | null;
  files: TorrentFile[];
}

export function groupBySeason(files: TorrentFile[]): Season[] {
  const map: { [k: string]: Season } = {};
  const keys: string[] = [];
  files.forEach((file) => {
    const s = parseEpisode(file.path).season;
    const k = s === null ? 'none' : String(s);
    if (!map[k]) {
      map[k] = { season: s, files: [] };
      keys.push(k);
    }
    map[k].files.push(file);
  });
  const groups = keys.map((k) => map[k]);
  groups.forEach((g) =>
    g.files.sort((a, b) => {
      const ea = parseEpisode(a.path).episode;
      const eb = parseEpisode(b.path).episode;
      if (ea !== null && eb !== null && ea !== eb) return ea - eb;
      return naturalCompare(a.path, b.path);
    }),
  );
  groups.sort((a, b) => {
    if (a.season === null) return 1;
    if (b.season === null) return -1;
    return a.season - b.season;
  });
  return groups;
}

export function playableFiles(files: TorrentFile[]): TorrentFile[] {
  const videos = files.filter((x) => fileKind(x.path) === 'video');
  const list = videos.length ? videos : files.filter((x) => fileKind(x.path) === 'audio');
  return groupBySeason(list).reduce((acc: TorrentFile[], g) => acc.concat(g.files), []);
}

export function matchSubtitles(video: TorrentFile, subs: TorrentFile[]): TorrentFile[] {
  const vb = stripExt(baseName(video.path)).toLowerCase();
  const matched = subs.filter((s) => stripExt(baseName(s.path)).toLowerCase().indexOf(vb) === 0);
  if (matched.length) return matched;
  return parseEpisode(video.path).episode === null ? subs.slice() : [];
}

export function subtitleLabel(sub: TorrentFile, video: TorrentFile): string {
  const vb = stripExt(baseName(video.path));
  const sb = stripExt(baseName(sub.path));
  let rest = sb.toLowerCase().indexOf(vb.toLowerCase()) === 0 ? sb.slice(vb.length).replace(/^[ ._-]+/, '') : '';
  if (!rest) {
    const parts = sub.path.split('/');
    rest = parts.length > 1 && sb.toLowerCase() === vb.toLowerCase() ? parts[parts.length - 2] : sb;
  }
  return rest;
}
