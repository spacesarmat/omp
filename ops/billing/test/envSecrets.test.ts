/**
 * Secrets in the server's .env, not in the database (src/envSecrets.mjs): the wrapped store reads them from
 * the environment and never writes them, the start-up move drops the database copy (and kv.token_secret),
 * the panel shows them read-only and masked, and the bot and YooMoney work with the .env values.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareSecrets, ENV_SECRETS, envLinesFor, envSecretValues, moveSecretsOutOfDb, secretText, secretViews, withEnvSecrets } from '../src/envSecrets.mjs';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';
import { notificationHash } from '../src/yoomoney.mjs';
import { readState, testStore, writeState } from './pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const ENV = {
  BILLING_BOT_TOKEN: '123456:env-bot-token-AAAA',
  BILLING_YOOMONEY_SECRET: 'env-yoomoney-secret-BBBB',
  BILLING_SMTP_PASS: 'smtp-env-pass-CCCC',
  BILLING_JACKETT_API_KEY: 'jackett-env-key-DDDD',
  BILLING_JACRED_API_KEY: 'jacred-env-key-EEEE',
  BILLING_INDEXER_PASS: 'short',
};

/** A state as it was before the move: every secret in the settings. */
function oldState() {
  const st = emptyState() as Any;
  st.settings.botToken = '123456:db-bot-token';
  st.settings.yoomoneySecret = 'db-yoomoney-secret';
  st.settings.smtpPass = 'db-smtp';
  st.settings.jackettApiKey = 'db-jackett';
  st.settings.jacredApiKey = 'db-jacred';
  st.settings.indexerPass = 'db-pass';
  st.settings.adminTelegramIds = '99';
  st.settings.adminNotify = true;
  return st;
}

async function settingsRows(store: Any) {
  const keys = ENV_SECRETS.map((s) => s.key);
  const r = await store.query('SELECT key, value FROM settings WHERE key = ANY($1) ORDER BY key', [keys]);
  return Object.fromEntries(r.rows.map((row: Any) => [row.key, row.value]));
}

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

async function call(app: Any, method: string, path: string, opts: { cookie?: string; body?: unknown; form?: Record<string, string> } = {}) {
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      cookie: opts.cookie || '',
      accept: opts.form ? '' : 'application/json',
      'content-type': opts.form ? 'application/x-www-form-urlencoded' : opts.body === undefined ? '' : 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Any = null;
  try {
    data = JSON.parse(res.body);
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, data, body: res.body };
}


describe('exact secret values (no trim)', () => {
  it('keeps surrounding spaces in .env reads, exports and comparisons', () => {
    const spaced = ' pass with spaces ';
    const env = { BILLING_SMTP_PASS: spaced };
    expect(envSecretValues(env).smtpPass).toBe(spaced);
    expect(secretText(spaced)).toContain('****');
    const settings = { smtpPass: spaced };
    const lines = envLinesFor(settings, '', {});
    expect(lines.lines.some((l) => l.includes("BILLING_SMTP_PASS=' pass with spaces '"))).toBe(true);
    const cmp = compareSecrets(settings, '', env);
    const smtp = cmp.find((x) => x.name === 'BILLING_SMTP_PASS');
    expect(smtp.state).toBe('same');
  });
});

describe('secret display and the settings form', () => {
  it('shows set or not, the last four characters of long values only, never the value', () => {
    expect(secretText('')).toBe('не задан');
    expect(secretText('short')).toBe('задан ✅, ****');
    expect(secretText('123456:env-bot-token-AAAA')).toBe('задан ✅, ****AAAA');
    const pub = publicAdminSettings({ ...emptyState().settings, botToken: '123456:env-bot-token-AAAA', indexerPass: 'short' });
    expect(pub.botToken).toBe('задан ✅, ****AAAA');
    expect(pub.indexerPass).toBe('задан ✅, ****');
    expect(pub.yoomoneySecret).toBe('не задан');
    expect(JSON.stringify(pub)).not.toContain('env-bot-token');
  });

  it('the form cannot change a secret: whatever it sends, the current value stays', () => {
    const cur = { ...emptyState().settings, botToken: 'keep-me', smtpPass: 'keep-smtp' };
    const next = mergeSettings(cur, { botToken: 'new-token', smtpPass: '', yoomoneySecret: 'x', jackettApiKey: 'y', priceRub: '199' });
    expect(next.botToken).toBe('keep-me');
    expect(next.smtpPass).toBe('keep-smtp');
    expect(next.yoomoneySecret).toBe('');
    expect(next.jackettApiKey).toBe('');
    expect(next.priceRub).toBe(199);
  });

  it('views carry the .env name and the source', () => {
    const views = secretViews({ botToken: 'still-in-the-database', smtpPass: '' }, { BILLING_YOOMONEY_SECRET: 'env-yoomoney-secret-BBBB' });
    const by = Object.fromEntries(views.map((v: Any) => [v.key, v]));
    expect(by.botToken).toMatchObject({ env: 'BILLING_BOT_TOKEN', source: 'db', text: 'задан ✅, ****base' });
    expect(by.yoomoneySecret).toMatchObject({ env: 'BILLING_YOOMONEY_SECRET', source: 'env', text: 'задан ✅, ****BBBB' });
    expect(by.smtpPass).toMatchObject({ source: '', text: 'не задан' });
    expect(JSON.stringify(views)).not.toContain('env-yoomoney-secret');
  });
});

