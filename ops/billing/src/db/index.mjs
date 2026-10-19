/**
 * Storage interface of the billing server. A store is
 *   { engine, read(): Promise<State>, update(fn): Promise<result>, registry: {...async}, info(), close() }
 * `update(fn)`: fn(state) returns { state, result? } (or a state); writes are serialized and the result
 * (or the returned object) resolves.
 *
 * The only engine is Postgres (BILLING_DATABASE_URL). The SQLite store was removed after the cutover;
 * the old billing.db stays on disk as an archive and tools/migrateToPostgres.mjs can still read it.
 */

export function isStore(x) {
  return !!x && typeof x === 'object' && typeof x.read === 'function' && typeof x.update === 'function' && !!x.registry;
}

/** The store itself. A path (the old billing.db) is an error: there is no SQLite store any more. */
export function toStore(store) {
  if (isStore(store)) return store;
  throw new Error('billing needs a Postgres store (BILLING_DATABASE_URL); the SQLite store was removed');
}

/**
 * BILLING_STORE is optional and may only say postgres. sqlite (or anything else) is an error at start,
 * so a stale .env cannot silently run on an empty database.
 */
export function storeEngine(env) {
  const raw = String((env && env.BILLING_STORE) || 'postgres').trim().toLowerCase();
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg' || raw === '') return 'postgres';
  if (raw === 'sqlite') throw new Error('BILLING_STORE=sqlite is no longer supported: billing runs on Postgres only (BILLING_DATABASE_URL)');
  throw new Error('BILLING_STORE must be postgres');
}

/**
 * Open the Postgres store (schema migrations run first).
 * The connection string is never logged (it carries the password).
 */
export async function openStore(env) {
  storeEngine(env);
  const url = String((env && env.BILLING_DATABASE_URL) || '');
  if (!url) throw new Error('billing needs BILLING_DATABASE_URL (Postgres)');
  const { createPgStore } = await import('./pg/store.mjs');
  return createPgStore({ connectionString: url });
}
