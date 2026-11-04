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
  /** The phone had an OMP subscription at the last launch or RPC answer. Absent: not known. */
  sub?: boolean;
  /** Unix ms when `sub` was last set. A `sub: true` older than PHONE_SUB_TTL_MS does not hide ads. */
  subAt?: number;
}

/** How long a linked phone's subscription hides TV ads after the last answer. A silent phone falls back to free. */
export const PHONE_SUB_TTL_MS = 6 * 60 * 60 * 1000;

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
  const link: PhoneLink = { url: url, token: token, name: name, at: at };
  if (v.sub === true || v.sub === false) {
    link.sub = v.sub;
    const stamp = typeof v.subAt === 'number' && isFinite(v.subAt) && v.subAt >= 0 ? v.subAt : at;
    link.subAt = stamp;
  }
  return link;
}

/** True only while `sub` is true and the stamp is inside PHONE_SUB_TTL_MS. A missing stamp uses `at`. */
export function phoneLinkSubscribed(link: PhoneLink | null, now?: number): boolean {
  if (!link || link.sub !== true) return false;
  const at = now === undefined ? Date.now() : now;
  const stamp = typeof link.subAt === 'number' ? link.subAt : link.at;
  if (!stamp || stamp > at + 60000) return false;
  return at - stamp <= PHONE_SUB_TTL_MS;
}

function load(): PhoneLink | null {
  const link = sanitizePhoneLink(loadJson<unknown>(PHONE_KEY, null), 0);
  if (!link || link.sub !== true || phoneLinkSubscribed(link)) return link;
  const next: PhoneLink = { url: link.url, token: link.token, name: link.name, at: link.at, sub: false, subAt: link.subAt || link.at };
  saveJson(PHONE_KEY, next);
  return next;
}

export const phoneLink = signal<PhoneLink | null>(load());

/** Stores the address from a launch; an unchanged one only refreshes `at` in storage (no signal update). */
export function savePhoneLink(p: { url: string; token: string; name: string; sub?: boolean }): void {
  const now = Date.now();
  const raw: { url: string; token: string; name: string; sub?: boolean; at: number; subAt?: number } = {
    url: p.url,
    token: p.token,
    name: p.name,
    sub: p.sub,
    at: now,
  };
  if (p.sub === true || p.sub === false) raw.subAt = now;
  const next = sanitizePhoneLink(raw);
  if (!next) return;
  const cur = phoneLink.value;
  saveJson(PHONE_KEY, next);
  if (cur && cur.url === next.url && cur.token === next.token && cur.name === next.name && cur.sub === next.sub && cur.subAt === next.subAt) return;
  phoneLink.value = next;
}

/** The linked phone's subscription, from a launch param or `ompSubscribed` on the phone. Repeating `true` refreshes the TTL. */
export function setPhoneSubscribed(sub: boolean, now?: number): void {
  const cur = phoneLink.value;
  if (!cur) return;
  const at = now === undefined ? Date.now() : now;
  if (cur.sub === sub && sub === false) return;
  if (cur.sub === sub && cur.subAt === at) return;
  const next: PhoneLink = { url: cur.url, token: cur.token, name: cur.name, at: cur.at, sub: sub, subAt: at };
  saveJson(PHONE_KEY, next);
  phoneLink.value = next;
}

/** A `sub: true` past PHONE_SUB_TTL_MS becomes false, so ads are not hidden by a silent phone. */
export function expirePhoneSub(now?: number): void {
  const cur = phoneLink.value;
  if (!cur || cur.sub !== true || phoneLinkSubscribed(cur, now)) return;
  setPhoneSubscribed(false, now);
}

export function forgetPhoneLink(): void {
  phoneLink.value = null;
  try {
    localStorage.removeItem(PHONE_KEY);
  } catch (e) {
    // storage unavailable
  }
}
