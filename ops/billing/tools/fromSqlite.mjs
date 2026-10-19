/**
 * One-shot data migration billing.db (SQLite) → Postgres (plan, section 3).
 *
 *  1. Snapshot the source with the SQLite backup API (a consistent copy even while billing runs) and read
 *     the copy read-only: the JSON snapshot and the registry tables (devices, refresh_tokens, token key).
 *  2. Prepare the state: normalizeState; reject rows with a missing or duplicate key and duplicate settled
 *     YooMoney operations; promos: usage history is not carried over, so an exhausted promo (single-use
 *     already redeemed) is migrated as revoked and a partly used one keeps only its remaining uses; log retention.
 *  3. One transaction on an empty target under the write lock: registry rows copied as they are (phones keep
 *     their tokens), the state written, syncRegistry (must change nothing), store_version = 1.
 *  4. Verify inside the same transaction: counts and exact content per collection, a checksum per
 *     subscription, behaviour per subscription (access, limit and its text, bound devices, swaps) against the
 *     source as it was, the registry rows and the token key. Any mismatch → ROLLBACK.
 *  5. COMMIT only with `apply`; a dry run always rolls back.
 *
 * The report holds counts, ids and short hashes only: no settings values, tokens or connection strings.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { swapStatus } from '../src/deviceAdmin.mjs';
import {
  activeBonus,
  activeExtras,
  boundDevices,
  codeWithinLimit,
  creditOf,
  deviceLimitNow,
  dueReminders,
  financeReport,
  limitBreakdown,
  renewalPrice,
  subAccess,
} from '../src/logic.mjs';
import { expiredLogCounts, pruneLogs } from '../src/retention.mjs';
import { normalizeState } from '../src/state.mjs';
import * as reg from '../src/db/pg/registry.mjs';
import { LOCK_WRITE } from '../src/db/pg/schema.mjs';
import { COLLECTIONS } from '../src/db/pg/spec.mjs';
import { loadAll, openPool, writeDiff } from '../src/db/pg/store.mjs';

const DEVICE_COLS = [
  'id', 'subscription_id', 'account_id', 'code_id', 'device_id', 'name', 'platform', 'created_at', 'bound_at',
  'last_seen_at', 'last_ip_net', 'status', 'revoked_at', 'revoke_reason', 'clone_at', 'clone_count',
];
const REFRESH_COLS = ['hash', 'device_row_id', 'created_at', 'expires_at', 'rotated_at', 'replaced_by', 'revoked'];
const DEVICE_DEFAULTS = { name: '', platform: '', account_id: '', bound_at: 0, last_seen_at: 0, last_ip_net: '', status: 'active', revoked_at: 0, revoke_reason: '', clone_at: 0, clone_count: 0 };
const REFRESH_DEFAULTS = { rotated_at: 0, replaced_by: '', revoked: 0 };

/** JSON with sorted keys: equal values give equal text whatever the key order. */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function short(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

const json = (v) => JSON.parse(JSON.stringify(v));

/** Copy the source with the SQLite backup API and read the copy (deleted before returning). */
export async function readSource(sourcePath) {
  const size = statSync(sourcePath).size;
  const dir = mkdtempSync(join(tmpdir(), 'omp-pgmig-'));
  const copy = join(dir, 'billing.db');
  try {
    const live = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      await backup(live, copy);
    } finally {
      live.close();
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      const row = tables.has('snapshot') ? db.prepare('SELECT data FROM snapshot WHERE id = 1').get() : null;
      if (!row || typeof row.data !== 'string' || !row.data) throw new Error('source has no billing snapshot');
      const raw = JSON.parse(row.data);
      const devices = tables.has('devices') ? db.prepare('SELECT * FROM devices ORDER BY created_at, id').all() : [];
      const refresh = tables.has('refresh_tokens') ? db.prepare('SELECT * FROM refresh_tokens ORDER BY created_at, hash').all() : [];
      const secretRow = tables.has('kv') ? db.prepare("SELECT value FROM kv WHERE key = 'token_secret'").get() : null;
      return {
        raw,
        devices: devices.map((r) => ({ ...r })),
        refresh: refresh.map((r) => ({ ...r })),
        tokenSecret: secretRow ? String(secretRow.value) : '',
        bytes: size,
        sha256: createHash('sha256').update(row.data).digest('hex'),
      };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rows without a usable key, or with a key used twice, per collection (and per child array). */
export function keyProblems(state) {
  const problems = [];
  for (const spec of COLLECTIONS) {
    const list = Array.isArray(state[spec.name]) ? state[spec.name] : [];
    const seen = new Set();
    let missing = 0;
    let dup = 0;
    let notObject = 0;
    for (const row of list) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        notObject++;
        continue;
      }
      const k = row[spec.key];
      if (typeof k !== 'string' || !k) missing++;
      else if (seen.has(k)) dup++;
      else seen.add(k);
    }
    if (missing || dup || notObject) problems.push({ collection: spec.name, key: spec.key, missing, duplicate: dup, notObject });
  }
  // Child rows with their own ids (stable ids, PR 1): device changes and bonus slots, unique within the subscription.
  for (const sub of Array.isArray(state.subscriptions) ? state.subscriptions : []) {
    for (const field of ['swaps', 'bonusSlots']) {
      const list = sub && Array.isArray(sub[field]) ? sub[field] : [];
      const seen = new Set();
      let missing = 0;
      let dup = 0;
      for (const r of list) {
        const k = r && typeof r === 'object' ? r.id : undefined;
        if (typeof k !== 'string' || !k) missing++;
        else if (seen.has(k)) dup++;
        else seen.add(k);
      }
      if (missing || dup) problems.push({ collection: 'subscriptions.' + field, parent: sub.id, key: 'id', missing, duplicate: dup, notObject: 0 });
    }
  }
  return problems;
}

/** Settled payments (not held, not rejected) sharing a YooMoney operation id: the unique index refuses them. */
export function duplicateOperations(state) {
  const seen = new Map();
  for (const p of Array.isArray(state.payments) ? state.payments : []) {
    if (!p || p.pending === true || p.error === 'rejected') continue;
    const op = typeof p.operationId === 'string' ? p.operationId : '';
    if (!op) continue;
    seen.set(op, (seen.get(op) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([op, n]) => ({ operation: short(op), count: n }));
}

/**
 * Promos without their usage history (Andy: start clean). An exhausted promo (every use taken, e.g. a single-use
 * code already redeemed) becomes revoked; a partly used one keeps only the uses left (maxUses − used), so the
 * total number of activations never grows. `uses` becomes [] everywhere.
 */
export function migratePromos(state) {
  const report = { promos: 0, usesDropped: 0, revokedExhausted: [], reducedMaxUses: [] };
  const promos = (Array.isArray(state.promos) ? state.promos : []).map((p) => {
    report.promos++;
    if (!p || typeof p !== 'object') return p;
    const uses = Array.isArray(p.uses) ? p.uses.length : 0;
    report.usesDropped += uses;
    const max = Number(p.maxUses);
    const next = { ...p, uses: [] };
    if (uses > 0 && Number.isFinite(max) && max > 0) {
      if (uses >= max) {
        if (!p.revoked) report.revokedExhausted.push(p.id);
        next.revoked = true;
      } else {
        next.maxUses = max - uses;
        report.reducedMaxUses.push({ id: p.id, from: max, to: max - uses });
      }
    }
    return next;
  });
  return { state: { ...state, promos }, report };
}

/** What a subscription does at `now`, computed by the billing code itself. */
export function subscriptionBehaviour(state, sub, now) {
  const access = subAccess(state, sub, now);
  const breakdown = limitBreakdown(state, sub, now);
  const swaps = swapStatus(sub, now, 1);
  return {
    access: access.access,
    paid: access.paid,
    grace: access.grace,
    accessUntil: access.accessUntil,
    limit: deviceLimitNow(state, sub, now),
    limitText: breakdown ? breakdown.text : '',
    bound: boundDevices(state, sub.id),
    bonus: activeBonus(sub, now),
    extras: activeExtras(state, sub, now),
    renewal: renewalPrice(state, sub, now),
    credit: creditOf(sub),
    withinLimit: state.codes.filter((c) => c && c.subscriptionId === sub.id && c.deviceId).map((c) => [c.id, codeWithinLimit(state, sub, c, now)]),
    swapsLeft: swaps.left,
    swapsUsed: swaps.used,
  };
}

/** Whole-billing behaviour: finance totals and the reminders due at `now`. */
export function globalBehaviour(state, now) {
  return { finance: financeReport(state, now).summary, reminders: dueReminders(state, now) };
}

function subscriptionChecksum(state, sub) {
  const codes = state.codes.filter((c) => c && c.subscriptionId === sub.id);
  const purchases = state.purchases.filter((p) => p && p.subscriptionId === sub.id);
  return short(stable({ sub, codes, purchases }));
}

function normRows(rows, cols, defaults) {
  return rows
    .map((r) => {
      const out = {};
      for (const c of cols) {
        let v = r[c] === undefined || r[c] === null ? defaults[c] : r[c];
        if (typeof v === 'bigint') v = Number(v);
        out[c] = v;
      }
      return out;
    })
    .sort((a, b) => (stable(a) < stable(b) ? -1 : 1));
}

async function insertRows(q, table, cols, rows, defaults) {
  for (const r of rows) {
    const vals = cols.map((c) => {
      const v = r[c] === undefined || r[c] === null ? defaults[c] : r[c];
      return typeof v === 'bigint' ? Number(v) : v;
    });
    await q.query('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map((_, i) => '$' + (i + 1)).join(', ') + ')', vals);
  }
}

async function isEmpty(q) {
  const { meta } = await loadAll(q);
  let rows = 0;
  for (const spec of COLLECTIONS) rows += meta[spec.name].rows.size + (meta[spec.name].maxOrd ? 1 : 0);
  rows += meta.settings.size + meta.meta.size + meta.supportClosed.size + meta.legacy.size;
  const reg1 = (await q.query('SELECT (SELECT COUNT(*) FROM devices) + (SELECT COUNT(*) FROM refresh_tokens) AS n')).rows[0].n;
  const kv = (await q.query("SELECT key, value FROM kv WHERE key <> 'store_version' OR value <> '0'")).rows.length;
  return rows === 0 && Number(reg1) === 0 && kv === 0;
}

/**
 * Run the migration. `apply: false` (default) is a dry run: everything happens and is verified, then rolled back.
 * `hooks.afterImport(client)` (tests) runs after the import, before verification.
 * Resolves to the report; `report.ok` is false on refusal or mismatch (nothing committed then).
 */
export async function migrateSqliteToPg({ sourcePath, connectionString, schema, apply = false, now, hooks }) {
  const at = Number(now) || Date.now();
  const report = { ok: false, mode: apply ? 'apply' : 'dry-run', now: at, source: {}, prepare: {}, import: {}, verify: {}, problems: [] };
  const src = await readSource(sourcePath);
  report.source = {
    bytes: src.bytes,
    snapshotSha256: src.sha256.slice(0, 12),
    rowIdsMarker: !!(src.raw && src.raw.meta && src.raw.meta.rowIds === 1),
    devices: src.devices.length,
    refreshTokens: src.refresh.length,
    tokenKey: src.tokenSecret ? 'present' : 'absent',
  };

  // 2. Prepare.
  const original = json(normalizeState(json(src.raw)));
  // Keys are checked on the snapshot as stored (a row without an id is refused, not given one now) and after
  // normalization (duplicates).
  const rawKeys = keyProblems(src.raw && typeof src.raw === 'object' ? src.raw : {});
  const keys = rawKeys.length ? rawKeys : keyProblems(original);
  const dupOps = duplicateOperations(original);
  if (keys.length) report.problems.push({ kind: 'keys', detail: keys });
  if (dupOps.length) report.problems.push({ kind: 'duplicate_operation_id', detail: dupOps });
  const promo = migratePromos(original);
  const expiredLogs = expiredLogCounts(promo.state, at);
  const expected = json(normalizeState(pruneLogs(promo.state, at)));
  report.prepare = {
    counts: Object.fromEntries(COLLECTIONS.map((s) => [s.name, original[s.name].length])),
    settingsKeys: Object.keys(original.settings || {}).length,
    promos: promo.report,
    logsExpired: expiredLogs,
    otherTopLevelKeys: Object.keys(original).filter((k) => !COLLECTIONS.some((s) => s.name === k) && !['settings', 'meta', 'supportClosed'].includes(k)),
  };
  if (report.problems.length) {
    report.result = 'refused: fix the source rows first (nothing written)';
    return report;
  }

  const pool = await openPool({ connectionString, schema, max: 2 });
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_WRITE]);
    if (!(await isEmpty(client))) {
      report.problems.push({ kind: 'target_not_empty' });
      report.result = 'refused: the target database already has billing data (nothing written)';
      await client.query('ROLLBACK');
      return report;
    }

    // 3. Import.
    await insertRows(client, 'devices', DEVICE_COLS, src.devices, DEVICE_DEFAULTS);
    await insertRows(client, 'refresh_tokens', REFRESH_COLS, src.refresh, REFRESH_DEFAULTS);
    if (src.tokenSecret) await client.query("INSERT INTO kv (key, value) VALUES ('token_secret', $1)", [src.tokenSecret]);
    const empty = (await loadAll(client)).meta;
    await writeDiff(client, empty, expected);
    const regBefore = normRows((await client.query('SELECT * FROM devices')).rows, DEVICE_COLS, DEVICE_DEFAULTS);
    await reg.syncRegistry(client, expected, at);
    const regAfter = normRows((await client.query('SELECT * FROM devices')).rows, DEVICE_COLS, DEVICE_DEFAULTS);
    await client.query("UPDATE kv SET value = '1' WHERE key = 'store_version'");
    report.import = { devices: src.devices.length, refreshTokens: src.refresh.length, syncChanged: stable(regBefore) !== stable(regAfter) };
    if (hooks && hooks.afterImport) await hooks.afterImport(client);

    // 4. Verify.
    const loaded = json(normalizeState((await loadAll(client)).raw));
    const v = { global: false, collections: {}, subscriptions: { total: 0, checksumMismatch: [], behaviourMismatch: [] }, registry: {}, settings: {}, other: {} };
    const mismatches = [];
    for (const spec of COLLECTIONS) {
      const a = expected[spec.name];
      const b = loaded[spec.name];
      const same = stable(a) === stable(b);
      v.collections[spec.name] = { expected: a.length, stored: b.length, same, hash: short(stable(b)) };
      if (!same) mismatches.push('collection ' + spec.name);
    }
    v.settings = { keys: Object.keys(loaded.settings).length, same: stable(expected.settings) === stable(loaded.settings) };
    if (!v.settings.same) mismatches.push('settings');
    for (const k of ['meta', 'supportClosed']) {
      v.other[k] = stable(expected[k]) === stable(loaded[k]);
      if (!v.other[k]) mismatches.push(k);
    }
    const restKeys = new Set([...Object.keys(expected), ...Object.keys(loaded)]);
    for (const k of restKeys) {
      if (COLLECTIONS.some((s) => s.name === k) || ['settings', 'meta', 'supportClosed'].includes(k)) continue;
      v.other[k] = stable(expected[k]) === stable(loaded[k]);
      if (!v.other[k]) mismatches.push('top-level ' + k);
    }
    for (const sub of original.subscriptions) {
      v.subscriptions.total++;
      const stored = loaded.subscriptions.find((s) => s.id === sub.id);
      const want = expected.subscriptions.find((s) => s.id === sub.id);
      if (!stored || subscriptionChecksum(expected, want) !== subscriptionChecksum(loaded, stored)) {
        v.subscriptions.checksumMismatch.push(sub.id);
        continue;
      }
      // Behaviour against the source as it was (promos and logs do not change what a subscription does).
      if (stable(subscriptionBehaviour(original, sub, at)) !== stable(subscriptionBehaviour(loaded, stored, at))) v.subscriptions.behaviourMismatch.push(sub.id);
    }
    // Finance and due reminders: the source after retention (expired YooMoney problems may leave the report).
    v.global = stable(globalBehaviour(pruneLogs(original, at), at)) === stable(globalBehaviour(loaded, at));
    if (!v.global) mismatches.push('finance / reminders');
    if (v.subscriptions.checksumMismatch.length) mismatches.push('subscription checksums');
    if (v.subscriptions.behaviourMismatch.length) mismatches.push('subscription behaviour');
    const devStored = normRows((await client.query('SELECT * FROM devices')).rows, DEVICE_COLS, DEVICE_DEFAULTS);
    const refStored = normRows((await client.query('SELECT * FROM refresh_tokens')).rows, REFRESH_COLS, REFRESH_DEFAULTS);
    const keyRow = (await client.query("SELECT value FROM kv WHERE key = 'token_secret'")).rows[0];
    v.registry = {
      devices: { source: src.devices.length, stored: devStored.length, same: stable(devStored) === stable(normRows(src.devices, DEVICE_COLS, DEVICE_DEFAULTS)) },
      refreshTokens: { source: src.refresh.length, stored: refStored.length, same: stable(refStored) === stable(normRows(src.refresh, REFRESH_COLS, REFRESH_DEFAULTS)) },
      tokenKeySame: (keyRow ? keyRow.value : '') === src.tokenSecret,
      syncChanged: report.import.syncChanged,
    };
    if (!v.registry.devices.same) mismatches.push('registry devices');
    if (!v.registry.refreshTokens.same) mismatches.push('registry refresh tokens');
    if (!v.registry.tokenKeySame) mismatches.push('token key');
    if (v.registry.syncChanged) mismatches.push('registry sync changed rows');
    const idx = (await client.query("SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = 'payments_operation_settled' AND schemaname = current_schema()")).rows[0].n;
    v.uniqueOperationIndex = Number(idx) === 1;
    if (!v.uniqueOperationIndex) mismatches.push('unique operation index');
    report.verify = v;
    if (mismatches.length) {
      report.problems.push({ kind: 'mismatch', detail: mismatches });
      report.result = 'rolled back: verification found differences (nothing written)';
      await client.query('ROLLBACK');
      return report;
    }
    if (apply) {
      await client.query('COMMIT');
      committed = true;
      report.result = 'committed: Postgres holds the migrated billing data';
    } else {
      await client.query('ROLLBACK');
      report.result = 'dry run passed: everything verified, rolled back (nothing written)';
    }
    report.ok = true;
    return report;
  } catch (e) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    report.problems.push({ kind: 'error', detail: e && e.message ? e.message : String(e) });
    report.result = 'rolled back: error (nothing written)';
    return report;
  } finally {
    client.release();
    await pool.end();
  }
}
