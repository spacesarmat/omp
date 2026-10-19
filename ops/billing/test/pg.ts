/**
 * Every billing test runs on Postgres (the only store): BILLING_TEST_DATABASE_URL (CI: a postgres:17
 * service). Each testStore() gets its own schema, closed after the file. No URL: the test fails with a
 * clear message instead of skipping.
 */
import { afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';

export const PG_URL = process.env.BILLING_TEST_DATABASE_URL || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Store = any;

const opened: Store[] = [];
const schemas = new Set<string>();
afterAll(async () => {
  for (const s of opened.splice(0)) await s.close().catch(() => {});
  if (!schemas.size) return;
  // Drop this file's schemas, so the test database does not fill up across runs.
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    for (const name of schemas) await client.query('DROP SCHEMA IF EXISTS "' + name.replace(/"/g, '""') + '" CASCADE').catch(() => {});
  } finally {
    schemas.clear();
    await client.end();
  }
});

export function schemaName(tag = 't') {
  return tag + '_' + Date.now().toString(36) + '_' + randomBytes(4).toString('hex');
}

/** A Postgres store in a fresh schema (or `schema`, to open the same data again). */
export async function testStore(schema?: string): Promise<Store> {
  if (!PG_URL) throw new Error('billing tests need Postgres: set BILLING_TEST_DATABASE_URL');
  const { createPgStore } = await import('../src/db/pg/store.mjs');
  const name = schema || schemaName();
  const store = await createPgStore({ connectionString: PG_URL, schema: name });
  opened.push(store);
  schemas.add(name);
  return store;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readState(store: Store): Promise<any> {
  return store.read();
}

export async function writeState(store: Store, state: unknown): Promise<void> {
  await store.update(() => ({ state }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function updateState(store: Store, fn: (s: any) => any): Promise<any> {
  return store.update(fn);
}
