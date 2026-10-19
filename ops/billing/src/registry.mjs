/**
 * Device registry and short-lived tokens (PR-4 «Реестр и токены (сервер)»).
 *
 * Two SQLite tables beside the JSON snapshot:
 *   devices         one row per binding of a code to a phone (registry id = `dev` in tokens);
 *   refresh_tokens  long-lived device credentials, stored as sha256 only, rotated on every use.
 * The snapshot stays the source of truth for codes, limits and paid days. `syncRegistry` runs in
 * the same transaction as every snapshot write, so a binding made or removed anywhere (activate,
 * bot «Отвязать», admin revoke, promo, migration) shows up here without touching that code.
 *
 * Access tokens: `a1.<payload>.<sig>`, payload base64url JSON {sub, dev, did, iat, exp},
 * sig = HMAC-SHA256(secret, "a1." + payload). No header and no alg field, so `alg: none` and
 * algorithm swaps do not exist. The registry row is checked on every use: revoke is immediate.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomId, sha256 } from './crypto.mjs';
import { SEEN_EVERY_MS } from './deviceAdmin.mjs';
import { truncateIp } from './logic.mjs';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Access token lifetime. */
export const ACCESS_TTL_MS = DAY;
/** A refresh token not used for this long stops working (each refresh issues a new one). */
export const REFRESH_TTL_MS = 180 * DAY;
/** A rotated refresh token (or an upgraded legacy token) is still accepted this long: lost responses on bad networks. */
export const ROTATE_GRACE_MS = MIN;

const ACCESS_PREFIX = 'a1';
const REFRESH_PREFIX = 'r1.';
const B64URL = /^[A-Za-z0-9_-]+$/;

export function registrySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      code_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      bound_at INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      last_ip_net TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      revoked_at INTEGER NOT NULL DEFAULT 0,
      revoke_reason TEXT NOT NULL DEFAULT '',
      clone_at INTEGER NOT NULL DEFAULT 0,
      clone_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS devices_code ON devices (code_id, status);
    CREATE INDEX IF NOT EXISTS devices_sub ON devices (subscription_id, status);
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      hash TEXT PRIMARY KEY,
      device_row_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      rotated_at INTEGER NOT NULL DEFAULT 0,
      replaced_by TEXT NOT NULL DEFAULT '',
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS refresh_device ON refresh_tokens (device_row_id);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Columns added after the table first shipped.
  const cols = new Set(db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name));
  if (!cols.has('clone_at')) db.exec('ALTER TABLE devices ADD COLUMN clone_at INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('clone_count')) db.exec('ALTER TABLE devices ADD COLUMN clone_count INTEGER NOT NULL DEFAULT 0');
}

/** A suspected clone is written to the journal at most this often per device; the count grows every time. */
export const CLONE_LOG_EVERY_MS = 60 * MIN;

/* ---------- registry rows ---------- */

export function deviceRow(db, id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(String(id)) || null;
}

