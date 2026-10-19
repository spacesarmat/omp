/**
 * Postgres store: the billing state in normalized tables (spec.mjs, schema.mjs) behind the same
 * interface as the SQLite store (db/index.mjs).
 *
 * update(fn): one transaction under an advisory lock (writers in every process are serialized), the
 * current state (cached while kv.store_version is unchanged), fn on a copy, normalizeState, then only
 * the difference is written: changed rows upserted, removed rows deleted (logs: marked not live), the
 * registry synced, store_version bumped. read(): the cached state when store_version still matches.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { normalizeState } from '../../state.mjs';
import { LOG_TABLES, expiredLogCounts, pruneLogs, retentionCutoffs } from '../../retention.mjs';
import { decodeRow, encodeRow } from './mapper.mjs';
import * as reg from './registry.mjs';
import { migrate } from './schema.mjs';
import { COLLECTIONS, SPECIAL_KEYS } from './spec.mjs';

const KNOWN = new Set(COLLECTIONS.map((c) => c.name).concat(SPECIAL_KEYS));
const SPECIAL_TABLES = { settings: 'settings', meta: 'meta', supportClosed: 'support_closed' };
const SPECIAL_KEYCOL = { settings: 'key', meta: 'key', supportClosed: 'telegram_id' };
const INSERT_CHUNK = 400;

/** bigint (int8) as a JS number: every bigint here is epoch ms or a count, far below 2^53. */
const types = {
  getTypeParser(oid, format) {
    if (oid === 20 && format !== 'binary') return (v) => (v === null ? null : Number(v));
    return pg.types.getTypeParser(oid, format);
  },
};

function hashOf(v) {
  return createHash('sha1').update(JSON.stringify(v)).digest('base64');
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function keyCol(spec) {
  if (spec.key === 'id') return 'id';
  for (let i = 0; i < spec.cols.length; i++) if (spec.cols[i][0] === spec.key) return spec.cols[i][1];
  throw new Error('spec without key column: ' + spec.name);
}

function columnList(spec) {
  const cols = spec.cols.map((c) => c[1]);
  return spec.key === 'id' ? ['id'].concat(cols) : cols;
}

/** Values in columnList order for one encoded row. */
function rowValues(spec, enc) {
  return spec.key === 'id' ? [enc.key].concat(enc.values) : enc.values;
}

async function insertMany(q, table, cols, rows, conflict) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const part = rows.slice(start, start + INSERT_CHUNK);
    const params = [];
    const tuples = part.map((vals) => {
      const ph = vals.map((v) => {
        params.push(v);
        return '$' + params.length;
      });
      return '(' + ph.join(', ') + ')';
    });
    await q.query('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES ' + tuples.join(', ') + (conflict || ''), params);
  }
}

