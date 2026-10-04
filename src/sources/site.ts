// Shared parts of the built-in tracker parsers: page loading with Russian errors, numbers, results. Chromium 53 safe.
import { BAD_URL } from './http';
import { stashFile } from '../api/torrentFiles';
import { infohashFromMagnet, parseHtml } from './html';
import { isCloudflareBypassOn } from './store';
import type { HttpOptions, HttpResponse, Source, SourceContext, SourceResult } from './types';

export const SITE_ERROR = 'Сайт ответил ошибкой ';
export const CHALLENGE = 'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже';
export const PARSE_ERROR = 'Не удалось разобрать страницу сайта';
export const NO_MAGNET = 'На странице раздачи нет magnet-ссылки';
export const NO_TORRENT = 'На странице раздачи нет ссылки на торрент';

/** Cloudflare «Just a moment…» / Turnstile challenge instead of the page. */
export function isChallenge(text: string): boolean {
  return text.indexOf('challenges.cloudflare.com') >= 0 || /<title>\s*Just a moment/i.test(text);
}

/** The response as a page, or a Russian error (Cloudflare check, HTTP error status). */
export function checkPage(res: HttpResponse): HttpResponse {
  if (isChallenge(res.text)) throw new Error(CHALLENGE);
  if (res.status < 200 || res.status >= 400) throw new Error(SITE_ERROR + res.status);
  return res;
}

/**
 * Request options of a site (pass them to every request of a Cloudflare-capable site): { cloudflare: true, siteName }
 * while its «Обходить проверку Cloudflare» is on, else only the site name. `extra` is merged in.
 */
export function siteOptions(source: Pick<Source, 'id' | 'name' | 'cloudflare'>, extra?: HttpOptions): HttpOptions {
  const o: HttpOptions = {};
  if (extra) {
    for (const k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) (o as { [k: string]: unknown })[k] = (extra as { [k: string]: unknown })[k];
  }
  o.siteName = source.name;
  if (isCloudflareBypassOn(source)) o.cloudflare = true;
  else delete o.cloudflare;
  return o;
}

export function loadPage(ctx: SourceContext, url: string, opts?: HttpOptions): Promise<HttpResponse> {
  return (opts ? ctx.http.get(url, opts) : ctx.http.get(url)).then(checkPage);
}

export function loadDoc(ctx: SourceContext, url: string, opts?: HttpOptions): Promise<{ res: HttpResponse; doc: Document }> {
  return loadPage(ctx, url, opts).then((res) => ({ res, doc: parseHtml(res.text) }));
}

/** True when `url` is http(s) on `host` or its subdomain (release pages are opened only on their own site). */
export function onHost(url: string, host: string): boolean {
  const m = /^https?:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url || '');
  if (!m) return false;
  const h = m[1].toLowerCase();
  return h === host || h.slice(-(host.length + 1)) === '.' + host;
}

export function requireHost(url: string, host: string): Promise<void> {
  return onHost(url, host) ? Promise.resolve() : Promise.reject(new Error(BAD_URL));
}

/** First integer in the text (' 11' → 11); 0 when none. */
export function toInt(s: string | null | undefined): number {
  const m = /-?\d+/.exec((s || '').replace(/[\s ]/g, ''));
  return m ? parseInt(m[0], 10) : 0;
}

/** First magnet link of a release page. */
export function magnetOf(doc: Document, selector?: string): string {
  const a = (selector && doc.querySelector(selector)) || doc.querySelector('a[href^="magnet:"]');
  const href = a ? (a.getAttribute('href') || '').trim() : '';
  if (href.indexOf('magnet:') !== 0) throw new Error(NO_MAGNET);
  return href;
}

/** Latin-1 string (one char per byte, responseCharset iso-8859-1) to bytes. */
export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

/**
 * A .torrent that needs the site's session (cookies sent natively): stashed for TorrServerClient.add, which uploads it
 * (resolves the `omp-file:` pseudo-link). null when the answer is not a bencoded file (an HTML page: signed out, a
 * daily limit…). Cloudflare / network errors reject.
 */
export function fetchTorrent(ctx: SourceContext, url: string, opts: HttpOptions): Promise<string | null> {
  return fetchTorrentAnswer(ctx, url, opts).then((a) => a.link);
}

/** fetchTorrent with the answer (to tell a signed-out page from a limit page). */
export function fetchTorrentAnswer(ctx: SourceContext, url: string, opts: HttpOptions): Promise<{ link: string | null; res: HttpResponse }> {
  const o: HttpOptions = {};
  for (const k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) (o as { [k: string]: unknown })[k] = (opts as { [k: string]: unknown })[k];
  o.responseCharset = 'iso-8859-1';
  return ctx.http.get(url, o).then((res) => {
    if (isChallenge(res.text)) throw new Error(CHALLENGE);
    // a bencoded dictionary starts with «d»
    if (res.status < 200 || res.status >= 300 || res.text.charAt(0) !== 'd' || !/^d\d+:/.test(res.text)) return { link: null, res };
    return { link: stashFile(latin1Bytes(res.text)), res };
  });
}

export interface ResultFields {
  title: string;
  detailUrl: string;
  size: string;
  sizeBytes: number | null;
  seeds: number;
  peers: number;
  date?: number;
  magnet?: string;
  categories?: string;
  /** What TorrServer adds when there is no magnet (default: detailUrl), e.g. an http(s) .torrent link. */
  link?: string;
}

/** A SourceResult with the SearchResult fields filled the way the TorrServer results are. */
export function makeResult(source: string, tracker: string, f: ResultFields): SourceResult {
  const magnet = f.magnet || '';
  const hash = infohashFromMagnet(magnet);
  const r: SourceResult = {
    Title: f.title,
    Categories: f.categories || '',
    Size: f.size,
    CreateDate: f.date !== undefined ? new Date(f.date).toISOString() : '',
    Tracker: tracker,
    Link: f.link || f.detailUrl,
    Magnet: magnet,
    Hash: hash || '',
    Peer: f.peers,
    Seed: f.seeds,
    source,
    detailUrl: f.detailUrl,
  };
  if (hash) r.hash = hash;
  if (f.date !== undefined) r.date = f.date;
  if (f.sizeBytes !== null) r.sizeBytes = f.sizeBytes;
  return r;
}

/**
 * Lists of several pages loaded in parallel (a feed of two sections), newest first (stable; undated rows last).
 * A page that fails is left out; when every page fails, rejects with the first error.
 */
export function mergePages(pages: Promise<SourceResult[]>[]): Promise<SourceResult[]> {
  if (!pages.length) return Promise.resolve([]);
  const lists: (SourceResult[] | null)[] = pages.map(() => null);
  const errors: unknown[] = pages.map(() => null);
  let left = pages.length;
  return new Promise<SourceResult[]>((resolve, reject) => {
    const settle = () => {
      left -= 1;
      if (left > 0) return;
      const ok = lists.filter((l) => l !== null) as SourceResult[][];
      if (!ok.length) {
        reject(errors[0]);
        return;
      }
      const all = ok.reduce((acc: SourceResult[], l) => acc.concat(l), []);
      resolve(
        all
          .map((r, i) => ({ r, i, d: r.date || 0 }))
          .sort((a, b) => b.d - a.d || a.i - b.i)
          .map((x) => x.r),
      );
    };
    pages.forEach((p, i) => {
      p.then(
        (list) => {
          lists[i] = list;
          settle();
        },
        (e) => {
          errors[i] = e;
          settle();
        },
      );
    });
  });
}
