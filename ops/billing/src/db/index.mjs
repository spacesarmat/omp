/**
 * Storage interface of the billing server. A store is
 *   { engine, read(): Promise<State>, update(fn): Promise<result>, registry: {...async}, info(), close() }
 * `update(fn)` keeps the contract of store.mjs updateState: fn(state) returns { state, result? } (or a state);
 * writes are serialized and the result (or the returned object) resolves.
 *
 * BILLING_STORE=sqlite (default): billing.db at BILLING_DATA. BILLING_STORE=postgres: BILLING_DATABASE_URL.
 * Every server entry point still accepts a billing.db path (tests, CLI) and wraps it with toStore().
 */
import { resolveDbPath } from '../store.mjs';
import { createSqliteStore } from './sqlite.mjs';

const sqliteStores = new Map();

export function isStore(x) {
  return !!x && typeof x === 'object' && typeof x.read === 'function' && typeof x.update === 'function' && !!x.registry;
}

/** A store object as is, or the (shared) SQLite store of a billing.db path. */
export function toStore(fileOrStore) {
  if (isStore(fileOrStore)) return fileOrStore;
  const path = resolveDbPath(fileOrStore);
  let store = sqliteStores.get(path);
  if (!store) {
    store = createSqliteStore(path);
    sqliteStores.set(path, store);
  }
  return store;
}

/** The engine BILLING_STORE asks for: 'postgres' or 'sqlite'. Anything else is an error, not a silent fallback. */
export function storeEngine(env) {
  const raw = String((env && env.BILLING_STORE) || 'sqlite').trim().toLowerCase();
  if (raw === 'sqlite' || raw === '') return 'sqlite';
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';
  throw new Error('BILLING_STORE must be sqlite or postgres');
}

/**
 * Open the store the environment asks for. Postgres runs its schema migrations first.
 * The connection string is never logged (it carries the password).
 */
export async function openStore(env, sqlitePath) {
  if (storeEngine(env) === 'sqlite') return toStore(sqlitePath);
  const url = String((env && env.BILLING_DATABASE_URL) || '');
  if (!url) throw new Error('BILLING_STORE=postgres needs BILLING_DATABASE_URL');
  const { createPgStore } = await import('./pg/store.mjs');
  return createPgStore({ connectionString: url });
}
