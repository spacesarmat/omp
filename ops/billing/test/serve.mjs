import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPgStore } from '../src/db/pg/store.mjs';
import { createApp } from '../src/server.mjs';

// Loaded by Node itself so vitest does not have to bundle pg or nodemailer. Postgres in its own schema.
const url = process.env.BILLING_TEST_DATABASE_URL || '';
if (!url) {
  process.stderr.write('billing tests need Postgres: set BILLING_TEST_DATABASE_URL\n');
  process.exit(1);
}
const store = await createPgStore({ connectionString: url, schema: 'http_' + Date.now().toString(36) + '_' + randomBytes(4).toString('hex') });
const server = createServer(createApp(store));
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  process.stdout.write(String(addr.port) + '\n');
});
