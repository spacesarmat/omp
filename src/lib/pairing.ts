export interface PairData {
  url: string;
  name?: string;
  user?: string;
  password?: string;
}

/** QR payload shown on the TV («Подключить телефон») and opened by the phone. */
export const PAIR_ORIGIN = 'https://omp-player.online';
export const PAIR_PACKAGE = 'com.spacesarmat.omp';

const FIELDS: (keyof PairData)[] = ['url', 'name', 'user', 'password'];
const SECRET: (keyof PairData)[] = ['user', 'password'];
const OMP_PREFIX = 'omp://pair?';

/** Public query only. Login and password stay in the fragment, so the site and its logs never receive them. */
function queryOf(d: PairData): string {
  let s = 'v=1';
  if (d.url) s += '&url=' + encodeURIComponent(d.url);
  if (d.name) s += '&name=' + encodeURIComponent(d.name);
  return s;
}

function hashOf(d: PairData): string {
  const parts: string[] = [];
  SECRET.forEach((k) => {
    const v = d[k];
    if (v) parts.push(k + '=' + encodeURIComponent(v));
  });
  return parts.length ? '#' + parts.join('&') : '';
}

/** https link the phone camera can open. The app claims it; the site is the fallback. */
export function buildPairUri(d: PairData): string {
  return PAIR_ORIGIN + '/pair?' + queryOf(d) + hashOf(d);
}

/**
 * Android intent link for the page button. The browser opens the app when it is installed,
 * and returns to the same https page when it is not.
 */
export function pairIntentUri(httpsUrl: string): string {
  const hashAt = httpsUrl.indexOf('#');
  const base = hashAt >= 0 ? httpsUrl.slice(0, hashAt) : httpsUrl;
  const frag = hashAt >= 0 ? httpsUrl.slice(hashAt + 1) : '';
  // The view intent is not an HTTP request. Credentials ride on it so the app can pair,
  // while the browser fallback keeps them in the fragment only.
  const appUrl = frag ? base + (base.indexOf('?') >= 0 ? '&' : '?') + frag : base;
  const path = appUrl.indexOf(PAIR_ORIGIN) === 0 ? appUrl.slice(PAIR_ORIGIN.length) : '/pair';
  return 'intent://omp-player.online' + path + '#Intent;scheme=https;package=' + PAIR_PACKAGE + ';S.browser_fallback_url=' + encodeURIComponent(httpsUrl) + ';end';
}

function queryFrom(raw: string): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw.indexOf(OMP_PREFIX) === 0) return raw.slice(OMP_PREFIX.length);
  const intent = /^intent:\/\/(?:www\.)?omp-player\.online(\/pair\/?\?[^#]*)#Intent;/i.exec(raw);
  if (intent) {
    const q = intent[1].indexOf('?');
    return q >= 0 ? intent[1].slice(q + 1) : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (e) {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'omp-player.online') return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/pair') return null;
  return url.search.charAt(0) === '?' ? url.search.slice(1) : url.search;
}

/** Fragment of an https link. Intent URIs use #Intent, which is not a credential fragment. */
function hashFrom(raw: string): string {
  if (raw.indexOf(OMP_PREFIX) === 0 || /^intent:/i.test(raw)) return '';
  try {
    const url = new URL(raw);
    return url.hash.charAt(0) === '#' ? url.hash.slice(1) : '';
  } catch (e) {
    return '';
  }
}

export function parsePairUri(s: string): PairData | null {
  const query = queryFrom(s);
  if (query === null) return null;
  const hash = hashFrom(s);
  const combined = hash ? query + '&' + hash : query;
  const out: { [k: string]: string } = {};
  let version = '';
  try {
    combined.split('&').forEach((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const k = part.slice(0, eq);
      const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
      if (k === 'v') version = v;
      else if (FIELDS.indexOf(k as keyof PairData) >= 0 && v) out[k] = v;
    });
  } catch (e) {
    return null;
  }
  if (version !== '1' || !out.url) return null;
  return out as unknown as PairData;
}
