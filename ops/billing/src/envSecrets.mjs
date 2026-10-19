/**
 * Secrets live in the server's .env, not in the database: dumps and the admin panel never hold them.
 *
 * The store returned by openStore() is wrapped (withEnvSecrets): every read sees the .env values in
 * state.settings, every write drops them again before it reaches Postgres. A secret that is not in .env
 * yet is still read from the database (the state before the move), so nothing breaks before the
 * migration; moveSecretsOutOfDb() at start removes the database copy of every secret .env provides.
 * The panel shows them read-only: set or not, and the last four characters of long values.
 */

/** settings key, .env name, label in the panel. */
export const ENV_SECRETS = [
  { key: 'botToken', env: 'BILLING_BOT_TOKEN', label: 'Токен бота' },
  { key: 'yoomoneySecret', env: 'BILLING_YOOMONEY_SECRET', label: 'Секрет ЮMoney' },
  { key: 'smtpPass', env: 'BILLING_SMTP_PASS', label: 'SMTP-пароль' },
  { key: 'jackettApiKey', env: 'BILLING_JACKETT_API_KEY', label: 'Ключ API Jackett' },
  { key: 'jacredApiKey', env: 'BILLING_JACRED_API_KEY', label: 'Ключ API JacRed' },
  { key: 'indexerPass', env: 'BILLING_INDEXER_PASS', label: 'Пароль basic-авторизации' },
];

export const SECRET_KEYS = ENV_SECRETS.map((s) => s.key);

/** The HMAC key of device tokens: BILLING_TOKEN_SECRET (32+ characters) instead of kv.token_secret. */
export const TOKEN_SECRET_ENV = 'BILLING_TOKEN_SECRET';
export const TOKEN_SECRET_MIN = 32;

/** { settingsKey: value } for every secret .env sets (non-empty after trim). */
export function envSecretValues(env) {
  const out = {};
  const e = env || {};
  for (const s of ENV_SECRETS) {
    const v = String(e[s.env] == null ? '' : e[s.env]).trim();
    if (v) out[s.key] = v;
  }
  return out;
}

export function tokenSecretFromEnv(env) {
  return String((env && env[TOKEN_SECRET_ENV]) || '').length >= TOKEN_SECRET_MIN;
}

/** The state with the .env secrets in its settings (a new object; the input is not changed). */
export function overlaySecrets(state, values) {
  if (!state || !Object.keys(values).length) return state;
  return { ...state, settings: { ...(state.settings || {}), ...values } };
}

/** The state without the secrets .env provides (they become ''), as it is written to the database. */
export function stripSecrets(state, values) {
  if (!state || typeof state !== 'object' || !state.settings) return state;
  const keys = Object.keys(values);
  if (!keys.length) return state;
  const settings = { ...state.settings };
  for (const k of keys) settings[k] = '';
  return { ...state, settings };
}

/**
 * The store with the .env secrets: read() overlays them, update(fn) gives fn the overlaid state and writes
 * the result stripped. The result of update() is what fn returned (or its `result`), unchanged.
 */
export function withEnvSecrets(store, env) {
  const values = envSecretValues(env);
  if (!Object.keys(values).length) return store;
  return {
    ...store,
    async read() {
      return overlaySecrets(await store.read(), values);
    },
    update(fn) {
      return store.update((cur) => {
        const out = fn(overlaySecrets(cur, values));
        const next = out && out.state !== undefined ? out.state : out;
        return { state: stripSecrets(next, values), result: out && out.result !== undefined ? out.result : out };
      });
    },
    envSecrets: Object.keys(values),
  };
}

/**
 * At start: drop the database copy of every secret .env provides, and kv.token_secret when
 * BILLING_TOKEN_SECRET is set. `store` is the unwrapped store. Returns the names moved (no values).
 */
export async function moveSecretsOutOfDb(store, env) {
  const values = envSecretValues(env);
  const state = await store.read();
  const settings = (state && state.settings) || {};
  const moved = Object.keys(values).filter((k) => String(settings[k] || '') !== '');
  if (moved.length) await store.update((s) => ({ state: stripSecrets(s, values) }));
  let tokenKey = false;
  if (tokenSecretFromEnv(env) && typeof store.query === 'function') {
    const r = await store.query("DELETE FROM kv WHERE key = 'token_secret'");
    tokenKey = r.rowCount > 0;
  }
  return { moved, tokenKey };
}

/** «задан ✅, ****abcd» (the last four only for values of 12+ characters), «не задан» otherwise. */
export function secretText(value) {
  const s = String(value || '').trim();
  if (!s) return 'не задан';
  return 'задан ✅, ****' + (s.length >= 12 ? s.slice(-4) : '');
}

/**
 * What the panel shows for each secret: label, .env name, the masked text and where it comes from
 * ('env', 'db' while it still sits in the database, '' when not set). Never the value.
 */
export function secretViews(settings, env) {
  const values = envSecretValues(env);
  const s = settings || {};
  return ENV_SECRETS.map((x) => {
    const fromEnv = Object.prototype.hasOwnProperty.call(values, x.key);
    const value = fromEnv ? values[x.key] : String(s[x.key] || '');
    return { key: x.key, env: x.env, label: x.label, text: secretText(value), source: fromEnv ? 'env' : value ? 'db' : '' };
  });
}

/** A value that can go into .env as NAME='value' (compose reads single quotes literally). */
export function envSafe(value) {
  return !/['\r\n]/.test(String(value));
}

/**
 * The .env lines for the move (tools/secretsToEnv.mjs): one NAME='value' line per secret that is in the
 * database and not yet in .env, plus BILLING_TOKEN_SECRET from kv when .env has no valid one.
 * { lines, names, refused }: refused lists the names whose value cannot be written safely (they stay in
 * the database, the server keeps using them).
 */
export function envLinesFor(settings, kvTokenSecret, env) {
  const have = envSecretValues(env);
  const lines = [];
  const names = [];
  const refused = [];
  const add = (name, value) => {
    if (!envSafe(value)) return refused.push(name);
    lines.push(name + "='" + value + "'");
    names.push(name);
  };
  for (const s of ENV_SECRETS) {
    const v = String((settings && settings[s.key]) ?? '').trim();
    if (v && !have[s.key]) add(s.env, v);
  }
  const kv = String(kvTokenSecret || '');
  if (kv.length >= TOKEN_SECRET_MIN && !tokenSecretFromEnv(env)) add(TOKEN_SECRET_ENV, kv);
  return { lines, names, refused };
}

/** Per secret: is it in .env, in the database, and do they match. Names and states only, no values. */
export function compareSecrets(settings, kvTokenSecret, env) {
  const have = envSecretValues(env);
  const state = (inEnv, inDb, same) => (inEnv && inDb ? (same ? 'same' : 'differs') : inEnv ? 'env only' : inDb ? 'db only' : 'none');
  const out = ENV_SECRETS.map((s) => {
    const db = String((settings && settings[s.key]) ?? '').trim();
    return { name: s.env, state: state(!!have[s.key], !!db, have[s.key] === db) };
  });
  const envTok = tokenSecretFromEnv(env) ? String(env[TOKEN_SECRET_ENV]) : '';
  const kv = String(kvTokenSecret || '');
  out.push({ name: TOKEN_SECRET_ENV, state: state(!!envTok, !!kv, envTok === kv) });
  return out;
}
