/**
 * Device registry and short-lived tokens (PR-4 «Реестр и токены (сервер)»): the rules shared by the
 * Postgres registry (db/pg/registry.mjs). No database code lives here.
 *
 * Tables (db/pg/schema.mjs):
 *   devices         one row per binding of a code to a phone (registry id = `dev` in tokens);
 *   refresh_tokens  long-lived device credentials, stored as sha256 only, rotated on every use.
 * The state stays the source of truth for codes, limits and paid days. `syncRegistry` runs in the
 * same transaction as every state write, so a binding made or removed anywhere (activate, bot
 * «Отвязать», admin revoke, promo) shows up there without touching that code.
 *
 * Access tokens: `a1.<payload>.<sig>`, payload base64url JSON {sub, dev, did, iat, exp},
 * sig = HMAC-SHA256(secret, "a1." + payload). No header and no alg field, so `alg: none` and
 * algorithm swaps do not exist. The registry row is checked on every use: revoke is immediate.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256 } from './crypto.mjs';
import { SEEN_EVERY_MS } from './deviceAdmin.mjs';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Access token lifetime. */
export const ACCESS_TTL_MS = DAY;
/** A refresh token not used for this long stops working (each refresh issues a new one). */
export const REFRESH_TTL_MS = 180 * DAY;
/** A rotated refresh token (or an upgraded legacy token) is still accepted this long: lost responses on bad networks. */
export const ROTATE_GRACE_MS = MIN;

const ACCESS_PREFIX = 'a1';
const B64URL = /^[A-Za-z0-9_-]+$/;

/** A suspected clone is written to the journal at most this often per device; the count grows every time. */
export const CLONE_LOG_EVERY_MS = 60 * MIN;

/* ---------- lastSeen (same throttle as #142, but one row update instead of a state write) ---------- */

export function seenDueAt(last, now) {
  const l = Number(last) || 0;
  return !l || now - l >= SEEN_EVERY_MS || now < l;
}

/** Longest device name kept in the registry. */
export const DEVICE_NAME_MAX = 40;

/**
 * Device name from the phone, safe for the bot (Markdown) and the panel: letters, digits, spaces and . , - _ ( ) + /,
 * whitespace collapsed, at most DEVICE_NAME_MAX characters. '' when nothing is left.
 */
export function deviceNameOf(raw) {
  if (typeof raw !== 'string') return '';
  return Array.from(
    raw
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} .,()+\/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, DEVICE_NAME_MAX)
    .join('')
    .trim();
}

/* ---------- access tokens ---------- */

function deviceTag(deviceId) {
  return sha256('dev:' + String(deviceId || '')).slice(0, 16);
}

function sign(secret, data) {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
}

export function isAccessToken(token) {
  return typeof token === 'string' && token.indexOf(ACCESS_PREFIX + '.') === 0;
}

export function signAccess(secret, row, now) {
  const iat = Number(now) || Date.now();
  const payload = Buffer.from(
    JSON.stringify({ sub: row.subscription_id, dev: row.id, did: deviceTag(row.device_id), iat, exp: iat + ACCESS_TTL_MS }),
    'utf8',
  ).toString('base64url');
  const head = ACCESS_PREFIX + '.' + payload;
  return { token: head + '.' + sign(secret, head), expiresAt: iat + ACCESS_TTL_MS };
}

/** Signature, shape, device tag and expiry of an access token (no database). `{ payload }` or `{ error }`. */
export function parseAccess(secret, token, deviceId, now) {
  if (!isAccessToken(token) || token.length > 1024) return { error: 'bad_token' };
  const parts = token.split('.');
  if (parts.length !== 3 || !B64URL.test(parts[1]) || !B64URL.test(parts[2])) return { error: 'bad_token' };
  const want = Buffer.from(sign(secret, parts[0] + '.' + parts[1]), 'utf8');
  const got = Buffer.from(parts[2], 'utf8');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { error: 'bad_token' };
  let p;
  try {
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    return { error: 'bad_token' };
  }
  if (!p || typeof p !== 'object' || typeof p.dev !== 'string' || typeof p.sub !== 'string' || !Number.isFinite(p.exp)) {
    return { error: 'bad_token' };
  }
  if (!deviceId || p.did !== deviceTag(deviceId)) return { error: 'bad_token' };
  if (now >= p.exp) return { error: 'token_expired' };
  return { payload: p };
}

/** The registry row named by a valid token must still be this device's, on this subscription, and active. */
export function checkAccessRow(p, row, deviceId) {
  if (!row || row.device_id !== deviceId || row.subscription_id !== p.sub) return { error: 'bad_token' };
  if (row.status !== 'active') return { error: 'revoked', row };
  return { row, exp: p.exp };
}
