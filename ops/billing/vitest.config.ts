import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testDir = path.join(root, 'ops/billing/test');

/**
 * The store is Postgres only. Without BILLING_TEST_DATABASE_URL (a plain `npm test` in the app jobs) only the
 * files that need no database run; the billing CI job sets the URL and BILLING_TEST_REQUIRE_PG=1, and then a
 * missing URL is an error instead of a skip.
 */
function include(): string[] {
  if (process.env.BILLING_TEST_DATABASE_URL) return ['ops/billing/test/**/*.test.ts'];
  if (process.env.BILLING_TEST_REQUIRE_PG === '1') throw new Error('billing tests need Postgres: set BILLING_TEST_DATABASE_URL');
  const needsPg = /from '\.\/pg'|serve\.mjs|BILLING_TEST_DATABASE_URL/;
  const files = readdirSync(testDir).filter((f) => f.endsWith('.test.ts') && !needsPg.test(readFileSync(path.join(testDir, f), 'utf8')));
  process.stderr.write('billing: no BILLING_TEST_DATABASE_URL, the Postgres tests are skipped (' + files.length + ' files run)\n');
  return files.map((f) => 'ops/billing/test/' + f);
}

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: include(),
    passWithNoTests: true,
  },
});
