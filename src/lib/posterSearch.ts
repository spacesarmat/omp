import type { TmdbConfig } from '../api/types';

const MAX_WORDS = 4;
const MAX_LEN = 50;
// the title proper ends where the year, season or release details begin
const TAIL = /\b(?:19\d\d|20\d\d|s\d{1,2}(?:e\d{1,3})?|\d{3,4}p|4k|web-?dl|web-?rip|bd-?rip|hd-?rip|dvd-?rip|blu-?ray|hdtv|x26[45]|h\.?26[45]|hevc)\b/i;

/** Short query for the poster search from a torrent title, as the TorrServer web page does. */
export function posterQuery(title: string): string {
  let q = titleCore(title).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');
  if (q.length > MAX_LEN) {
    const cut = q.slice(0, MAX_LEN);
    const sp = cut.lastIndexOf(' ');
    q = sp > 0 ? cut.slice(0, sp) : cut;
  }
  return q;
}

/** The title proper of a torrent title: before « [», « (», « / », « | », the year, season or release details. */
export function titleCore(title: string): string {
  let s = (title || '').trim();
  const seps = [' [', ' (', ' / ', ' | '];
  for (let i = 0; i < seps.length; i++) {
    const at = s.indexOf(seps[i]);
    if (at > 0) s = s.slice(0, at);
  }
  // release names use dots or underscores instead of spaces
  if (s.indexOf(' ') < 0) s = s.replace(/[._]+/g, ' ');
  const tail = TAIL.exec(s);
  if (tail && tail.index > 0) s = s.slice(0, tail.index);
  return s.replace(/\s*(?:сезон|season)\s*$/i, '').replace(/[\s.,:;-]+$/, '').replace(/\s+/g, ' ').trim();
}

function withScheme(url: string | undefined, fallback: string): string {
  const u = (url || fallback).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/\//, '');
}

/** TMDB multi-search URL for a query; Russian titles and images. */
export function tmdbSearchUrl(cfg: TmdbConfig, query: string): string {
  let base = withScheme(cfg.APIURL, 'https://api.themoviedb.org');
  if (base.indexOf('/3/search/multi') < 0) base = base.replace(/\/3.*$/, '').replace(/\/search.*$/, '') + '/3/search/multi';
  return (
    base +
    '?api_key=' + encodeURIComponent(cfg.APIKey || '') +
    '&language=ru&include_image_language=ru,null,en&query=' + encodeURIComponent(query)
  );
}

/** First poster among TMDB search results, or '' when there is none. */
export function firstPoster(cfg: TmdbConfig, results: unknown): string {
  if (!Array.isArray(results)) return '';
  const host = withScheme(cfg.ImageURLRu, 'https://imagetmdb.com');
  for (let i = 0; i < results.length; i++) {
    const p = results[i] && (results[i] as { poster_path?: unknown }).poster_path;
    if (typeof p === 'string' && p) return host + '/t/p/w300' + (p.charAt(0) === '/' ? p : '/' + p);
  }
  return '';
}
