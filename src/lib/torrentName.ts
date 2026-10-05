import { parseEpisode, playableFiles, baseName, stripExt, type TorrentFile } from './episodes';
import { titleCore } from './posterSearch';
import { t } from '../i18n';

const HEX40 = /^[0-9a-f]{40}$/i;
const BASE32 = /^[a-z2-7]{32}$/i;
const SERIES_TOKEN = /s\d{1,2}[ ._-]?e\d{1,3}|(?:^|[^\d])\d{1,2}x\d{2,3}(?:[^\d]|$)/i;
const PREFIX = /^infohash:/i;

/**
 * A title TorrServer made up for a magnet without `dn=`: `infohash:<hex>`, the bare info hash (hex or base32) or nothing.
 * `hash` (optional) also catches a title equal to the torrent's own hash.
 */
export function isPlaceholderTitle(title: string | undefined | null, hash?: string): boolean {
  const t = (title || '').trim();
  if (!t) return true;
  const body = t.replace(PREFIX, '').trim();
  if (HEX40.test(body) || BASE32.test(body)) return true;
  if (hash && body.toLowerCase() === hash.trim().toLowerCase()) return true;
  return false;
}

function yearOf(s: string): string {
  const m = /(?:^|[^0-9])((?:19[3-9]|20[0-4])[0-9])(?:[^0-9]|$)/.exec(s);
  return m ? m[1] : '';
}

// the name of the release: the top folder when there is one (it names the whole release), else the file itself
function sourceName(f: TorrentFile): string {
  const parts = f.path.split('/').filter(Boolean);
  if (parts.length > 1 && !/^(?:season|сезон|s)[ ._-]?\d{1,2}$/i.test(parts[0])) return parts[0];
  return stripExt(baseName(f.path));
}

/**
 * A readable name from the file names: «Name · Сезон 13» for series, «Name (2019)» for a single movie.
 * `fallback` when nothing sensible can be derived.
 */
export function deriveName(files: TorrentFile[] | undefined | null, fallback: string): string {
  const list = playableFiles(files || []);
  if (!list.length) return fallback;
  const eps = list.map((f) => parseEpisode(f.path));
  const isSeries = (eps.some((e) => e.episode !== null) && list.length > 1) || eps.some((e) => e.season !== null && e.episode !== null);
  // a file named with a season/episode token carries the series title best; else the release folder
  let src = sourceName(list[0]);
  for (let i = 0; i < list.length; i++) {
    const own = stripExt(baseName(list[i].path));
    if (SERIES_TOKEN.test(own)) {
      src = own;
      break;
    }
  }
  // «Name 1x01»: titleCore knows S01E01, not NxM
  let name = titleCore(src.replace(/[ ._-]+\d{1,2}x\d{2,3}(?:[^\d].*)?$/i, ''));
  if (!name) return fallback;
  if (isSeries) {
    const seasons: number[] = [];
    eps.forEach((e) => {
      if (e.season !== null && seasons.indexOf(e.season) < 0) seasons.push(e.season);
    });
    seasons.sort((a, b) => a - b);
    if (seasons.length === 1) name += ' · ' + t('library.season', { n: seasons[0] });
    else if (seasons.length > 1) name += ' · ' + t('library.seasons', { a: seasons[0], b: seasons[seasons.length - 1] });
    return name;
  }
  if (list.length === 1) {
    const y = yearOf(src.replace(/[._]+/g, ' '));
    if (y) name += ' (' + y + ')';
  }
  return name;
}

interface NamedTorrent {
  hash: string;
  title?: string;
  name?: string;
  data?: string;
  file_stats?: TorrentFile[];
}

/** The files TorrServer knows for a torrent (live stats, else the stored `data`). */
export function torrentFiles(t: NamedTorrent): TorrentFile[] {
  if (t.file_stats && t.file_stats.length) return t.file_stats;
  if (!t.data) return [];
  try {
    const d = JSON.parse(t.data);
    const files = d && d.TorrServer && d.TorrServer.Files;
    return Array.isArray(files) ? files : [];
  } catch (e) {
    return [];
  }
}

/** The title to show for a torrent: its own, unless it is a placeholder; then one derived from the files. */
export function displayTitle(t: NamedTorrent): string {
  const own = (t.title || '').trim();
  if (!isPlaceholderTitle(own, t.hash)) return own;
  const derived = deriveName(torrentFiles(t), '');
  if (derived) return derived;
  const name = (t.name || '').trim();
  if (name && !isPlaceholderTitle(name, t.hash)) return name;
  return own || t.hash;
}