/** Load the whole state from the tables: { raw (as stored), meta (per-table row hashes and ords) }. */
export async function loadAll(q) {
  const raw = {};
  const meta = {};
  for (let s = 0; s < COLLECTIONS.length; s++) {
    const spec = COLLECTIONS[s];
    const cols = columnList(spec);
    const where = spec.appendOnly ? ' WHERE live' : '';
    const rows = (await q.query('SELECT ' + cols.join(', ') + ', ord, extra FROM ' + spec.table + where + ' ORDER BY ord')).rows;
    const kids = {};
    const children = spec.children || [];
    for (let c = 0; c < children.length; c++) {
      const ch = children[c];
      const sel = ch.scalar ? 'value' : ch.cols.map((x) => x[1]).join(', ') + ', extra';
      const list = (await q.query('SELECT parent_id, ' + sel + ' FROM ' + ch.table + ' ORDER BY parent_id, ord')).rows;
      const byParent = new Map();
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        let arr = byParent.get(r.parent_id);
        if (!arr) byParent.set(r.parent_id, (arr = []));
        arr.push(ch.scalar ? { value: r.value } : { values: ch.cols.map((x) => r[x[1]]), extra: r.extra });
      }
      kids[ch.table] = byParent;
    }
    const kcol = keyCol(spec);
    const out = [];
    const m = { rows: new Map(), maxOrd: 0 };
    const maxRow = (await q.query('SELECT coalesce(max(ord), 0) AS m FROM ' + spec.table)).rows[0];
    m.maxOrd = Number(maxRow.m) || 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const key = r[kcol];
      const values = spec.cols.map((x) => r[x[1]]);
      const childRows = {};
      for (let c = 0; c < children.length; c++) childRows[children[c].table] = kids[children[c].table].get(key) || [];
      const row = decodeRow(spec, key, values, r.extra, childRows);
      out.push(row);
      m.rows.set(key, { ord: Number(r.ord), hash: hashOf(row) });
    }
    raw[spec.name] = out;
    meta[spec.name] = m;
  }
  for (let k = 0; k < SPECIAL_KEYS.length; k++) {
    const name = SPECIAL_KEYS[k];
    const kc = SPECIAL_KEYCOL[name];
    const rows = (await q.query('SELECT ' + kc + ' AS k, value FROM ' + SPECIAL_TABLES[name] + ' ORDER BY ' + kc)).rows;
    const obj = {};
    for (let i = 0; i < rows.length; i++) obj[rows[i].k] = rows[i].value;
    raw[name] = obj;
    meta[name] = new Map(rows.map((r) => [r.k, hashOf(r.value)]));
  }
  const legacy = (await q.query('SELECT key, value FROM legacy_state ORDER BY key')).rows;
  meta.legacy = new Map();
  for (let i = 0; i < legacy.length; i++) {
    raw[legacy[i].key] = legacy[i].value;
    meta.legacy.set(legacy[i].key, hashOf(legacy[i].value));
  }
  return { raw, meta };
}

/** Write the difference between what is stored (meta) and `next`; returns the new meta. */
export async function writeDiff(q, meta, next) {
  const nextMeta = {};
  for (let s = 0; s < COLLECTIONS.length; s++) {
    const spec = COLLECTIONS[s];
    const old = meta[spec.name];
    const list = next[spec.name] || [];
    const kcol = keyCol(spec);
    const encoded = new Array(list.length);
    const hashes = new Array(list.length);
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      encoded[i] = encodeRow(spec, list[i]);
      if (seen.has(encoded[i].key)) throw new Error('postgres store: duplicate ' + spec.key + ' in ' + spec.name);
      seen.add(encoded[i].key);
      hashes[i] = hashOf(list[i]);
    }
    // Removed rows.
    const gone = [];
    for (const key of old.rows.keys()) if (!seen.has(key)) gone.push(key);
    if (gone.length) {
      if (spec.appendOnly) await q.query('UPDATE ' + spec.table + ' SET live = false WHERE ' + kcol + ' = ANY($1)', [gone]);
      else await q.query('DELETE FROM ' + spec.table + ' WHERE ' + kcol + ' = ANY($1)', [gone]);
    }
    // Order: keep the stored ords while existing rows stay in order and new rows only follow them.
    let ordered = true;
    let last = -Infinity;
    let newSeen = false;
    for (let i = 0; i < encoded.length && ordered; i++) {
      const prev = old.rows.get(encoded[i].key);
      if (!prev) newSeen = true;
      else if (newSeen || prev.ord <= last) ordered = false;
      else last = prev.ord;
    }
    let maxOrd = old.maxOrd;
    const ords = new Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      const prev = ordered ? old.rows.get(encoded[i].key) : null;
      ords[i] = prev ? prev.ord : ++maxOrd;
    }
    const m = { rows: new Map(), maxOrd };
    const changed = [];
    for (let i = 0; i < encoded.length; i++) {
      const prev = old.rows.get(encoded[i].key);
      const rowChanged = !prev || prev.hash !== hashes[i];
      if (rowChanged || !prev || prev.ord !== ords[i]) changed.push({ i, rowChanged: rowChanged });
      m.rows.set(encoded[i].key, { ord: ords[i], hash: hashes[i] });
    }
    if (changed.length) {
      const cols = columnList(spec).concat(['ord', 'extra']);
      const tuples = changed.map(({ i }) => rowValues(spec, encoded[i]).concat([ords[i], JSON.stringify(encoded[i].extra)]));
      const set = cols.filter((c) => c !== kcol).map((c) => c + ' = EXCLUDED.' + c);
      if (spec.appendOnly) set.push('live = true');
      // jsonb columns take JSON text (the column type casts it).
      await insertMany(q, spec.table, cols, tuples, ' ON CONFLICT (' + kcol + ') DO UPDATE SET ' + set.join(', '));
      const children = spec.children || [];
      if (children.length) {
        const parents = changed.filter((c) => c.rowChanged).map((c) => encoded[c.i]);
        if (parents.length) {
          const keys = parents.map((p) => p.key);
          for (let c = 0; c < children.length; c++) {
            const ch = children[c];
            await q.query('DELETE FROM ' + ch.table + ' WHERE parent_id = ANY($1)', [keys]);
            const rows = [];
            for (let p = 0; p < parents.length; p++) {
              const items = parents[p].children[ch.table] || [];
              for (let j = 0; j < items.length; j++) {
                const it = items[j];
                rows.push(ch.scalar ? [parents[p].key, j, it.value] : [parents[p].key, j].concat(it.values, [JSON.stringify(it.extra)]));
              }
            }
            const ccols = ['parent_id', 'ord'].concat(ch.scalar ? ['value'] : ch.cols.map((x) => x[1]).concat(['extra']));
            if (rows.length) await insertMany(q, ch.table, ccols, rows, '');
          }
        }
      }
    }
    nextMeta[spec.name] = m;
  }
  for (let k = 0; k < SPECIAL_KEYS.length; k++) {
    const name = SPECIAL_KEYS[k];
    nextMeta[name] = await writeKeyValues(q, SPECIAL_TABLES[name], SPECIAL_KEYCOL[name], meta[name], next[name] || {});
  }
  const extraTop = {};
  const keys = Object.keys(next);
  for (let i = 0; i < keys.length; i++) if (!KNOWN.has(keys[i]) && next[keys[i]] !== undefined) extraTop[keys[i]] = next[keys[i]];
  nextMeta.legacy = await writeKeyValues(q, 'legacy_state', 'key', meta.legacy, extraTop);
  return nextMeta;
}

