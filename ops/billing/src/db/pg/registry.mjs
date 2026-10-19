/**
 * Device registry and refresh tokens on Postgres, as async functions over a pg client. Token format,
 * signing and the device name rules come from src/registry.mjs.
 * Writes that read-then-write (refresh, upgrade) take the store's write lock.
 */
import { randomBytes } from 'node:crypto';
import { randomId, sha256 } from '../../crypto.mjs';
import { truncateIp } from '../../logic.mjs';
import {
  CLONE_LOG_EVERY_MS,
  REFRESH_TTL_MS,
  ROTATE_GRACE_MS,
  checkAccessRow,
  deviceNameOf,
  seenDueAt,
  signAccess,
  parseAccess,
} from '../../registry.mjs';
import { LOCK_WRITE } from './schema.mjs';

const REFRESH_PREFIX = 'r1.';

async function one(q, sql, params) {
  const r = await q.query(sql, params);
  return r.rows[0] || null;
}

export async function deviceRow(q, id) {
  if (!id) return null;
  return one(q, 'SELECT * FROM devices WHERE id = $1', [String(id)]);
}

export async function activeRowForCode(q, codeId) {
  if (!codeId) return null;
  return one(q, "SELECT * FROM devices WHERE code_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [String(codeId)]);
}

export async function activeRowsByCode(q) {
  const rows = (await q.query("SELECT * FROM devices WHERE status = 'active' ORDER BY created_at")).rows;
  const out = new Map();
  for (let i = 0; i < rows.length; i++) out.set(rows[i].code_id, rows[i]);
  return out;
}

export async function listDevices(q, subscriptionId) {
  const rows = (
    await q.query(
      `SELECT d.*, (SELECT COUNT(*) FROM refresh_tokens t WHERE t.device_row_id = d.id AND t.revoked = 0 AND t.rotated_at = 0) AS live_tokens
       FROM devices d WHERE d.subscription_id = $1 AND d.status = 'active' ORDER BY d.bound_at, d.created_at`,
      [String(subscriptionId || '')],
    )
  ).rows;
  return rows.map((r) => {
    const { live_tokens: live, ...row } = r;
    return { ...row, auth: Number(live) > 0 ? 'refresh' : 'legacy' };
  });
}

/** Counts of active devices by token kind: refresh (new pair) vs legacy (old opaque). For the admin home prep before strict tokens. */
export async function authStats(q, now) {
  const at = Number(now) || Date.now();
  const r = (
    await q.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE live > 0)::int AS refresh,
         COUNT(*) FILTER (WHERE live = 0)::int AS legacy
       FROM (
         SELECT d.id,
           (SELECT COUNT(*) FROM refresh_tokens t
             WHERE t.device_row_id = d.id AND t.revoked = 0 AND t.rotated_at = 0 AND t.expires_at > $1) AS live
         FROM devices d WHERE d.status = 'active'
       ) x`,
      [at],
    )
  ).rows[0] || { total: 0, refresh: 0, legacy: 0 };
  return { total: Number(r.total) || 0, refresh: Number(r.refresh) || 0, legacy: Number(r.legacy) || 0 };
}

export async function revokeRow(q, id, reason, now) {
  const at = Number(now) || Date.now();
  const res = await q.query("UPDATE devices SET status = 'revoked', revoked_at = $1, revoke_reason = $2 WHERE id = $3 AND status = 'active'", [
    at,
    String(reason || 'revoked'),
    String(id),
  ]);
  await q.query('UPDATE refresh_tokens SET revoked = 1 WHERE device_row_id = $1', [String(id)]);
  return res.rowCount > 0;
}

export async function setRevokeReason(q, id, reason) {
  await q.query("UPDATE devices SET revoke_reason = $1 WHERE id = $2 AND status = 'revoked'", [String(reason), String(id)]);
}

/** Same as syncRegistry in src/registry.mjs; runs inside the state write transaction. */
export async function syncRegistry(q, state, now) {
  const at = Number(now) || Date.now();
  const active = (await q.query("SELECT * FROM devices WHERE status = 'active' ORDER BY created_at")).rows;
  const byCode = new Map();
  for (let i = 0; i < active.length; i++) {
    const r = active[i];
    if (byCode.has(r.code_id)) await revokeRow(q, r.id, 'duplicate', at);
    else byCode.set(r.code_id, r);
  }
  const revokedBinding = new Set();
  const gone = (await q.query("SELECT code_id, device_id, bound_at FROM devices WHERE status = 'revoked'")).rows;
  for (let i = 0; i < gone.length; i++) revokedBinding.add(gone[i].code_id + '\0' + gone[i].device_id + '\0' + Number(gone[i].bound_at));
  const subs = new Map((state.subscriptions || []).map((s) => [s.id, s]));
  const seen = new Set();
  const codes = state.codes || [];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (!c || !c.id) continue;
    seen.add(c.id);
    const want = !!c.deviceId && !c.revoked;
    let row = byCode.get(c.id) || null;
    if (row && (!want || row.device_id !== c.deviceId || Number(row.bound_at) !== (Number(c.boundAt) || 0))) {
      await revokeRow(q, row.id, 'unbound', at);
      row = null;
    }
    if (want && !row && !revokedBinding.has(c.id + '\0' + c.deviceId + '\0' + (Number(c.boundAt) || 0))) {
      const sub = subs.get(c.subscriptionId);
      await q.query(
        `INSERT INTO devices (id, subscription_id, account_id, code_id, device_id, created_at, bound_at, last_seen_at, last_ip_net, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
        [
          randomId() + randomId(),
          String(c.subscriptionId || ''),
          sub ? String(sub.accountId || '') : '',
          c.id,
          String(c.deviceId),
          Number(c.boundAt) || at,
          Number(c.boundAt) || 0,
          Number(c.lastSeenAt) || 0,
          truncateIp(c.lastIp || ''),
        ],
      );
    }
  }
  for (const [codeId, row] of byCode) {
    if (!seen.has(codeId)) await revokeRow(q, row.id, 'unbound', at);
  }
}

