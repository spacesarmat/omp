import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registrySchema, syncRegistry } from './registry.mjs';
import { emptyState, normalizeState } from './state.mjs';

export { emptyState, normalizeState };

/** Resolve DB path: `.json` → sibling `.db`; bare path kept. */
export function resolveDbPath(file) {
  const raw = String(file || '');
  if (raw.endsWith('.db')) return raw;
  if (raw.endsWith('.json')) return raw.slice(0, -5) + '.db';
  return raw || 'billing.db';
}

function jsonCandidates(dbPath) {
  const out = [];
  if (dbPath.endsWith('.db')) {
    out.push(dbPath.slice(0, -3) + '.json');
    // previous default on the NAS
    out.push(join(dirname(dbPath), 'state.json'));
  } else {
    out.push(dbPath + '.json');
  }
  return out;
}

const dbs = new Map();

function openDb(file) {
  const dbPath = resolveDbPath(file);
  let db = dbs.get(dbPath);
  if (db) return db;
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    migrateFromJson(db, dbPath);
    // Device registry (PR-4): tables, then one sync from the snapshot. The first run is the migration.
    registrySchema(db);
    const row = db.prepare('SELECT data FROM snapshot WHERE id = 1').get();
    if (row && typeof row.data === 'string' && row.data) {
      inTransaction(db, () => syncRegistry(db, normalizeState(JSON.parse(row.data)), Date.now()));
    }
  } catch (e) {
    try {
      db.close();
    } catch {
      /* the failed connection must not stay cached or lock the file */
    }
    throw e;
  }
  dbs.set(dbPath, db);
  return db;
}

function migrateFromJson(db, dbPath) {
  const row = db.prepare('SELECT id FROM snapshot WHERE id = 1').get();
  if (row) return;
  const candidates = jsonCandidates(dbPath);
  let jsonFile = '';
  for (let i = 0; i < candidates.length; i++) {
    if (existsSync(candidates[i])) {
      jsonFile = candidates[i];
      break;
    }
  }
  if (!jsonFile) {
    const empty = emptyState();
    db.prepare('INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(empty),
      Date.now(),
    );
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(jsonFile, 'utf8'));
    const state = normalizeState(parsed);
    db.prepare('INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(state),
      Date.now(),
    );
    try {
      renameSync(jsonFile, jsonFile + '.migrated');
    } catch (e) {
      /* keep original if rename fails */
    }
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    throw new Error('billing state json is unreadable: ' + detail);
  }
}

export function readState(file) {
  const db = openDb(file);
  const row = db.prepare('SELECT data FROM snapshot WHERE id = 1').get();
  if (!row || typeof row.data !== 'string' || !row.data) {
    throw new Error('billing snapshot is missing');
  }
  let parsed;
  try {
    parsed = JSON.parse(row.data);
  } catch (e) {
    throw new Error('billing snapshot is unreadable');
  }
  return normalizeState(parsed);
}

function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (e2) {
      /* already rolled back */
    }
    throw e;
  }
}

/** Snapshot write and registry sync commit together. */
export function writeState(file, state) {
  const db = openDb(file);
  const next = normalizeState(state);
  const data = JSON.stringify(next);
  const now = Date.now();
  inTransaction(db, () => {
    db.prepare(
      `INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(data, now);
    syncRegistry(db, next, now);
  });
}

/** The open database for the device registry and token tables (src/registry.mjs). */
export function registryDb(file) {
  return openDb(file);
}

/** Storage info for the admin UI. */
export function storageInfo(file) {
  const dbPath = resolveDbPath(file);
  let bytes = 0;
  try {
    bytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
  } catch (e) {
    bytes = 0;
  }
  return {
    engine: 'sqlite',
    path: dbPath,
    bytes,
    wal: true,
  };
}

let chain = Promise.resolve();

/**
 * Reads, lets `fn` return `{ state, result? }`, writes `state`.
 * Resolves to `result` when present (same contract as before SQLite).
 */
export function updateState(file, fn) {
  const run = chain.then(() => {
    const cur = readState(file);
    const out = fn(cur);
    writeState(file, out.state !== undefined ? out.state : out);
    return out.result !== undefined ? out.result : out;
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test helper: write a JSON file the old way (unused in prod). */
export function writeJsonLegacy(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

export function dbFileBeside(dataDir) {
  return join(dataDir, 'billing.db');
}
