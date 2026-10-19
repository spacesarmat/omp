import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registrySchema, syncRegistry } from './registry.mjs';
import { DEVICE_BASE, enrichActors, GRACE_DAYS_DEFAULT, migrateDeviceBase, migrateExtraSlots, migrateTruncatedIps } from './logic.mjs';

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
      /** Telegram notices to adminTelegramIds: payment, payment error, service down, support. */
      adminNotify: true,
      yoomoneyWallet: '',
      yoomoneySecret: '',
      jackettUrl: '',
      jackettApiKey: '',
      /** When false, /v1/search for Jackett returns disabled for subscribers. */
      jackettEnabled: true,
      jacredUrl: '',
      jacredApiKey: '',
      jacredEnabled: true,
      /** Internal docker URL of VPS TorrServer (ops health only, never sent to phones). */
      torrserverUrl: '',
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
      /** Monthly price of one extra device slot; renewed together with the subscription. */
      extraDeviceRub: 0,
      /** Days of access after paidUntil (search keeps working, the bot says «льготный период»). */
      graceDays: GRACE_DAYS_DEFAULT,
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
    /** One-time shell login links. Only the token hash is stored. */
    adminCliLogins: [],
    /** User ↔ admin support thread. */
    supportMessages: [],
    /** adminChatId:messageId → user telegram id, so a reply in Telegram reaches that user. */
    supportReplies: [],
    /** telegramId → ms when the admin closed the thread. A later user message reopens it. */
    supportClosed: {},
    /** Admin panel action log. */
    audit: [],
    outbox: [],
    /** Quoted YooMoney checkouts. The label is buy:<id>; the price is the one quoted, not a later settings change. */
    purchases: [],
    /**
     * Data-shape markers. deviceBase: devices included in a base subscription when deviceLimit was stored.
     * extraMonthly: extra devices are monthly slots (extraSlots/extraUntil), not part of deviceLimit.
     */
    meta: { deviceBase: DEVICE_BASE, extraMonthly: 1 },
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

function normalizeState(parsed) {
  const base = emptyState();
  if (!parsed || typeof parsed !== 'object') return migrateTruncatedIps(migrateExtraSlots(migrateDeviceBase(enrichActors(base))));
  const next = {
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
    adminCliLogins: Array.isArray(parsed.adminCliLogins) ? parsed.adminCliLogins : [],
    supportMessages: Array.isArray(parsed.supportMessages) ? parsed.supportMessages : [],
    supportReplies: Array.isArray(parsed.supportReplies) ? parsed.supportReplies : [],
    supportClosed:
      parsed.supportClosed && typeof parsed.supportClosed === 'object' && !Array.isArray(parsed.supportClosed)
        ? parsed.supportClosed
        : {},
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
    purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
    // A snapshot without meta predates DEVICE_BASE: its limits were counted from 1.
    meta: parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : {},
  };
  const keys = Object.keys(parsed);
  for (let i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(next, keys[i])) next[keys[i]] = parsed[keys[i]];
  }
  return migrateTruncatedIps(migrateExtraSlots(migrateDeviceBase(enrichActors(next))));
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
