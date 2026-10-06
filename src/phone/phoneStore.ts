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

/** A valid link or null; `at` defaults to `now`. */
export function sanitizePhoneLink(v: unknown, now?: number): PhoneLink | null {
  if (!isObject(v)) return null;
  const url = v.url;
  const token = v.token;
  if (typeof url !== 'string' || url.length > 100 || !URL_RE.test(url)) return null;
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
