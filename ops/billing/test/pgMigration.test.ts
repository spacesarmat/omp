/**
 * PR 3: billing.db → Postgres data migration (tools/fromSqlite.mjs, kept for the archived billing.db) and
 * log retention. Needs BILLING_TEST_DATABASE_URL (CI: postgres:17 service); every test gets its own schema.
 * The source file is written here with the old table layout: the SQLite store itself is gone.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../src/crypto.mjs';
import { activate, createSubscription, ensureTelegramAccount } from '../src/logic.mjs';
import { emptyState, normalizeState } from '../src/state.mjs';
import { REFRESH_TTL_MS, signAccess } from '../src/registry.mjs';
import { expiredLogCounts, pruneLogs } from '../src/retention.mjs';
import { testStore } from './pg';

const PG_URL = process.env.BILLING_TEST_DATABASE_URL || '';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DEV_A = 'a'.repeat(32);

type State = ReturnType<typeof emptyState>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;


const schemaName = () => 'mig_' + Date.now().toString(36) + '_' + randomBytes(4).toString('hex');
const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'omp-mig-')), 'billing.db');

async function migrate(opts: Record<string, unknown>) {
  const mod = await import('../tools/fromSqlite.mjs');
  return mod.migrateSqliteToPg({ connectionString: PG_URL, now: NOW, ...opts }) as Promise<Any>;
}

async function pgStore(schema: string) {
  // Closed, and the schema dropped, by test/pg.ts after the file.
  return (await testStore(schema)) as Any;
}

/** The tables of the old billing.db (snapshot + registry), as the SQLite store created them. */
const LEGACY_TABLES = `
  CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE devices (
    id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', code_id TEXT NOT NULL,
    device_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    bound_at INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0, last_ip_net TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', revoked_at INTEGER NOT NULL DEFAULT 0, revoke_reason TEXT NOT NULL DEFAULT '',
    clone_at INTEGER NOT NULL DEFAULT 0, clone_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE refresh_tokens (
    hash TEXT PRIMARY KEY, device_row_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    rotated_at INTEGER NOT NULL DEFAULT 0, replaced_by TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** A prod-like billing.db: a bound phone with a token pair, promos in every state, logs old and new. */
function sourceDb() {
  let state: State = emptyState();
  state.settings.botToken = 'secret-bot-token';
  state.settings.yoomoneySecret = 'secret-yoomoney';
  const acc = ensureTelegramAccount(state, '42', NOW - 30 * DAY);
  const sub = createSubscription(acc.state, { accountId: acc.account.id, now: NOW - 30 * DAY, days: 60 });
  const act = activate(sub.state, { code: sub.result.code, deviceId: DEV_A, now: NOW - 29 * DAY });
  state = act.state as State;
  const s = state as Any;
  s.subscriptions[0].bonusSlots = [{ id: 'bs1', count: 1, until: null, reason: 'promo', source: 'pr-multi', grantedAt: NOW - DAY }];
  s.promos = [
    { id: 'pr-single', code: 'ONCE', days: 7, maxUses: 1, createdAt: NOW - 20 * DAY, uses: [{ id: 'u1', accountId: acc.account.id, at: NOW - 10 * DAY }] },
    { id: 'pr-multi', code: 'MANY', days: 7, maxUses: 5, createdAt: NOW - 20 * DAY, uses: [{ id: 'u2', accountId: acc.account.id, at: NOW - DAY }, { id: 'u3', accountId: 'x', at: NOW }] },
    { id: 'pr-fresh', code: 'NEW', days: 3, maxUses: 3, createdAt: NOW, uses: [] },
  ];
  s.audit = [
    { id: 'au-old', at: NOW - 400 * DAY, action: 'grant', detail: 'old' },
    { id: 'au-new', at: NOW - 10 * DAY, action: 'grant', detail: 'new' },
  ];
  s.attempts = s.attempts.concat([{ id: 'at-old', at: NOW - 100 * DAY, ok: false, reason: 'bad_code' }]);
  s.webhooks = [{ id: 'wh-old', at: NOW - 366 * DAY, kind: 'bad_signature' }, { id: 'wh-new', at: NOW - DAY, kind: 'duplicate' }];
  s.payments = [
    { id: 'p1', operationId: 'op-1', amount: '199.00', at: NOW - DAY, accountId: acc.account.id },
    { id: 'p2', operationId: 'op-1', amount: '199.00', at: NOW - DAY, error: 'rejected' },
  ];
  s.experiment = { kept: true };
  const stored = JSON.parse(JSON.stringify(normalizeState(state)));
  const code = stored.codes.find((c: Any) => c.id === act.result.codeId);
  const row = {
    id: randomBytes(16).toString('hex'),
    subscription_id: sub.result.subscriptionId,
    account_id: acc.account.id,
    code_id: code.id,
    device_id: DEV_A,
    created_at: Number(code.boundAt),
    bound_at: Number(code.boundAt),
    status: 'active',
  };
  const secret = randomBytes(32).toString('hex');
  const now = Date.now();
  const refreshToken = 'r1.' + randomBytes(32).toString('base64url');
  const file = tmpDb();
  const db = new DatabaseSync(file);
  db.exec(LEGACY_TABLES);
  db.prepare('INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(stored), NOW);
  db.prepare('INSERT INTO devices (id, subscription_id, account_id, code_id, device_id, created_at, bound_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    row.id, row.subscription_id, row.account_id, row.code_id, row.device_id, row.created_at, row.bound_at, row.status,
  );
  db.prepare('INSERT INTO refresh_tokens (hash, device_row_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(refreshToken), row.id, now, now + REFRESH_TTL_MS);
  db.prepare("INSERT INTO kv (key, value) VALUES ('token_secret', ?)").run(secret);
  db.close();
  const pair = { refreshToken, accessToken: signAccess(secret, row, now).token };
  return { file, pair, row, stored, codeId: act.result.codeId, subscriptionId: sub.result.subscriptionId };
}

/** Rewrite the snapshot as is (no normalization), to plant broken rows. */
function plant(file: string, edit: (raw: Any) => void) {
  const db = new DatabaseSync(file);
  const raw = JSON.parse((db.prepare('SELECT data FROM snapshot WHERE id = 1').get() as Any).data);
  edit(raw);
  db.prepare('UPDATE snapshot SET data = ? WHERE id = 1').run(JSON.stringify(raw));
  db.close();
}

describe('log retention', () => {
  it('drops audit and YooMoney problems after a year and attempts after 90 days; rows without a time stay', () => {
    const st = { ...emptyState(), audit: [{ at: NOW - 366 * DAY }, { at: NOW - 364 * DAY }, { action: 'no time' }], webhooks: [{ at: NOW - 400 * DAY }], attempts: [{ at: NOW - 91 * DAY }, { at: NOW - 89 * DAY }] } as Any;
    expect(expiredLogCounts(st, NOW)).toEqual({ audit: 1, webhooks: 1, attempts: 1 });
    const next = pruneLogs(st, NOW) as Any;
    expect(next.audit).toEqual([{ at: NOW - 364 * DAY }, { action: 'no time' }]);
    expect(next.webhooks).toEqual([]);
    expect(next.attempts).toEqual([{ at: NOW - 89 * DAY }]);
    expect(pruneLogs(next, NOW)).toBe(next);
  });
});

describe.skipIf(!PG_URL)('billing.db → Postgres', () => {
  it('dry run verifies everything and writes nothing', async () => {
    const src = sourceDb();
    const schema = schemaName();
    const report = await migrate({ sourcePath: src.file, schema });
    expect(report.ok, JSON.stringify(report.problems)).toBe(true);
    expect(report.result).toMatch(/dry run passed/);
    expect(report.verify.subscriptions).toMatchObject({ total: 1, checksumMismatch: [], behaviourMismatch: [] });
    expect(report.verify.global).toBe(true);
    expect(report.verify.registry).toMatchObject({ devices: { same: true }, refreshTokens: { same: true }, tokenKeySame: true, syncChanged: false });
    expect(report.prepare.promos).toMatchObject({ usesDropped: 3, revokedExhausted: ['pr-single'], reducedMaxUses: [{ id: 'pr-multi', from: 5, to: 3 }] });
    expect(report.prepare.logsExpired).toEqual({ audit: 1, webhooks: 1, attempts: 1 });
    // The report never carries settings values.
    expect(JSON.stringify(report)).not.toMatch(/secret-bot-token|secret-yoomoney/);
    const store = await pgStore(schema);
    expect(await store.read()).toEqual(JSON.parse(JSON.stringify(normalizeState(emptyState()))));
    expect((await store.query('SELECT COUNT(*)::int AS n FROM devices')).rows[0].n).toBe(0);
  });

  it('apply moves the data: promos without history, logs pruned, phones keep their tokens', async () => {
    const src = sourceDb();
    const schema = schemaName();
    const before = src.stored as Any;
    const report = await migrate({ sourcePath: src.file, schema, apply: true });
    expect(report.ok, JSON.stringify(report.problems)).toBe(true);
    expect(report.result).toMatch(/committed/);
    const store = await pgStore(schema);
    const st = await store.read();
    expect(st.subscriptions).toEqual(before.subscriptions);
    expect(st.codes).toEqual(before.codes);
    expect(st.accounts).toEqual(before.accounts);
    expect(st.payments).toEqual(before.payments);
    expect(st.settings).toEqual(before.settings);
    expect(st.experiment).toEqual({ kept: true });
    expect(st.promos.map((p: Any) => [p.id, p.uses.length, !!p.revoked, p.maxUses])).toEqual([
      ['pr-single', 0, true, 1],
      ['pr-multi', 0, false, 3],
      ['pr-fresh', 0, false, 3],
    ]);
    expect(st.audit.map((r: Any) => r.id)).toEqual(['au-new']);
    expect(st.webhooks.map((r: Any) => r.id)).toEqual(['wh-new']);
    expect(st.attempts.some((r: Any) => r.id === 'at-old')).toBe(false);

    // The registry came over as it was: same row id, the access token verifies, the refresh token rotates.
    const secret = await store.registry.tokenSecret({});
    expect((await store.registry.activeRowForCode(src.codeId)).id).toBe(src.row.id);
    expect((await store.registry.verifyAccess(secret, src.pair.accessToken, DEV_A, Date.now())).row.id).toBe(src.row.id);
    const next = await store.registry.refreshPair(secret, { refreshToken: src.pair.refreshToken, deviceId: DEV_A, now: Date.now() });
    expect(next.pair.refreshToken.indexOf('r1.')).toBe(0);

    // A second run refuses: the target is not empty.
    const again = await migrate({ sourcePath: src.file, schema, apply: true });
    expect(again.ok).toBe(false);
    expect(again.problems.map((p: Any) => p.kind)).toEqual(['target_not_empty']);
  });

  it('refuses rows without an id in the stored snapshot, duplicate ids and duplicate settled operations', async () => {
    const noId = sourceDb();
    plant(noId.file, (raw) => {
      delete raw.payments[0].id;
    });
    const r1 = await migrate({ sourcePath: noId.file, schema: schemaName(), apply: true });
    expect(r1.ok).toBe(false);
    expect(r1.problems[0]).toMatchObject({ kind: 'keys', detail: [{ collection: 'payments', missing: 1, duplicate: 0 }] });

    const dupId = sourceDb();
    plant(dupId.file, (raw) => {
      raw.accounts.push({ ...raw.accounts[0], email: 'twin@x' });
    });
    const r2 = await migrate({ sourcePath: dupId.file, schema: schemaName(), apply: true });
    expect(r2.problems[0]).toMatchObject({ kind: 'keys', detail: [{ collection: 'accounts', duplicate: 1 }] });

    const dupOp = sourceDb();
    plant(dupOp.file, (raw) => {
      raw.payments.push({ id: 'p3', operationId: 'op-1', amount: '199.00', at: NOW });
    });
    const schema = schemaName();
    const r3 = await migrate({ sourcePath: dupOp.file, schema, apply: true });
    expect(r3.ok).toBe(false);
    expect(r3.problems[0]).toMatchObject({ kind: 'duplicate_operation_id', detail: [{ count: 2 }] });
    expect(JSON.stringify(r3)).not.toContain('op-1');
    expect((await (await pgStore(schema)).read()).payments).toEqual([]);
  });

  it('any mismatch after the import rolls everything back', async () => {
    const src = sourceDb();
    const schema = schemaName();
    const report = await migrate({
      sourcePath: src.file,
      schema,
      apply: true,
      hooks: { afterImport: (q: Any) => q.query("UPDATE subscriptions SET paid_until = paid_until + 1") },
    });
    expect(report.ok).toBe(false);
    expect(report.result).toMatch(/rolled back/);
    expect(report.problems[0].detail).toEqual(expect.arrayContaining(['collection subscriptions', 'subscription checksums']));
    const store = await pgStore(schema);
    expect((await store.read()).subscriptions).toEqual([]);
    expect((await store.query('SELECT COUNT(*)::int AS n FROM devices')).rows[0].n).toBe(0);
  });

  it('the Postgres store applies retention daily: expired rows leave the state, dead rows are deleted', async () => {
    const store = await pgStore(schemaName());
    const now = Date.now();
    await store.update((s: State) => ({
      state: { ...s, audit: [{ id: 'a1', at: now - 400 * DAY, action: 'x' }, { id: 'a2', at: now, action: 'y' }], attempts: [{ id: 't1', at: now - 95 * DAY }] },
    }));
    const r = await store.retention(now);
    expect(r.expired).toEqual({ audit: 1, webhooks: 0, attempts: 1 });
    expect(r.deleted).toEqual({ audit: 1, webhooks: 0, attempts: 1 });
    expect((await store.read()).audit.map((x: Any) => x.id)).toEqual(['a2']);
    expect((await store.query('SELECT id FROM audit')).rows).toEqual([{ id: 'a2' }]);
    expect(await store.retention(now)).toEqual({ expired: { audit: 0, webhooks: 0, attempts: 0 }, deleted: { audit: 0, webhooks: 0, attempts: 0 }, adStats: 0 });
  });
});
