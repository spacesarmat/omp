import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';

// Loaded by Node itself so vitest does not have to bundle node:sqlite or nodemailer.
const file = join(mkdtempSync(join(tmpdir(), 'omp-bill-')), 'billing.db');
const server = createServer(createApp(file));
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  process.stdout.write(String(addr.port) + '\n');
});
