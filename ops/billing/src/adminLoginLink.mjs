/**
 * Break-glass admin login. Run inside the billing container:
 *   docker exec omp-billing node src/adminLoginLink.mjs
 * Prints one URL. The token is not written to the snapshot or to stderr.
 */
import { issueCliAdminLogin } from './logic.mjs';
import { openStore } from './db/index.mjs';

let store;
let state;
try {
  // Same store as the server: Postgres at BILLING_DATABASE_URL.
  store = await openStore(process.env);
  state = await store.read();
} catch (e) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
const origin = String(state.settings.publicOrigin || process.env.BILLING_PUBLIC_ORIGIN || '').replace(/\/+$/, '');
let issued;
try {
  issued = await store.update((cur) => issueCliAdminLogin(cur, { now: Date.now() }));
} catch (e) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
if (!issued || !issued.token) {
  process.stderr.write('admin login link failed\n');
  process.exit(1);
}
await store.close();
const path = '/admin/login/once?token=' + encodeURIComponent(issued.token);
process.stdout.write((origin ? origin + path : path) + '\n');
