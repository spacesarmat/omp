/**
 * Break-glass admin login. Run inside the billing container:
 *   docker exec omp-billing node src/adminLoginLink.mjs
 * Prints one URL. The token is not written to the snapshot or to stderr.
 */
import { issueCliAdminLogin } from './logic.mjs';
import { readState, resolveDbPath, updateState } from './store.mjs';

function dataFile() {
  const fromEnv = process.env.BILLING_DATA;
  if (fromEnv) return resolveDbPath(fromEnv);
  const path = new URL('../data/billing.db', import.meta.url).pathname;
  return path.replace(/^\/([A-Za-z]:)/, '$1');
}

const file = dataFile();
let state;
try {
  state = readState(file);
} catch (e) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
const origin = String(state.settings.publicOrigin || process.env.BILLING_PUBLIC_ORIGIN || '').replace(/\/+$/, '');
let issued;
try {
  issued = await updateState(file, (cur) => issueCliAdminLogin(cur, { now: Date.now() }));
} catch (e) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
if (!issued || !issued.token) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
const path = '/admin/login/once?token=' + encodeURIComponent(issued.token);
process.stdout.write((origin ? origin + path : path) + '\n');
