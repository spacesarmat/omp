// Public links to a catalog title. The path is the identity (TMDB kind and id, optional season).
// No query, no tracking, no magnets and no torrent hashes. Chromium 53 safe.

export const SHARE_ORIGIN = 'https://omp-player.online';

export interface TitleRef {
  kind: 'movie' | 'tv';
  id: number;
  /** Set only for a series season, including 0 (specials). */
  season?: number;
}

const HOSTS: { [h: string]: boolean } = {
  'omp-player.online': true,
  'www.omp-player.online': true,
};

function cleanLine(raw: string): string {
  const s = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) return '';
  if (/magnet:/i.test(s) || /xt=urn:btih/i.test(s)) return '';
  if (/^[a-f0-9]{40}$/i.test(s)) return '';
  return s;
}

/** https://omp-player.online/t/movie/ID or /t/tv/ID or /t/tv/ID/s/N. Empty when the ref is not a title. */
export function titleUrl(ref: TitleRef): string {
  if (!ref || (ref.kind !== 'movie' && ref.kind !== 'tv')) return '';
  const id = Math.floor(ref.id);
  if (!(id > 0) || id > 1000000000) return '';
  let path = '/t/' + ref.kind + '/' + id;
  if (ref.kind === 'tv' && typeof ref.season === 'number' && isFinite(ref.season)) {
    const season = Math.floor(ref.season);
    if (season < 0 || season > 500) return '';
    path += '/s/' + season;
  }
  return SHARE_ORIGIN + path;
}

/**
 * A shared title link: https, http (before the site redirects), or omp://t/tv/ID/s/N.
 * Query and hash are ignored. Anything else, including a magnet, is null.
 */
export function parseTitleUrl(raw: string): TitleRef | null {
  const text = String(raw || '').trim();
  if (!text || /magnet:/i.test(text) || /xt=urn:btih/i.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const proto = (u.protocol || '').toLowerCase();
  if (proto !== 'https:' && proto !== 'http:' && proto !== 'omp:') return null;
  let path = u.pathname || '';
  if (proto === 'omp:') {
    const host = (u.hostname || '').toLowerCase();
    if (host === 't') path = '/t' + (path.charAt(0) === '/' ? path : '/' + path);
    else if (!HOSTS[host]) return null;
  } else if (!HOSTS[(u.hostname || '').toLowerCase()]) {
    return null;
  }
  const m = /^\/t\/(movie|tv)\/(\d+)(?:\/s\/(\d+))?\/?$/.exec(path);
  if (!m) return null;
  const id = +m[2];
  if (!(id > 0) || id > 1000000000) return null;
  const ref: TitleRef = { kind: m[1] === 'tv' ? 'tv' : 'movie', id: id };
  if (m[3] !== undefined) {
    if (ref.kind !== 'tv') return null;
    const season = +m[3];
    if (season < 0 || season > 500) return null;
    ref.season = season;
  }
  return ref;
}

/** True for the site root or a title path this app can open. No query and no hash. */
export function isShareUrl(url: string): boolean {
  if (url === SHARE_ORIGIN || url === SHARE_ORIGIN + '/') return true;
  if (url.indexOf('?') >= 0 || url.indexOf('#') >= 0) return false;
  return parseTitleUrl(url) !== null;
}

/**
 * The text of a share: title, year, a short line, then the link. Each on its own line.
 * A line that carries a magnet or a bare infohash is dropped. Empty when the link is not ours.
 */
export function shareMessageText(title: string, year: number, line: string, url: string): string {
  if (!isShareUrl(url)) return '';
  const rows: string[] = [];
  const name = cleanLine(title);
  if (name) rows.push(name);
  if (typeof year === 'number' && isFinite(year) && year > 0) rows.push(String(Math.floor(year)));
  const extra = cleanLine(line);
  if (extra) rows.push(extra);
  const link = url === SHARE_ORIGIN + '/' ? SHARE_ORIGIN : url;
  rows.push(link);
  return rows.join('\n');
}
