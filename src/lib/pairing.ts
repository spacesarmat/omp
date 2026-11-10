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
const OMP_PREFIX = 'omp://pair?';

function queryOf(d: PairData): string {
  let s = 'v=1';
  FIELDS.forEach((k) => {
    const v = d[k];
    if (v) s += '&' + k + '=' + encodeURIComponent(v);
  });
  return s;
}

/** https link the phone camera can open. The app claims it; the site is the fallback. */
export function buildPairUri(d: PairData): string {
  return PAIR_ORIGIN + '/pair?' + queryOf(d);
}

/**
 * Android intent link for the page button. The browser opens the app when it is installed,
 * and returns to the same https page when it is not.
 */
export function pairIntentUri(httpsUrl: string): string {
  const path = httpsUrl.indexOf(PAIR_ORIGIN) === 0 ? httpsUrl.slice(PAIR_ORIGIN.length) : '/pair';
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

export function parsePairUri(s: string): PairData | null {
  const query = queryFrom(s);
  if (query === null) return null;
  const out: { [k: string]: string } = {};
  let version = '';
  try {
    query.split('&').forEach((part) => {
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
