import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function emptyState() {
  return {
    settings: {
      adminHash: '',
      adminSalt: '',
      botToken: '',
      botUsername: 'OMPBILLINGBOT',
      /** Public base URL of this server (for /go/… links in Telegram). */
      publicOrigin: '',
      /** Comma-separated Telegram chat ids that get the admin cabinet. */
      adminTelegramIds: '',
      yoomoneyWallet: '',
      yoomoneySecret: '',
      jackettUrl: '',
      jackettApiKey: '',
      jacredUrl: '',
      jacredApiKey: '',
      /** Shared basic-auth for Jackett and JacRed when they sit behind the panel proxy. */
      indexerUser: '',
      indexerPass: '',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      priceRub: 0,
      periodDays: 30,
      extraDeviceRub: 0,
    },
    accounts: [],
    subscriptions: [],
    codes: [],
    sessions: [],
    attempts: [],
    payments: [],
    /** Rejected / problem YooMoney notifications (signature, duplicate, …). */
    webhooks: [],
    promos: [],
    /** Pending phone↔Telegram link tokens from the app. */
    links: [],
    /** Pending Telegram logins for the admin web panel. */
    adminLogins: [],
    /** Admin panel action log. */
    audit: [],
    outbox: [],
  };
}

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
  migrateFromJson(db, dbPath);
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
    const empty = emptyState();
    db.prepare('INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(empty),
      Date.now(),
    );
  }
}

function normalizeState(parsed) {
  const base = emptyState();
  if (!parsed || typeof parsed !== 'object') return base;
  return {
    settings: { ...base.settings, ...(parsed.settings || {}) },
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    payments: Array.isArray(parsed.payments) ? parsed.payments : [],
    webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
    promos: Array.isArray(parsed.promos) ? parsed.promos : [],
    links: Array.isArray(parsed.links) ? parsed.links : [],
    adminLogins: Array.isArray(parsed.adminLogins) ? parsed.adminLogins : [],
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
  };
}

export function readState(file) {
  try {
    const db = openDb(file);
    const row = db.prepare('SELECT data FROM snapshot WHERE id = 1').get();
    if (!row || !row.data) return emptyState();
    return normalizeState(JSON.parse(row.data));
  } catch (e) {
    return emptyState();
  }
}

export function writeState(file, state) {
  const db = openDb(file);
  const data = JSON.stringify(normalizeState(state));
  const now = Date.now();
  db.prepare(
    `INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(data, now);
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