async function writeKeyValues(q, table, kc, old, obj) {
  const m = new Map();
  const rows = [];
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v === undefined) continue;
    const h = hashOf(v);
    m.set(keys[i], h);
    if (old.get(keys[i]) !== h) rows.push([keys[i], JSON.stringify(v)]);
  }
  const gone = [];
  for (const key of old.keys()) if (!m.has(key)) gone.push(key);
  if (gone.length) await q.query('DELETE FROM ' + table + ' WHERE ' + kc + ' = ANY($1)', [gone]);
  if (rows.length) await insertMany(q, table, [kc, 'value'], rows, ' ON CONFLICT (' + kc + ') DO UPDATE SET value = EXCLUDED.value');
  return m;
}

export async function storeVersion(q) {
  const r = await q.query("SELECT value FROM kv WHERE key = 'store_version'");
  return r.rows[0] ? String(r.rows[0].value) : '0';
}

/**
 * Open (and migrate) a Postgres store. `schema` (tests) puts every table in that schema.
 * The connection string is used only to connect: never logged, never in info().
 */
/** A migrated pool. `schema` (tests) puts every table in that schema. Shared by the store and the data migration. */
export async function openPool({ connectionString, schema, max }) {
  const config = { connectionString, types, max: max || 5 };
  if (schema) config.options = '-c search_path=' + quoteIdent(schema).replace(/ /g, '\\ ');
  if (schema) {
    const boot = new pg.Client({ connectionString, types });
    await boot.connect();
    try {
      await boot.query('CREATE SCHEMA IF NOT EXISTS ' + quoteIdent(schema));
    } finally {
      await boot.end();
    }
  }
  const pool = new pg.Pool(config);
  // An idle client that loses the server must not crash the process; the next query reconnects.
  pool.on('error', () => {});
  try {
    await migrate(pool);
  } catch (e) {
    await pool.end().catch(() => {});
    throw e;
  }
  return pool;
}

/**
 * Open (and migrate) a Postgres store. `schema` (tests) puts every table in that schema.
 * The connection string is used only to connect: never logged, never in info().
 */