/** The active registry row of a bound code. */
export function activeRowForCode(db, codeId) {
  if (!codeId) return null;
  return db.prepare("SELECT * FROM devices WHERE code_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(String(codeId)) || null;
}

/**
 * Active devices of a subscription, oldest binding first; `auth` is 'refresh' once the phone holds a
 * refresh token; `clone_at` / `clone_count` mark a suspected copy.
 */
export function listDevices(db, subscriptionId) {
  const rows = db
    .prepare("SELECT * FROM devices WHERE subscription_id = ? AND status = 'active' ORDER BY bound_at, created_at")
    .all(String(subscriptionId || ''));
  const live = db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE device_row_id = ? AND revoked = 0 AND rotated_at = 0');
  return rows.map((r) => ({ ...r, auth: live.get(r.id).n > 0 ? 'refresh' : 'legacy' }));
}

/** Mark a row revoked and kill its refresh tokens. Access tokens die with it: every use checks the row. */
export function revokeRow(db, id, reason, now) {
  const at = Number(now) || Date.now();
  const res = db
    .prepare("UPDATE devices SET status = 'revoked', revoked_at = ?, revoke_reason = ? WHERE id = ? AND status = 'active'")
    .run(at, String(reason || 'revoked'), String(id));
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE device_row_id = ?').run(String(id));
  return res.changes > 0;
}

/** Replace the generic reason the snapshot sync wrote ('unbound') with the real one ('admin'). */
export function setRevokeReason(db, id, reason) {
  db.prepare("UPDATE devices SET revoke_reason = ? WHERE id = ? AND status = 'revoked'").run(String(reason), String(id));
}

/**
 * Bring the registry in line with the snapshot's bindings. A bound, unrevoked code has exactly one
 * active row; a row whose code was unbound, revoked, rebound (other device or a new boundAt) or
 * deleted is revoked with its tokens. A binding revoked in the registry is never re-created. New rows take lastSeen from the code (data before PR-4).
 * Idempotent; the first run is the migration.
 */
export function syncRegistry(db, state, now) {
  const at = Number(now) || Date.now();
  const active = db.prepare("SELECT * FROM devices WHERE status = 'active'").all();
  const byCode = new Map();
  for (let i = 0; i < active.length; i++) {
    const r = active[i];
    if (byCode.has(r.code_id)) revokeRow(db, r.id, 'duplicate', at);
    else byCode.set(r.code_id, r);
  }
  const revokedBinding = new Map();
  const gone = db.prepare("SELECT code_id, device_id, bound_at FROM devices WHERE status = 'revoked'").all();
  for (let i = 0; i < gone.length; i++) revokedBinding.set(gone[i].code_id + '\0' + gone[i].device_id + '\0' + Number(gone[i].bound_at), 1);
  const subs = new Map((state.subscriptions || []).map((s) => [s.id, s]));
  const seen = new Set();
  const insert = db.prepare(
    `INSERT INTO devices (id, subscription_id, account_id, code_id, device_id, created_at, bound_at, last_seen_at, last_ip_net, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  );
  const codes = state.codes || [];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (!c || !c.id) continue;
    seen.add(c.id);
    const want = !!c.deviceId && !c.revoked;
    let row = byCode.get(c.id) || null;
    if (row && (!want || row.device_id !== c.deviceId || Number(row.bound_at) !== (Number(c.boundAt) || 0))) {
      revokeRow(db, row.id, 'unbound', at);
      row = null;
    }
    // A binding revoked here (admin) stays revoked even before the snapshot catches up.
    if (want && !row && !revokedBinding.get(c.id + '\0' + c.deviceId + '\0' + (Number(c.boundAt) || 0))) {
      const sub = subs.get(c.subscriptionId);
      insert.run(
        randomId() + randomId(),
        String(c.subscriptionId || ''),
        sub ? String(sub.accountId || '') : '',
        c.id,
        c.deviceId,
        Number(c.boundAt) || at,
        Number(c.boundAt) || 0,
        Number(c.lastSeenAt) || 0,
        truncateIp(c.lastIp || ''),
      );
    }
  }
  for (const [codeId, row] of byCode) {
    if (!seen.has(codeId)) revokeRow(db, row.id, 'unbound', at);
  }
}

/* ---------- lastSeen (same throttle as #142, but one row update instead of a snapshot write) ---------- */

export function seenDueAt(last, now) {
  const l = Number(last) || 0;
  return !l || now - l >= SEEN_EVERY_MS || now < l;
}

/** lastSeen / truncated IP of an active row; at most once per SEEN_EVERY_MS unless `force`. Returns true when written. */
export function touchRow(db, id, { ip, now, force }) {
  const row = deviceRow(db, id);
  if (!row || row.status !== 'active') return false;
  if (!force && !seenDueAt(row.last_seen_at, now)) return false;
  const addr = truncateIp(ip) || row.last_ip_net || '';
  db.prepare('UPDATE devices SET last_seen_at = ?, last_ip_net = ? WHERE id = ?').run(now, addr, row.id);
  return true;
}

/* ---------- secret ---------- */

const secrets = new WeakMap();

/**
 * HMAC key for access tokens: BILLING_TOKEN_SECRET (32+ chars) when set, otherwise a random key
 * created once and kept in the kv table of billing.db. Never logged or sent anywhere.
 */
export function tokenSecret(db, env) {
  const fromEnv = String((env && env.BILLING_TOKEN_SECRET) || '');
  if (fromEnv.length >= 32) return fromEnv;
  const cached = secrets.get(db);
  if (cached) return cached;
  let row = db.prepare("SELECT value FROM kv WHERE key = 'token_secret'").get();
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('token_secret', ?)").run(randomBytes(32).toString('hex'));
    row = db.prepare("SELECT value FROM kv WHERE key = 'token_secret'").get();
  }
  secrets.set(db, row.value);
  return row.value;
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

/**
 * Check an access token for `deviceId`. Errors: bad_token (malformed, forged, other device,
 * unknown row), token_expired (signature fine, exp passed), revoked (row revoked).
 */
export function verifyAccess(db, secret, token, deviceId, now) {
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
  const row = deviceRow(db, p.dev);
  if (!row || row.device_id !== deviceId || row.subscription_id !== p.sub) return { error: 'bad_token' };
  if (row.status !== 'active') return { error: 'revoked', row };
  return { row, exp: p.exp };
}

/* ---------- refresh tokens ---------- */

function newRefresh(db, rowId, now) {
  const token = REFRESH_PREFIX + randomBytes(32).toString('base64url');
  const hash = sha256(token);
  db.prepare('INSERT INTO refresh_tokens (hash, device_row_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hash,
    rowId,
    now,
    now + REFRESH_TTL_MS,
  );
  return { token, hash };
}

/** A fresh refresh/access pair for an active row. */
export function issuePair(db, secret, row, now) {
  const refresh = newRefresh(db, row.id, now);
  const access = signAccess(secret, row, now);
  return {
    pair: {
      refreshToken: refresh.token,
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: now + REFRESH_TTL_MS,
    },
    hash: refresh.hash,
  };
}

function inTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (e2) {
      /* already rolled back */
    }
    throw e;
  }
}

/**
 * Exchange a refresh token for a new pair; the presented one is rotated.
 * A rotated token presented again within ROTATE_GRACE_MS, while its successor is still unused,
 * is a lost response: the unused successor is dropped and a new pair issued. Any other reuse of a
 * rotated token suggests two holders. That only marks the row (`clone_at`, `clone_count`; `clone:
 * true`, `cloneLog` when the journal should hear about it): nothing is revoked and the caller still
 * gets a pair, so a false alarm never locks a phone out. The admin revokes by hand.
 * Errors: bad_token, refresh_expired, revoked.
 */
export function refreshPair(db, secret, { refreshToken, deviceId, now }) {
  const token = String(refreshToken || '');
  if (token.indexOf(REFRESH_PREFIX) !== 0 || token.length > 256) return { error: 'bad_token' };
  return inTx(db, () => {
    const t = db.prepare('SELECT * FROM refresh_tokens WHERE hash = ?').get(sha256(token));
    if (!t) return { error: 'bad_token' };
    // Tokens past their lifetime are kept only as clone tripwires until then; drop the rest of this device's.
    db.prepare('DELETE FROM refresh_tokens WHERE device_row_id = ? AND expires_at < ? AND hash != ?').run(t.device_row_id, now, t.hash);
    const row = deviceRow(db, t.device_row_id);
    if (!row || !deviceId || row.device_id !== deviceId) return { error: 'bad_token' };
    if (t.revoked || row.status !== 'active') return { error: 'revoked' };
    if (t.rotated_at) {
      const next = t.replaced_by ? db.prepare('SELECT * FROM refresh_tokens WHERE hash = ?').get(t.replaced_by) : null;
      const lost = now - t.rotated_at <= ROTATE_GRACE_MS && next && !next.rotated_at && !next.revoked;
      if (!lost) {
        const cloneLog = !row.clone_at || now - row.clone_at >= CLONE_LOG_EVERY_MS || now < row.clone_at;
        db.prepare('UPDATE devices SET clone_at = ?, clone_count = clone_count + 1 WHERE id = ?').run(now, row.id);
        const out = issuePair(db, secret, row, now);
        db.prepare('UPDATE refresh_tokens SET replaced_by = ? WHERE hash = ?').run(out.hash, t.hash);
        return { row, pair: out.pair, clone: true, cloneLog };
      }
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE hash = ?').run(next.hash);
      const out = issuePair(db, secret, row, now);
      db.prepare('UPDATE refresh_tokens SET replaced_by = ? WHERE hash = ?').run(out.hash, t.hash);
      return { row, pair: out.pair, retry: true };
    }
    if (t.expires_at <= now) return { error: 'refresh_expired' };
    const out = issuePair(db, secret, row, now);
    db.prepare('UPDATE refresh_tokens SET rotated_at = ?, replaced_by = ? WHERE hash = ?').run(now, out.hash, t.hash);
    return { row, pair: out.pair };
  });
}

/**
 * Pair for a phone that proved itself with the legacy opaque token (`/v1/token/upgrade`).
 * `again` (the same legacy token within the grace window) drops refresh tokens issued by the
 * first upgrade that were never used, so only the newest pair stays.
 */
export function upgradePair(db, secret, { row, now, again, since }) {
  return inTx(db, () => {
    if (again) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE device_row_id = ? AND rotated_at = 0 AND created_at >= ?').run(row.id, since);
    }
    return issuePair(db, secret, row, now).pair;
  });
}
