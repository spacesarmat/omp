/**
 * Moves the secrets from the database settings into the server's .env (see src/envSecrets.mjs).
 * Run inside the billing container, which has BILLING_DATABASE_URL and the current .env values:
 *
 *   node tools/secretsToEnv.mjs            # stdout: NAME='value' lines for secrets not yet in .env
 *   node tools/secretsToEnv.mjs --verify   # stdout: one "NAME state" line per secret, no values
 *
 * The default mode prints secret values: send stdout straight into a root-only file (umask 077) and
 * append it to .env; never to a terminal or a log. Names and counts go to stderr.
 * The database copies are removed by the server itself at its next start, once .env provides them.
 * Exit 0 ok, 1 error, 2 a value cannot be written as a .env line (named on stderr, nothing printed).
 */
import { openStore } from '../src/db/index.mjs';
import { compareSecrets, envLinesFor } from '../src/envSecrets.mjs';

const verify = process.argv.includes('--verify');
const store = await openStore(process.env);
let code = 0;
try {
  const state = await store.read();
  const kv = await store.query("SELECT value FROM kv WHERE key = 'token_secret'");
  const kvSecret = kv.rows && kv.rows[0] ? kv.rows[0].value : '';
  if (verify) {
    for (const r of compareSecrets(state.settings || {}, kvSecret, process.env)) process.stdout.write(r.name + ' ' + r.state + '\n');
  } else {
    const out = envLinesFor(state.settings || {}, kvSecret, process.env);
    if (out.refused.length) {
      process.stderr.write("refused (a quote or a line break in the value): " + out.refused.join(', ') + '\n');
      code = 2;
    } else {
      if (out.lines.length) process.stdout.write(out.lines.join('\n') + '\n');
      process.stderr.write('lines: ' + out.lines.length + (out.names.length ? ' (' + out.names.join(', ') + ')' : '') + '\n');
    }
  }
} catch (e) {
  process.stderr.write('error: ' + ((e && e.message) || e) + '\n');
  code = 1;
} finally {
  await store.close();
}
process.exit(code);
