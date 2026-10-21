/**
 * Postgres schema migrations, applied in order at startup under an advisory lock. A shipped migration is
 * never edited; a change is a new entry. The mapping of state fields to columns is in spec.mjs.
 */

/** Advisory lock keys (any constant 64-bit numbers unique to this app). */
export const LOCK_MIGRATE = 7310501;
export const LOCK_WRITE = 7310502;

export const MIGRATIONS = [
  {
    version: '001_init',
    sql: `
-- Billing state, one table per collection (see spec.mjs): typed columns, ord (array order), extra (other fields).
CREATE TABLE accounts (
  id text PRIMARY KEY,
  email text,
  telegram_id text,
  telegram_username text,
  telegram_name text,
  created_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX accounts_ord ON accounts (ord);
CREATE TABLE account_devices (
  parent_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  ord integer NOT NULL,
  value jsonb NOT NULL,
  device_id text GENERATED ALWAYS AS (value #>> '{}') STORED,
  PRIMARY KEY (parent_id, ord)
);
CREATE INDEX account_devices_device ON account_devices (device_id);
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  account_id text,
  product text,
  paid_until bigint,
  device_limit bigint,
  limit_override bigint,
  extra_slots bigint,
  extra_until bigint,
  credit_rub bigint,
  swaps_reset_at bigint,
  created_at bigint,
  extended_at bigint,
  reminders jsonb,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX subscriptions_ord ON subscriptions (ord);
CREATE TABLE device_swaps (
  parent_id text NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  ord integer NOT NULL,
  id text,
  at bigint,
  device text,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (parent_id, ord)
);
CREATE TABLE bonus_slots (
  parent_id text NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  ord integer NOT NULL,
  id text,
  count bigint,
  until bigint,
  reason text,
  source text,
  granted_at bigint,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (parent_id, ord)
);
CREATE TABLE activation_codes (
  id text PRIMARY KEY,
  subscription_id text,
  hash text,
  plain text,
  device_id text,
  bound_at bigint,
  last_seen_at bigint,
  last_ip text,
  revoked boolean,
  created_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX activation_codes_ord ON activation_codes (ord);
CREATE TABLE legacy_sessions (
  hash text PRIMARY KEY,
  code_id text,
  created_at bigint,
  upgraded_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX legacy_sessions_ord ON legacy_sessions (ord);
CREATE TABLE activation_attempts (
  id text PRIMARY KEY,
  at bigint,
  hash text,
  device_id text,
  ok boolean,
  reason text,
  account_id text,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  live boolean NOT NULL DEFAULT true
);
CREATE INDEX activation_attempts_ord ON activation_attempts (ord);
CREATE TABLE payments (
  id text PRIMARY KEY,
  operation_id text,
  label text,
  amount text,
  amount_num numeric GENERATED ALWAYS AS (CASE WHEN amount ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN amount::numeric END) STORED,
  currency text,
  at bigint,
  account_id text,
  error text,
  pending boolean,
  credited double precision,
  confirmed_by text,
  held_at bigint,
  rejected_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX payments_ord ON payments (ord);
CREATE TABLE webhook_problems (
  id text PRIMARY KEY,
  kind text,
  operation_id text,
  label text,
  amount text,
  at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  live boolean NOT NULL DEFAULT true
);
CREATE INDEX webhook_problems_ord ON webhook_problems (ord);
CREATE TABLE promos (
  id text PRIMARY KEY,
  code text,
  days bigint,
  max_uses bigint,
  bonus_slots bigint,
  bonus_days bigint,
  created_at bigint,
  revoked boolean,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX promos_ord ON promos (ord);
CREATE TABLE promo_uses (
  parent_id text NOT NULL REFERENCES promos (id) ON DELETE CASCADE,
  ord integer NOT NULL,
  id text,
  account_id text,
  at bigint,
  subscription_id text,
  code text,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (parent_id, ord)
);
CREATE TABLE device_links (
  token text PRIMARY KEY,
  device_id text,
  account_id text,
  created_at bigint,
  expires_at bigint,
  used_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX device_links_ord ON device_links (ord);
CREATE TABLE admin_logins (
  token text PRIMARY KEY,
  telegram_id text,
  created_at bigint,
  expires_at bigint,
  confirmed_at bigint,
  consumed_at bigint,
  denied_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX admin_logins_ord ON admin_logins (ord);
CREATE TABLE admin_cli_logins (
  hash text PRIMARY KEY,
  created_at bigint,
  expires_at bigint,
  consumed_at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX admin_cli_logins_ord ON admin_cli_logins (ord);
CREATE TABLE support_messages (
  id text PRIMARY KEY,
  telegram_id text,
  text text,
  direction text,
  at bigint,
  via text,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  live boolean NOT NULL DEFAULT true
);
CREATE INDEX support_messages_ord ON support_messages (ord);
CREATE TABLE support_replies (
  key text PRIMARY KEY,
  telegram_id text,
  at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX support_replies_ord ON support_replies (ord);
CREATE TABLE audit (
  id text PRIMARY KEY,
  at bigint,
  action text,
  detail text,
  account_id text,
  actor jsonb,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  live boolean NOT NULL DEFAULT true
);
CREATE INDEX audit_ord ON audit (ord);
CREATE TABLE purchases (
  id text PRIMARY KEY,
  kind text,
  account_id text,
  subscription_id text,
  price double precision,
  extras bigint,
  credit double precision,
  add_extra bigint,
  paid_until bigint,
  currency text,
  at bigint,
  ord bigint NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX purchases_ord ON purchases (ord);

-- Lookups the code does by field.
CREATE INDEX subscriptions_account ON subscriptions (account_id, product, paid_until DESC);
CREATE INDEX subscriptions_paid_until ON subscriptions (paid_until);
CREATE INDEX activation_codes_subscription ON activation_codes (subscription_id) WHERE revoked IS NOT TRUE;
CREATE INDEX activation_codes_device ON activation_codes (device_id) WHERE revoked IS NOT TRUE AND device_id <> '';
CREATE INDEX activation_codes_hash ON activation_codes (hash);
CREATE INDEX legacy_sessions_code ON legacy_sessions (code_id);
CREATE INDEX activation_attempts_at ON activation_attempts (at DESC);
CREATE INDEX payments_at ON payments (at);
CREATE INDEX payments_account ON payments (account_id, at);
-- One settled payment per YooMoney operation (seenPayment): held and rejected rows do not count.
CREATE UNIQUE INDEX payments_operation_settled ON payments (operation_id)
  WHERE pending IS NOT TRUE AND coalesce(error, '') <> 'rejected' AND coalesce(operation_id, '') <> '';
CREATE INDEX webhook_problems_at ON webhook_problems (at DESC);
CREATE INDEX promos_code ON promos (code) WHERE revoked IS NOT TRUE;
CREATE INDEX promo_uses_account ON promo_uses (account_id);
CREATE INDEX support_messages_chat ON support_messages (telegram_id, at);
CREATE INDEX audit_at ON audit (at DESC);
CREATE INDEX audit_account ON audit (account_id, at DESC);
CREATE INDEX purchases_account ON purchases (account_id, at);
CREATE INDEX purchases_subscription ON purchases (subscription_id, at);

-- Settings (one row per key; values are JSON: numbers, strings, booleans), data-shape markers, closed support
-- threads, and top-level state keys the code does not know (kept as they are).
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE meta (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE support_closed (telegram_id text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE legacy_state (key text PRIMARY KEY, value jsonb NOT NULL);

-- Device registry and tokens (same columns as the SQLite tables in registry.mjs).
CREATE TABLE devices (
  id text PRIMARY KEY,
  subscription_id text NOT NULL,
  account_id text NOT NULL DEFAULT '',
  code_id text NOT NULL,
  device_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  bound_at bigint NOT NULL DEFAULT 0,
  last_seen_at bigint NOT NULL DEFAULT 0,
  last_ip_net text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  revoked_at bigint NOT NULL DEFAULT 0,
  revoke_reason text NOT NULL DEFAULT '',
  clone_at bigint NOT NULL DEFAULT 0,
  clone_count integer NOT NULL DEFAULT 0
);
CREATE INDEX devices_code ON devices (code_id, status);
CREATE INDEX devices_sub ON devices (subscription_id, status);
-- One active registry row per code (syncRegistry keeps it; the database now guarantees it).
CREATE UNIQUE INDEX devices_active_code ON devices (code_id) WHERE status = 'active';
CREATE TABLE refresh_tokens (
  hash text PRIMARY KEY,
  device_row_id text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  rotated_at bigint NOT NULL DEFAULT 0,
  replaced_by text NOT NULL DEFAULT '',
  revoked integer NOT NULL DEFAULT 0
);
CREATE INDEX refresh_device ON refresh_tokens (device_row_id);
CREATE INDEX refresh_expires ON refresh_tokens (expires_at);
CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO kv (key, value) VALUES ('store_version', '0');
`,
  },
  {
    version: '002_ads',
    sql: `
-- Ads (src/ads.mjs): banner images uploaded in the admin, and impressions / clicks per MSK day, banner, section and
-- platform. No device id and no IP. Kept 90 days (store.retention).
CREATE TABLE ad_images (
  id text PRIMARY KEY,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  size integer NOT NULL,
  created_at bigint NOT NULL
);
CREATE TABLE ad_stats (
  day text NOT NULL,
  banner_id text NOT NULL,
  section text NOT NULL,
  platform text NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, banner_id, section, platform)
);
CREATE INDEX ad_stats_day ON ad_stats (day);
`,
  },
];

/** Apply pending migrations. Safe to run from several processes: they wait on the lock. */
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRATE]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at bigint NOT NULL)');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const m = MIGRATIONS[i];
      if (done.has(m.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [m.version, Date.now()]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_MIGRATE]);
    } finally {
      client.release();
    }
  }
}