describe('the store with .env secrets', () => {
  it('reads the .env values, writes none of them, and keeps the database value of a secret .env lacks', async () => {
    const raw = await testStore();
    await writeState(raw, oldState());
    const env = { BILLING_BOT_TOKEN: ENV.BILLING_BOT_TOKEN, BILLING_YOOMONEY_SECRET: ENV.BILLING_YOOMONEY_SECRET };
    const store = withEnvSecrets(raw, env);
    const st = await store.read();
    expect(st.settings.botToken).toBe(ENV.BILLING_BOT_TOKEN);
    expect(st.settings.yoomoneySecret).toBe(ENV.BILLING_YOOMONEY_SECRET);
    expect(st.settings.smtpPass).toBe('db-smtp');
    // A write gives fn the .env values and returns what fn returned, but the database gets ''.
    const result = await store.update((s: Any) => ({ state: { ...s, settings: { ...s.settings, priceRub: 250 } }, result: s.settings.botToken }));
    expect(result).toBe(ENV.BILLING_BOT_TOKEN);
    const rows = await settingsRows(raw);
    expect(rows.botToken).toBe('');
    expect(rows.yoomoneySecret).toBe('');
    expect(rows.smtpPass).toBe('db-smtp');
    expect((await readState(raw)).settings.priceRub).toBe(250);
    // Without any .env secret the store is returned as it is.
    expect(withEnvSecrets(raw, {})).toBe(raw);
  });

  it('the start-up move drops the database copy of every .env secret and kv.token_secret', async () => {
    const raw = await testStore();
    await writeState(raw, oldState());
    await raw.registry.tokenSecret({});
    expect((await raw.query("SELECT COUNT(*)::int AS n FROM kv WHERE key = 'token_secret'")).rows[0].n).toBe(1);
    // Nothing in .env yet: nothing moves (the bot keeps working on the database copy).
    expect(await moveSecretsOutOfDb(raw, {})).toEqual({ moved: [], tokenKey: false });
    expect((await settingsRows(raw)).botToken).toBe('123456:db-bot-token');
    const env = { ...ENV, BILLING_TOKEN_SECRET: 'k'.repeat(64) };
    const out = await moveSecretsOutOfDb(raw, env);
    expect(out.moved.sort()).toEqual(ENV_SECRETS.map((s) => s.key).sort());
    expect(out.tokenKey).toBe(true);
    const rows = await settingsRows(raw);
    for (const s of ENV_SECRETS) expect(rows[s.key], s.key).toBe('');
    expect((await raw.query("SELECT COUNT(*)::int AS n FROM kv WHERE key = 'token_secret'")).rows[0].n).toBe(0);
    // No secret value is left anywhere in the state tables.
    const dumpish = JSON.stringify((await raw.query('SELECT key, value FROM settings')).rows);
    for (const v of ['db-bot-token', 'db-yoomoney-secret', 'db-smtp', 'db-jackett', 'db-jacred', 'db-pass']) expect(dumpish).not.toContain(v);
    // Idempotent.
    expect(await moveSecretsOutOfDb(raw, env)).toEqual({ moved: [], tokenKey: false });
    // A short BILLING_TOKEN_SECRET is ignored, so the kv key stays.
    const other = await testStore();
    await other.registry.tokenSecret({});
    expect((await moveSecretsOutOfDb(other, { BILLING_TOKEN_SECRET: 'short' })).tokenKey).toBe(false);
  });
});