export async function createPgStore({ connectionString, schema, max }) {
  const pool = await openPool({ connectionString, schema, max });

  /** { version, state (normalized, JSON), meta } of the last load or write. */
  let cache = null;
  let chain = Promise.resolve();

  async function load(q) {
    const version = await storeVersion(q);
    if (cache && cache.version === version) return cache;
    const { raw, meta } = await loadAll(q);
    const state = JSON.parse(JSON.stringify(normalizeState(raw)));
    cache = { version, state, meta };
    return cache;
  }

  async function read() {
    const version = await storeVersion(pool);
    if (cache && cache.version === version) return structuredClone(cache.state);
    const client = await pool.connect();
    try {
      // One consistent snapshot of every table.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const cur = await load(client);
      await client.query('COMMIT');
      return structuredClone(cur.state);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  function update(fn) {
    const run = chain.then(() =>
      reg.inTx(pool, async (q) => {
        const cur = await load(q);
        const out = fn(structuredClone(cur.state));
        const result = out.result !== undefined ? out.result : out;
        const next = JSON.parse(JSON.stringify(normalizeState(out.state !== undefined ? out.state : out)));
        const now = Date.now();
        const meta = await writeDiff(q, cur.meta, next);
        await reg.syncRegistry(q, next, now);
        const bumped = await q.query("UPDATE kv SET value = (value::bigint + 1)::text WHERE key = 'store_version' RETURNING value");
        // The cache moves only after COMMIT succeeds (inTx commits after this returns).
        return { result, next: { version: String(bumped.rows[0].value), state: next, meta } };
      }).then(({ result, next }) => {
        cache = next;
        return result;
      }),
    );
    chain = run.then(
      () => undefined,
      () => {
        // The transaction rolled back; reload from the database on the next call.
        cache = null;
      },
    );
    return run;
  }

  const registry = {
    deviceRow: (id) => reg.deviceRow(pool, id),
    activeRowForCode: (codeId) => reg.activeRowForCode(pool, codeId),
    activeRowsByCode: () => reg.activeRowsByCode(pool),
    listDevices: (subscriptionId) => reg.listDevices(pool, subscriptionId),
    revokeRow: (id, reason, now) => reg.revokeRow(pool, id, reason, now),
    setRevokeReason: (id, reason) => reg.setRevokeReason(pool, id, reason),
    touchRow: (id, opts) => reg.touchRow(pool, id, opts),
    setDeviceName: (id, raw) => reg.setDeviceName(pool, id, raw),
    tokenSecret: (env) => reg.tokenSecret(pool, env),
    verifyAccess: (secret, token, deviceId, now) => reg.verifyAccess(pool, secret, token, deviceId, now),
    issuePair: (secret, row, now) => reg.issuePair(pool, secret, row, now),
    refreshPair: (secret, args) => reg.refreshPair(pool, secret, args),
    upgradePair: (secret, args) => reg.upgradePair(pool, secret, args),
  };

  return {
    engine: 'postgres',
    read,
    update,
    registry,
    /** Engine, database name and size for the admin panel. No host, user or password. */
    async info() {
      const r = (await pool.query('SELECT current_database() AS db, pg_database_size(current_database()) AS bytes')).rows[0];
      // `path` is what the panel shows next to the engine (Settings → Хранилище): the database name.
      return { engine: 'postgres', path: r.db, database: r.db, bytes: Number(r.bytes) || 0 };
    },
    async close() {
      await chain;
      await pool.end();
    },
    /**
     * Log retention (retention.mjs): expired rows leave the state (one write, only when something expired),
     * then rows already out of the state (live = false) past the same cutoff are deleted. Returns the counts.
     */
    async retention(now) {
      const at = Number(now) || Date.now();
      const expired = expiredLogCounts(await read(), at);
      if (Object.values(expired).some((n) => n > 0)) await update((s) => ({ state: pruneLogs(s, at) }));
      const cut = retentionCutoffs(at);
      const deleted = {};
      for (const [name, table] of Object.entries(LOG_TABLES)) {
        const r = await pool.query('DELETE FROM ' + table + ' WHERE NOT live AND at < $1', [cut[name]]);
        deleted[name] = r.rowCount;
      }
      return { expired, deleted };
    },
    /** Tests: run SQL on the store's pool (same schema). */
    query: (sql, params) => pool.query(sql, params),
  };
}
