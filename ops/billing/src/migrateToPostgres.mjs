/**
 * One-shot move of billing.db into Postgres (src/db/pg/fromSqlite.mjs). Dry run by default.
 *
 *   BILLING_DATABASE_URL=postgres://… node src/migrateToPostgres.mjs --from /data/billing.db            # dry run
 *   BILLING_DATABASE_URL=postgres://… node src/migrateToPostgres.mjs --from /data/billing.db --apply    # commit
 *   … --report /tmp/report.json   (also write the report there)
 *
 * Prints the report (counts, ids, short hashes; no settings values, tokens or the connection string).
 * Exit 0 when the run passed, 1 on refusal, mismatch or error (then nothing is written).
 */
import { writeFileSync } from 'node:fs';
import { migrateSqliteToPg } from './db/pg/fromSqlite.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const from = arg('--from') || process.env.BILLING_DATA || '';
const url = process.env.BILLING_DATABASE_URL || '';
if (!from || !url) {
  process.stderr.write('usage: BILLING_DATABASE_URL=postgres://… node src/migrateToPostgres.mjs --from billing.db [--apply] [--report file]\n');
  process.exit(2);
}
const report = await migrateSqliteToPg({ sourcePath: from, connectionString: url, apply: process.argv.includes('--apply') });
const text = JSON.stringify(report, null, 2);
process.stdout.write(text + '\n');
const out = arg('--report');
if (out) writeFileSync(out, text + '\n');
process.exit(report.ok ? 0 : 1);
