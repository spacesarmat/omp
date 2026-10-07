// SourceHttp for Node (the parser monitor): what the native Android http does for the parsers — a browser User-Agent,
// cookies per site, redirects followed with the final URL, torrent.by's incomplete TLS chain completed as on Android, the body decoded by its charset (windows-1251 / koi8-r
// included), forms in windows-1251. No Cloudflare pass. Every answer is remembered (`last`) so the monitor can tell a
// block from a broken parser.
import { encodeWin1251 } from '../../src/sources/html';
import type { HttpOptions, HttpResponse, SourceHttp } from '../../src/sources/types';
// torrent.by: its TLS chain needs the Let's Encrypt YE intermediates the Android app bundles (see tlsFetch.mjs)
import { monitorFetch } from './tlsFetch.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const DEFAULT_TIMEOUT_MS = 25000;

export interface NodeHttp extends SourceHttp {
  /** The last answer (any status), null before the first one. */
  last: HttpResponse | null;
  /** The first answer since reset() (the page the parser read first: the search list). */
  first: HttpResponse | null;
  /** Forget `last` and `first` (before a new check). */
  reset(): void;
}

interface Cookie {
  domain: string;
  name: string;
  value: string;
}

/** A request failure with a kind the monitor reads: 'timeout' or 'network'. */
export function netError(kind: 'timeout' | 'network', message: string): Error {
  const e = new Error(message);
  (e as Error & { monitorKind?: string }).monitorKind = kind;
  return e;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function charsetOf(contentType: string, head: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  if (m) return m[1].toLowerCase();
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

/** One char per byte (not WHATWG's iso-8859-1, which is windows-1252). */
function latin1(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i += 8192) out += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)));
  return out;
}

function decode(buf: Uint8Array, contentType: string, forced?: string): string {
  const cs = (forced || '').toLowerCase();
  // a .torrent read as text keeps every byte as one char (site.ts latin1Bytes)
  if (cs === 'iso-8859-1' || cs === 'latin1') return latin1(buf);
  const charset = cs || charsetOf(contentType, latin1(buf.subarray(0, 4096)));
  try {
    return new TextDecoder(charset).decode(buf);
  } catch (e) {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function encodeForm(form: { [k: string]: string }, charset?: string): string {
  const enc = charset && /1251/.test(charset) ? encodeWin1251 : encodeURIComponent;
  return Object.keys(form)
    .map((k) => enc(k) + '=' + enc(form[k]))
    .join('&');
}

export function createNodeHttp(defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS): NodeHttp {
  let jar: Cookie[] = [];

  const cookieHeader = (url: string): string => {
    const h = hostOf(url);
    return jar
      .filter((c) => h === c.domain || h.slice(-(c.domain.length + 1)) === '.' + c.domain)
      .map((c) => c.name + '=' + c.value)
      .join('; ');
  };

  const store = (url: string, setCookies: string[]) => {
    const h = hostOf(url);
    setCookies.forEach((line) => {
      const parts = line.split(';');
      const eq = parts[0].indexOf('=');
      if (eq <= 0) return;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1).trim();
      let domain = h;
      let gone = value === '' || value === 'deleted';
      for (let i = 1; i < parts.length; i++) {
        const [k, v] = parts[i].split('=').map((x) => (x || '').trim());
        const key = k.toLowerCase();
        if (key === 'domain' && v) domain = v.replace(/^\./, '').toLowerCase();
        if (key === 'max-age' && parseInt(v, 10) <= 0) gone = true;
        if (key === 'expires' && Date.parse(v) < Date.now()) gone = true;
      }
      jar = jar.filter((c) => !(c.domain === domain && c.name === name));
      if (!gone) jar.push({ domain, name, value });
    });
  };

  const http: NodeHttp = {
    last: null,
    first: null,
    reset() {
      http.last = null;
      http.first = null;
    },
    get: (url, opts) => send('GET', url, undefined, opts),
    post: (url, form, opts) => send('POST', url, form, opts),
    clearCookies(url) {
      const h = hostOf(url);
      jar = jar.filter((c) => !(h === c.domain || h.slice(-(c.domain.length + 1)) === '.' + c.domain));
      return Promise.resolve();
    },
  };

  async function send(method: 'GET' | 'POST', url: string, form: { [k: string]: string } | undefined, opts?: HttpOptions): Promise<HttpResponse> {
    if (!/^https?:\/\//i.test(url)) throw new Error('bad url');
    const timeout = (opts && opts.timeoutMs) || defaultTimeoutMs;
    const deadline = Date.now() + timeout;
    let current = url;
    let m = method;
    let body = form ? encodeForm(form, opts && opts.formCharset) : undefined;
    for (let hop = 0; hop < 10; hop++) {
      const headers: { [k: string]: string } = {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      };
      if (opts && opts.headers) Object.keys(opts.headers).forEach((k) => (headers[k] = opts.headers![k]));
      const cookie = cookieHeader(current);
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      let res: Response;
      try {
        res = await monitorFetch(current, { method: m, headers, body, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
      } catch (e) {
        const name = e && typeof e === 'object' ? (e as { name?: string }).name : '';
        const cause = e && typeof e === 'object' ? (e as { cause?: { code?: string; message?: string } }).cause : undefined;
        if (name === 'TimeoutError' || name === 'AbortError') throw netError('timeout', 'нет ответа за ' + Math.round(timeout / 1000) + ' с');
        throw netError('network', (cause && (cause.code || cause.message)) || (e instanceof Error ? e.message : String(e)));
      }
      const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      store(current, set);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer().catch(() => undefined);
        current = new URL(loc, current).toString();
        if (res.status !== 307 && res.status !== 308) {
          m = 'GET';
          body = undefined;
        }
        continue;
      }
      let buf: Uint8Array;
      try {
        buf = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        throw netError('timeout', 'ответ оборвался');
      }
      const out: HttpResponse = {
        status: res.status,
        url: current,
        text: decode(buf, res.headers.get('content-type') || '', opts && opts.responseCharset),
      };
      const cf = res.headers.get('cf-mitigated');
      if (cf) out.cfMitigated = cf;
      http.last = out;
      if (!http.first) http.first = out;
      return out;
    }
    throw netError('network', 'слишком много перенаправлений');
  }

  return http;
}
