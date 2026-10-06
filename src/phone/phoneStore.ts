// The phone that serves this TV's site search (its OMP app, PhoneRpcService): the address it sends in the launch params.
// The token is a credential: it is never logged or shown.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../store/storage';

export interface PhoneLink {
  url: string;
  token: string;
  /** The phone model, e.g. «Samsung SM-G998B»; may be empty. */
  name: string;
  /** Unix ms of the last launch that carried it. */
  at: number;
}

export const PHONE_KEY = 'tsp.phoneLink';

const URL_RE = /^http:\/\/[0-9a-z.\-:[\]]+:\d{1,5}$/i;
const TOKEN_RE = /^[0-9a-f]{32}$/;

function privateV4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = [+m[1], +m[2], +m[3], +m[4]];
  for (let i = 0; i < 4; i++) if (o[i] > 255) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 169 && o[1] === 254);
}

function privateV6(host: string): boolean {
  const h = host.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(h) || h.indexOf(':') < 0) return false;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped) return privateV4(mapped[1]);
  const first = h.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const n = parseInt(first, 16);
  // fe80::/10 link-local, fc00::/7 ULA
  return (n >= 0xfe80 && n <= 0xfebf) || (n >= 0xfc00 && n <= 0xfdff);
}

/**
 * Only a private-LAN address literal, the same ranges the phone's server accepts clients from (10/8, 172.16/12,
 * 192.168/16, 169.254/16, fe80::/10, fc00::/7): a launch from another paired device cannot point the search elsewhere.
 */
function lanUrl(url: string): boolean {
  const m = /^http:\/\/(?:\[([^\]]+)\]|([0-9.]+)):(\d{1,5})$/i.exec(url);
  if (!m) return false;
  const port = +m[3];
  if (port < 1 || port > 65535) return false;
  return m[1] !== undefined ? privateV6(m[1]) : privateV4(m[2]);
}

/** A valid link or null; `at` defaults to `now`. */
export function sanitizePhoneLink(v: unknown, now?: number): PhoneLink | null {
  if (!isObject(v)) return null;
  const url = v.url;
  const token = v.token;
  if (typeof url !== 'string' || url.length > 100 || !URL_RE.test(url) || !lanUrl(url)) return null;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const name = typeof v.name === 'string' ? v.name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 60) : '';
  const at = typeof v.at === 'number' && isFinite(v.at) && v.at >= 0 ? v.at : now !== undefined ? now : Date.now();
  return { url: url, token: token, name: name, at: at };
}

function load(): PhoneLink | null {
  return sanitizePhoneLink(loadJson<unknown>(PHONE_KEY, null), 0);
}

export const phoneLink = signal<PhoneLink | null>(load());

/** Stores the address from a launch; an unchanged one only refreshes `at` in storage (no signal update). */
export function savePhoneLink(p: { url: string; token: string; name: string }): void {
  const next = sanitizePhoneLink({ url: p.url, token: p.token, name: p.name });
  if (!next) return;
  const cur = phoneLink.value;
  saveJson(PHONE_KEY, next);
  if (cur && cur.url === next.url && cur.token === next.token && cur.name === next.name) return;
  phoneLink.value = next;
}

export function forgetPhoneLink(): void {
  phoneLink.value = null;
  try {
    localStorage.removeItem(PHONE_KEY);
  } catch (e) {
    // storage unavailable
  }
}
