// The user's FlareSolverr (the fallback past Cloudflare checks when the built-in one does not pass): its address in
// tsp.flaresolverr { url } — an address only, never cookies. Storage only, so the TV bundle's native http can read it
// without pulling the screens in. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { cleanAddressText } from '../api/serverAddress';

export const FLARE_KEY = 'tsp.flaresolverr';
export const FLARE_PORT = 8191;

/**
 * An http(s) address of FlareSolverr cleaned of credentials, query, hash and trailing slashes; a bare host gets http://
 * and the usual port 8191. null when it is not an address.
 */
export function normalizeFlareUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = cleanAddressText(raw, { innerSpaces: true }).replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!s || s.length > 200) return null;
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (bare) s = 'http://' + s;
  const m = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\d{1,5}))?(\/[^\s@]*)?$/i.exec(s);
  if (!m) return null;
  const port = m[3] ? +m[3] : 0;
  if (m[3] && (port < 1 || port > 65535)) return null;
  const withPort = m[3] ? ':' + port : bare && !m[4] ? ':' + FLARE_PORT : '';
  return m[1].toLowerCase() + '://' + m[2].toLowerCase() + withPort + (m[4] || '');
}

export interface FlareSettings {
  url: string;
}

export function sanitizeFlare(v: unknown): FlareSettings | null {
  if (!isObject(v)) return null;
  const url = normalizeFlareUrl(v.url);
  return url ? { url } : null;
}

const listeners: Array<() => void> = [];

/** The saved FlareSolverr address, null when none. */
export function flareSolverrUrl(): string | null {
  const s = sanitizeFlare(loadJson<unknown>(FLARE_KEY, null, (x) => x === null || isObject(x)));
  return s ? s.url : null;
}

/** Saves (or with null forgets) the address. */
export function setFlareSolverrUrl(url: string | null): void {
  const clean = url ? normalizeFlareUrl(url) : null;
  saveJson(FLARE_KEY, clean ? { url: clean } : null);
  listeners.slice().forEach((cb) => cb());
}

export function onFlareChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}