describe('the bot and YooMoney with secrets only in .env', () => {
  it('YooMoney checks the .env secret, the bot sends with the .env token, the panel never shows a value', async () => {
    const raw = await testStore();
    await writeState(raw, oldState());
    await moveSecretsOutOfDb(raw, ENV);
    const store = withEnvSecrets(raw, ENV);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    };
    const app = createApp(store, fetchImpl, { env: ENV });
    const fields: Record<string, string> = {
      notification_type: 'p2p-incoming',
      operation_id: 'op-env-1',
      amount: '150.00',
      currency: '643',
      datetime: '2026-10-19T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label: 'unknown-label',
      sha1_hash: '',
    };
    // Signed with the old database secret: refused.
    const old = { ...fields, sha1_hash: notificationHash(fields, 'db-yoomoney-secret') };
    expect((await call(app, 'POST', '/v1/yoomoney', { form: old })).status).toBe(400);
    // Signed with the .env secret: accepted.
    const signed = { ...fields, sha1_hash: notificationHash(fields, ENV.BILLING_YOOMONEY_SECRET) };
    expect((await call(app, 'POST', '/v1/yoomoney', { form: signed })).status).toBe(200);
    // The admin notice went out with the .env bot token.
    expect(calls.some((u) => u.indexOf('/bot' + ENV.BILLING_BOT_TOKEN + '/sendMessage') >= 0)).toBe(true);
    expect(calls.some((u) => u.indexOf('db-bot-token') >= 0)).toBe(false);

    // The panel: read-only rows, masked; saving the form does not bring a secret back.
    const link = await store.update((s: Any) => issueCliAdminLogin(s, { now: Date.now() }));
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
    const cookie = String(once.headers['set-cookie'] || '');
    const home = await call(app, 'GET', '/admin/api/home', { cookie });
    expect(home.status).toBe(200);
    expect(home.data.settings.botToken).toBe('задан ✅, ****AAAA');
    expect(home.data.secrets.map((v: Any) => [v.key, v.env, v.source])).toContainEqual(['yoomoneySecret', 'BILLING_YOOMONEY_SECRET', 'env']);
    for (const v of Object.values(ENV)) if (v.length > 5) expect(home.body).not.toContain(v);
    const saved = await call(app, 'POST', '/admin/settings', { cookie, body: { csrf: home.data.csrf, botToken: 'typed-in-the-form', priceRub: '199' } });
    expect(saved.status).toBeLessThan(400);
    const rows = await settingsRows(raw);
    expect(rows.botToken).toBe('');
    expect(JSON.stringify(rows)).not.toContain('typed-in-the-form');
    expect((await readState(raw)).settings.priceRub).toBe(199);
  });
});

describe('secretsToEnv: the .env lines for the move', () => {
  const KV = 'a'.repeat(64);

  it('writes NAME=\'value\' for every database secret that .env does not have, plus the kv token key', () => {
    const out = envLinesFor(oldState().settings, KV, {});
    expect(out.refused).toEqual([]);
    expect(out.names).toEqual([...ENV_SECRETS.map((s) => s.env), 'BILLING_TOKEN_SECRET']);
    expect(out.lines).toContain("BILLING_BOT_TOKEN='123456:db-bot-token'");
    expect(out.lines).toContain("BILLING_TOKEN_SECRET='" + KV + "'");
    for (const l of out.lines) expect(l).toMatch(/^BILLING_[A-Z_]+='[^'\r\n]*'$/);
  });

  it('skips what .env already sets, empty values and a short kv key', () => {
    const st = oldState().settings;
    st.smtpPass = '';
    const out = envLinesFor(st, 'short', { BILLING_BOT_TOKEN: 'x:env', BILLING_TOKEN_SECRET: 'b'.repeat(40) });
    expect(out.names).toEqual(['BILLING_YOOMONEY_SECRET', 'BILLING_JACKETT_API_KEY', 'BILLING_JACRED_API_KEY', 'BILLING_INDEXER_PASS']);
    expect(envLinesFor(st, KV, { BILLING_TOKEN_SECRET: 'too-short' }).names).toContain('BILLING_TOKEN_SECRET');
  });

  it('refuses a value with a quote or a line break instead of writing a broken .env line', () => {
    const st = oldState().settings;
    st.smtpPass = "it's";
    st.indexerPass = 'a\nb';
    const out = envLinesFor(st, '', {});
    expect(out.refused).toEqual(['BILLING_SMTP_PASS', 'BILLING_INDEXER_PASS']);
    expect(out.lines.join('\n')).not.toContain("it's");
  });

  it('--verify compares .env with the database by state only', () => {
    const st = oldState().settings;
    st.smtpPass = '';
    st.jacredApiKey = '';
    const rows = compareSecrets(st, KV, { BILLING_BOT_TOKEN: '123456:db-bot-token', BILLING_YOOMONEY_SECRET: 'other', BILLING_JACRED_API_KEY: 'k', BILLING_TOKEN_SECRET: KV });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.state]))).toEqual({
      BILLING_BOT_TOKEN: 'same',
      BILLING_YOOMONEY_SECRET: 'differs',
      BILLING_SMTP_PASS: 'none',
      BILLING_JACKETT_API_KEY: 'db only',
      BILLING_JACRED_API_KEY: 'env only',
      BILLING_INDEXER_PASS: 'db only',
      BILLING_TOKEN_SECRET: 'same',
    });
    expect(JSON.stringify(rows)).not.toContain('db-bot-token');
  });
});

describe('secrets in the VPS/NUC compose', () => {
  it('passes every .env secret to billing, with an empty default', () => {
    const compose = readFileSync('ops/vps/docker-compose.yml', 'utf8');
    for (const s of ENV_SECRETS) expect(compose).toContain(s.env + ': ${' + s.env + ':-}');
    expect(compose).toContain('BILLING_TOKEN_SECRET: ${BILLING_TOKEN_SECRET:-}');
  });

  it('the image ships the move tool', () => {
    expect(readFileSync('ops/vps/Dockerfile', 'utf8')).toContain('COPY tools ./tools');
    expect(readFileSync('ops/billing/tools/secretsToEnv.mjs', 'utf8')).toContain("'--verify'");
  });
});