export async function touchRow(q, id, { ip, now, force }) {
  const row = await deviceRow(q, id);
  if (!row || row.status !== 'active') return false;
  if (!force && !seenDueAt(row.last_seen_at, now)) return false;
  const addr = truncateIp(ip) || row.last_ip_net || '';
  await q.query('UPDATE devices SET last_seen_at = $1, last_ip_net = $2 WHERE id = $3', [now, addr, row.id]);
  return true;
}

export async function setDeviceName(q, id, raw) {
  const name = deviceNameOf(raw);
  if (!name) return false;
  const row = await deviceRow(q, id);
  if (!row || row.status !== 'active' || row.name === name) return false;
  await q.query('UPDATE devices SET name = $1 WHERE id = $2', [name, row.id]);
  return true;
}

/** BILLING_TOKEN_SECRET (32+ chars) or a random key kept in kv, created once. Never logged. */
export async function tokenSecret(q, env) {
  const fromEnv = String((env && env.BILLING_TOKEN_SECRET) || '');
  if (fromEnv.length >= 32) return fromEnv;
  await q.query("INSERT INTO kv (key, value) VALUES ('token_secret', $1) ON CONFLICT (key) DO NOTHING", [randomBytes(32).toString('hex')]);
  return (await one(q, "SELECT value FROM kv WHERE key = 'token_secret'", [])).value;
}

export async function verifyAccess(q, secret, token, deviceId, now) {
  const p = parseAccess(secret, token, deviceId, now);
  if (p.error) return p;
  return checkAccessRow(p.payload, await deviceRow(q, p.payload.dev), deviceId);
}

async function newRefresh(q, rowId, now) {
  const token = REFRESH_PREFIX + randomBytes(32).toString('base64url');
  const hash = sha256(token);
  await q.query('INSERT INTO refresh_tokens (hash, device_row_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    hash,
    rowId,
    now,
    now + REFRESH_TTL_MS,
  ]);
  return { token, hash };
}

export async function issuePair(q, secret, row, now) {
  const refresh = await newRefresh(q, row.id, now);
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

/** One transaction holding the write lock (serialized with state writes). */
export async function inTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_WRITE]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {
      /* connection broken: the server rolls back */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Same rules as refreshPair in src/registry.mjs (rotation, lost-response grace, clone mark). */
export async function refreshPair(pool, secret, { refreshToken, deviceId, now }) {
  const token = String(refreshToken || '');
  if (token.indexOf(REFRESH_PREFIX) !== 0 || token.length > 256) return { error: 'bad_token' };
  return inTx(pool, async (q) => {
    const t = await one(q, 'SELECT * FROM refresh_tokens WHERE hash = $1', [sha256(token)]);
    if (!t) return { error: 'bad_token' };
    await q.query('DELETE FROM refresh_tokens WHERE device_row_id = $1 AND expires_at < $2 AND hash <> $3', [t.device_row_id, now, t.hash]);
    const row = await deviceRow(q, t.device_row_id);
    if (!row || !deviceId || row.device_id !== deviceId) return { error: 'bad_token' };
    if (t.revoked || row.status !== 'active') return { error: 'revoked' };
    if (t.rotated_at) {
      const next = t.replaced_by ? await one(q, 'SELECT * FROM refresh_tokens WHERE hash = $1', [t.replaced_by]) : null;
      const lost = now - t.rotated_at <= ROTATE_GRACE_MS && next && !next.rotated_at && !next.revoked;
      if (!lost) {
        const cloneLog = !row.clone_at || now - row.clone_at >= CLONE_LOG_EVERY_MS || now < row.clone_at;
        await q.query('UPDATE devices SET clone_at = $1, clone_count = clone_count + 1 WHERE id = $2', [now, row.id]);
        const out = await issuePair(q, secret, row, now);
        await q.query('UPDATE refresh_tokens SET replaced_by = $1 WHERE hash = $2', [out.hash, t.hash]);
        return { row, pair: out.pair, clone: true, cloneLog };
      }
      await q.query('UPDATE refresh_tokens SET revoked = 1 WHERE hash = $1', [next.hash]);
      const out = await issuePair(q, secret, row, now);
      await q.query('UPDATE refresh_tokens SET replaced_by = $1 WHERE hash = $2', [out.hash, t.hash]);
      return { row, pair: out.pair, retry: true };
    }
    if (t.expires_at <= now) return { error: 'refresh_expired' };
    const out = await issuePair(q, secret, row, now);
    await q.query('UPDATE refresh_tokens SET rotated_at = $1, replaced_by = $2 WHERE hash = $3', [now, out.hash, t.hash]);
    return { row, pair: out.pair };
  });
}

export async function upgradePair(pool, secret, { row, now, again, since }) {
  return inTx(pool, async (q) => {
    if (again) {
      await q.query('UPDATE refresh_tokens SET revoked = 1 WHERE device_row_id = $1 AND rotated_at = 0 AND created_at >= $2', [row.id, since]);
    }
    return (await issuePair(q, secret, row, now)).pair;
  });
}
