/**
 * Storage contract of the Postgres store (the only billing store).
 * Postgres runs when BILLING_TEST_DATABASE_URL is set (CI: a postgres:17 service); every suite gets its
 * own schema. BILLING_TEST_REQUIRE_PG=1 (CI) fails instead of skipping when the URL is missing.
 */
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activate, createSubscription, deviceCode, ensureTelegramAccount, revokeCode, unbindCode } from '../src/logic.mjs';
import { emptyState, normalizeState } from '../src/state.mjs';
import { openStore, storeEngine, toStore } from '../src/db/index.mjs';
import { createApp } from '../src/server.mjs';
import { testStore } from './pg';

const PG_URL = process.env.BILLING_TEST_DATABASE_URL || '';
const REQUIRE_PG = process.env.BILLING_TEST_REQUIRE_PG === '1';
const DAY = 24 * 60 * 60 * 1000;
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const RSS = '<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>';

type State = ReturnType<typeof emptyState>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Store = any;
type App = (req: unknown, res: unknown) => Promise<void>;

/** Stores opened here are closed (and their schemas dropped) by test/pg.ts after the file. */
const opened: Store[] = [];

async function createPgStore(opts: { connectionString: string; schema: string }): Promise<Store> {
  return testStore(opts.schema);
}

function schemaName() {
  return 'test_' + Date.now().toString(36) + '_' + randomBytes(4).toString('hex');
}

const engines: { name: string; open: () => Promise<{ store: Store; reopen: () => Promise<Store> }> }[] = [
  {
    name: 'postgres',
    open: async () => {
      const schema = schemaName();
      const store = await createPgStore({ connectionString: PG_URL, schema });
      opened.push(store);
      return {
        store,
        reopen: async () => {
          const again = await createPgStore({ connectionString: PG_URL, schema });
          opened.push(again);
          return again;
        },
      };
    },
  },
];

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Telegram account 42 with a subscription and phone A bound (legacy token), plus every collection filled. */
function richState(now: number) {
  let state: State = emptyState();
  state.settings.botToken = 'token';
  state.settings.jacredUrl = 'http://jacred.test';
  state.settings.jacredApiKey = 'k';
  state.settings.priceRub = 199;
  (state.settings as Record<string, unknown>).futureSetting = { nested: [1, 'two', null] };
  const acc = ensureTelegramAccount(state, '42', now);
  const sub = createSubscription(acc.state, { accountId: acc.account.id, now, days: 30 });
  const act = activate(sub.state, { code: sub.result.code, deviceId: DEV_A, now });
  state = act.state as State;
  const s = state as Record<string, unknown> & State;
  s.accounts = s.accounts.map((a: Record<string, unknown>) => ({ ...a, telegramUsername: 'andy', linkedDevices: [DEV_A, 'x'], unknownField: { a: 1 } }));
  s.subscriptions = s.subscriptions.map((x: Record<string, unknown>) => ({
    ...x,
    limitOverride: 3,
    swaps: [{ id: 'sw1', at: now - DAY, device: DEV_B }, { at: now, device: DEV_A }],
    bonusSlots: [{ id: 'bs1', count: 1, until: now + 5 * DAY, reason: 'promo', source: 'P1', grantedAt: now }],
    reminders: { until: now + 30 * DAY, sent: { d3: now }, tries: { d1: 2 } },
    creditRub: null,
    note: 'строка с юникодом ✅',
  }));
  s.payments = [
    { id: 'p1', operationId: 'op-1', label: 'buy:1', amount: '199.00', currency: '643', at: now, accountId: acc.account.id, credited: 199 },
    { id: 'p2', operationId: 'op-2', label: 'acc', amount: '50', at: now + 1, pending: true, heldAt: now + 1 },
    { id: 'p3', operationId: 'op-1', label: 'buy:1', amount: 'oops', at: now + 2, error: 'rejected', rejectedAt: now + 3 },
  ];
  s.webhooks = [{ kind: 'bad_signature', operationId: 'op-x', at: now, amount: 10 }];
  s.promos = [
    { id: 'pr1', code: 'SPRING', days: 7, maxUses: 2, createdAt: now, uses: [{ accountId: acc.account.id, at: now, subscriptionId: 'x' }, 'weird'] },
    { id: 'pr2', code: 'GONE', days: 1, revoked: true },
  ];
  s.links = [{ token: 'lt1', deviceId: DEV_A, accountId: '', createdAt: now, expiresAt: now + 600000, usedAt: 0 }];
  s.adminLogins = [{ token: 'al1', telegramId: '99', createdAt: now, expiresAt: now + 1, confirmedAt: 0 }];
  s.adminCliLogins = [{ hash: 'h1', createdAt: now, expiresAt: now + 1, consumedAt: 0 }];
  s.supportMessages = [
    { telegramId: '42', text: 'привет', direction: 'in', at: now },
    { telegramId: '42', text: 'ответ', direction: 'out', at: now + 1, via: 'panel' },
  ];
  s.supportReplies = [{ key: '99:5', telegramId: '42', at: now }];
  s.supportClosed = { '42': now + 2 };
  s.audit = [{ at: now, action: 'grant', detail: 'x', actor: { kind: 'admin', id: '99', label: '99' }, accountId: acc.account.id }];
  s.purchases = [{ id: 'buy1', kind: 'renew', accountId: acc.account.id, subscriptionId: 'x', price: 199.5, extras: 0, at: now, currency: 'RUB' }];
  s.outbox = [{ to: 'x@y', subject: 's' }];
  s.experiment = { flag: true, list: [1, 2] };
  return { state, accountId: acc.account.id, subscriptionId: sub.result.subscriptionId, codeId: act.result.codeId, legacy: act.result.token };
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

async function call(app: App, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: { accept: 'application/json', 'content-type': opts.body === undefined ? '' : 'application/json', ...(opts.headers || {}) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = {};
  }
  return { status: res.status, data };
}

const fetchImpl = async (url: string) => {
  if (String(url).indexOf('jacred.test') >= 0) return { ok: true, status: 200, text: async () => RSS, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
};

function search(app: App, token: string, deviceId: string) {
  return call(app, 'POST', '/v1/search', { headers: { authorization: 'Bearer ' + token, 'x-device-id': deviceId }, body: { q: 'x', source: 'jacred' } });
}

describe('BILLING_STORE selection', () => {
  it('Postgres only: BILLING_STORE may be unset or postgres; sqlite, anything else or no URL refuses to start', async () => {
    expect(storeEngine({})).toBe('postgres');
    expect(storeEngine({ BILLING_STORE: 'Postgres' })).toBe('postgres');
    expect(() => storeEngine({ BILLING_STORE: 'sqlite' })).toThrow(/no longer supported/);
    expect(() => storeEngine({ BILLING_STORE: 'mysql' })).toThrow(/BILLING_STORE/);
    await expect(openStore({})).rejects.toThrow(/BILLING_DATABASE_URL/);
    await expect(openStore({ BILLING_STORE: 'sqlite', BILLING_DATABASE_URL: 'postgres://x@127.0.0.1:1/x' })).rejects.toThrow(/no longer supported/);
    // A path to the old billing.db is not a store any more.
    expect(() => toStore('/data/billing.db')).toThrow(/Postgres/);
  });

  it('no server code loads SQLite (only tools/ reads the archived billing.db)', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const files = readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith('.mjs'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/node:sqlite/);
  });

  it.runIf(REQUIRE_PG)('CI has a Postgres for the store tests', () => {
    expect(PG_URL, 'BILLING_TEST_DATABASE_URL').not.toBe('');
  });
});

for (const engine of engines) {
  const skip = engine.name === 'postgres' && !PG_URL;
  describe.skipIf(skip)('store contract: ' + engine.name, () => {
    it('starts empty with the normalized default state', async () => {
      const { store } = await engine.open();
      expect(store.engine).toBe(engine.name);
      expect(await store.read()).toEqual(json(normalizeState(emptyState())));
    });

    it('round-trips a full state exactly, also through a fresh instance, and after edits', async () => {
      const { store, reopen } = await engine.open();
      const now = Date.UTC(2026, 9, 19, 12, 0, 0);
      const rich = richState(now);
      const res = await store.update(() => ({ state: rich.state, result: 'written' }));
      expect(res).toBe('written');
      const expected = json(normalizeState(json(rich.state)));
      expect(await store.read()).toEqual(expected);
      expect(await (await reopen()).read()).toEqual(expected);

      // Edits: delete, reorder, insert in the middle, change child arrays and settings, drop a top-level key.
      await store.update((s: Record<string, unknown> & State) => {
        s.payments = [s.payments[2], { id: 'p4', operationId: 'op-4', amount: '1', at: now + 9 }, s.payments[0]];
        s.subscriptions[0].swaps = [];
        delete s.subscriptions[0].bonusSlots;
        s.promos[0].uses.push({ accountId: 'z', at: now + 5 });
        s.accounts[0].linkedDevices = [];
        s.settings.priceRub = 299;
        delete (s.settings as Record<string, unknown>).futureSetting;
        delete s.experiment;
        s.supportClosed = {};
        s.audit = s.audit.concat([{ at: now + 1, action: 'login', detail: 'ok' }]);
        return { state: s };
      });
      const after = await store.read();
      expect(after.payments.map((p: { id: string }) => p.id)).toEqual(['p3', 'p4', 'p1']);
      expect(after.subscriptions[0].swaps).toEqual([]);
      expect('bonusSlots' in after.subscriptions[0]).toBe(false);
      expect(after.promos[0].uses.length).toBe(3);
      expect(after.settings.priceRub).toBe(299);
      expect('futureSetting' in after.settings).toBe(false);
      expect('experiment' in after).toBe(false);
      expect(after.audit.length).toBe(2);
      expect(await (await reopen()).read()).toEqual(after);
    });

    it('keeps unknown fields, nulls and values of an unexpected type as they are', async () => {
      const { store, reopen } = await engine.open();
      const odd = {
        id: 'acc-odd',
        email: 42,
        telegramId: null,
        createdAt: 1.5,
        $dollar: 'kept',
        $arrays: 'not a marker',
        linkedDevices: 'not an array',
        deep: { a: [null, true, { b: 'c' }] },
      };
      await store.update((s: State) => ({ state: { ...s, accounts: [odd], payments: [{ id: 'pay-odd', amount: 199, pending: 'yes', credited: '10' }] } }));
      const fresh = await (await reopen()).read();
      expect(fresh.accounts).toEqual([odd]);
      expect(fresh.payments).toEqual([{ id: 'pay-odd', amount: 199, pending: 'yes', credited: '10' }]);
    });

    it('serializes parallel updates (no lost write) and returns each result', async () => {
      const { store } = await engine.open();
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          store.update((s: State) => {
            s.settings.priceRub = Number(s.settings.priceRub) + 1;
            return { state: s, result: i };
          }),
        ),
      );
      expect(results).toEqual(Array.from({ length: 25 }, (_, i) => i));
      expect((await store.read()).settings.priceRub).toBe(25);
    });

    it('a throwing update changes nothing and the next one works', async () => {
      const { store } = await engine.open();
      await expect(
        store.update(() => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await store.update((s: State) => ({ state: { ...s, settings: { ...s.settings, priceRub: 5 } } }));
      expect((await store.read()).settings.priceRub).toBe(5);
    });

    it('registry: snapshot sync, pairs, rotation, lost response, clone mark, names, lastSeen, revoke', async () => {
      const { store } = await engine.open();
      const now = Date.now();
      const rich = richState(now);
      await store.update(() => ({ state: rich.state }));
      const reg = store.registry;
      const row = await reg.activeRowForCode(rich.codeId);
      expect(row).toMatchObject({ code_id: rich.codeId, device_id: DEV_A, subscription_id: rich.subscriptionId, status: 'active', clone_count: 0 });
      expect(typeof row.created_at).toBe('number');
      expect((await reg.activeRowsByCode()).get(rich.codeId).id).toBe(row.id);
      const secret = await reg.tokenSecret({});
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(await reg.tokenSecret({})).toBe(secret);
      expect(await reg.tokenSecret({ BILLING_TOKEN_SECRET: 'e'.repeat(40) })).toBe('e'.repeat(40));

      expect((await reg.listDevices(rich.subscriptionId)).map((d: { auth: string }) => d.auth)).toEqual(['legacy']);
      const first = await reg.issuePair(secret, row, now);
      expect((await reg.listDevices(rich.subscriptionId))[0].auth).toBe('refresh');
      const ok = await reg.verifyAccess(secret, first.pair.accessToken, DEV_A, now);
      expect(ok.row.id).toBe(row.id);
      expect((await reg.verifyAccess(secret, first.pair.accessToken, DEV_B, now)).error).toBe('bad_token');

      const second = await reg.refreshPair(secret, { refreshToken: first.pair.refreshToken, deviceId: DEV_A, now: now + 1000 });
      expect(second.pair.refreshToken).not.toBe(first.pair.refreshToken);
      const retry = await reg.refreshPair(secret, { refreshToken: first.pair.refreshToken, deviceId: DEV_A, now: now + 2000 });
      expect(retry.retry).toBe(true);
      await reg.refreshPair(secret, { refreshToken: retry.pair.refreshToken, deviceId: DEV_A, now: now + 3000 });
      const clone = await reg.refreshPair(secret, { refreshToken: first.pair.refreshToken, deviceId: DEV_A, now: now + 4000 });
      expect(clone).toMatchObject({ clone: true, cloneLog: true });
      expect((await reg.deviceRow(row.id)).clone_count).toBe(1);
      expect((await reg.refreshPair(secret, { refreshToken: 'r1.nope', deviceId: DEV_A, now })).error).toBe('bad_token');
      const upgraded = await reg.upgradePair(secret, { row, now: now + 5000, again: false, since: now });
      expect(upgraded.accessToken.indexOf('a1.')).toBe(0);

      expect(await reg.setDeviceName(row.id, 'Xiaomi <b>2201117TY</b>')).toBe(true);
      expect(await reg.setDeviceName(row.id, 'Xiaomi <b>2201117TY</b>')).toBe(false);
      expect(await reg.touchRow(row.id, { ip: '95.24.113.7', now: now + 6000, force: true })).toBe(true);
      expect(await reg.touchRow(row.id, { ip: '95.24.113.7', now: now + 7000, force: false })).toBe(false);
      expect(await reg.deviceRow(row.id)).toMatchObject({ name: 'Xiaomi b 2201117TY /b', last_seen_at: now + 6000, last_ip_net: '95.24.113.*' });

      // A write that unbinds the code revokes the row and its tokens; the reason can be refined.
      await store.update((s: State) => ({ state: revokeCode(s, rich.codeId) }));
      expect(await reg.activeRowForCode(rich.codeId)).toBeNull();
      expect((await reg.deviceRow(row.id)).status).toBe('revoked');
      await reg.setRevokeReason(row.id, 'admin');
      expect((await reg.deviceRow(row.id)).revoke_reason).toBe('admin');
      expect((await reg.refreshPair(secret, { refreshToken: upgraded.refreshToken, deviceId: DEV_A, now: now + 8000 })).error).toBe('revoked');
      expect((await reg.verifyAccess(secret, upgraded.accessToken, DEV_A, now + 8000)).error).toBe('revoked');
      expect(await reg.revokeRow(row.id, 'again', now)).toBe(false);
    });

    it('a same-millisecond unbind + rebind of one phone keeps an active registry row', async () => {
      const { store } = await engine.open();
      const now = Date.now();
      const rich = richState(now);
      await store.update(() => ({ state: rich.state }));
      const before = await store.registry.activeRowForCode(rich.codeId);
      const bound = (await store.read()).codes.find((c: { id: string }) => c.id === rich.codeId).boundAt;
      await store.update((s: State) => ({ state: unbindCode(s, rich.codeId) }));
      expect(await store.registry.activeRowForCode(rich.codeId)).toBeNull();
      const plain = (await store.read()).codes.find((c: { id: string }) => c.id === rich.codeId).plain;
      const res = await store.update((s: State) => activate(s, { code: plain, deviceId: DEV_A, now: bound, legacy: false }));
      expect(res.codeId).toBe(rich.codeId);
      const row = await store.registry.activeRowForCode(rich.codeId);
      expect(row).not.toBeNull();
      expect(row.id).not.toBe(before.id);
      expect(row.bound_at).toBe(bound + 1);
    });

    it('HTTP: activate with a pair, search, refresh, legacy upgrade and an unbind work through createApp(store)', async () => {
      const { store } = await engine.open();
      const now = Date.now();
      const rich = richState(now);
      await store.update(() => ({ state: rich.state }));
      const app = createApp(store, fetchImpl, { env: {} }) as App;

      expect((await search(app, rich.legacy, DEV_A)).status).toBe(200);
      const up = await call(app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + rich.legacy, 'x-device-id': DEV_A }, body: { name: 'Pixel 8' } });
      expect(up.status).toBe(200);
      expect((await search(app, String(up.data.accessToken), DEV_A)).status).toBe(200);

      const slot = await store.update((s: State) => {
        const out = deviceCode(s, rich.subscriptionId, Date.now());
        return { state: out.state, result: out };
      });
      const act = await call(app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId: DEV_B, tokens: 'pair', name: 'Galaxy' } });
      expect(act.status).toBe(200);
      expect(String(act.data.refreshToken).indexOf('r1.')).toBe(0);
      expect((await search(app, String(act.data.accessToken), DEV_B)).status).toBe(200);
      const ref = await call(app, 'POST', '/v1/token/refresh', { body: { refreshToken: act.data.refreshToken, deviceId: DEV_B } });
      expect(ref.status).toBe(200);
      expect((await search(app, String(ref.data.accessToken), DEV_B)).status).toBe(200);

      const devices = await store.registry.listDevices(rich.subscriptionId);
      expect(devices.map((d: { device_id: string; name: string }) => [d.device_id, d.name])).toEqual([
        [DEV_A, 'Pixel 8'],
        [DEV_B, 'Galaxy'],
      ]);

      await store.update((s: State) => ({ state: revokeCode(s, slot.codeId) }));
      const dead = await search(app, String(ref.data.accessToken), DEV_B);
      expect(dead.status).toBe(401);
      expect(dead.data.error).toBe('revoked');
      expect((await search(app, String(up.data.accessToken), DEV_A)).status).toBe(200);
    });
  });
}

describe.skipIf(!PG_URL)('postgres only', () => {
  it('one settled payment per operation id is enforced by the database; the failed write changes nothing', async () => {
    const store = await createPgStore({ connectionString: PG_URL, schema: schemaName() });
    opened.push(store);
    await store.update((s: State) => ({ state: { ...s, payments: [{ id: 'a', operationId: 'op', amount: '1', at: 1 }] } }));
    await expect(
      store.update((s: State) => ({ state: { ...s, payments: s.payments.concat([{ id: 'b', operationId: 'op', amount: '1', at: 2 }]) } })),
    ).rejects.toThrow(/payments_operation_settled/);
    expect((await store.read()).payments.map((p: { id: string }) => p.id)).toEqual(['a']);
    // Held and rejected rows of the same operation are allowed.
    await store.update((s: State) => ({
      state: {
        ...s,
        payments: s.payments.concat([
          { id: 'c', operationId: 'op', pending: true, at: 3 },
          { id: 'd', operationId: 'op', error: 'rejected', at: 4 },
        ]),
      },
    }));
    expect((await store.read()).payments.length).toBe(3);
    const num = await store.query("SELECT amount_num FROM payments WHERE id = 'a'");
    expect(Number(num.rows[0].amount_num)).toBe(1);
  });

  it('logs are append-only: a row trimmed from the array stays in the table, not in the state', async () => {
    const store = await createPgStore({ connectionString: PG_URL, schema: schemaName() });
    opened.push(store);
    const rows = [1, 2, 3].map((i) => ({ id: 'au' + i, at: i, action: 'x', detail: String(i) }));
    await store.update((s: State) => ({ state: { ...s, audit: rows } }));
    await store.update((s: State) => ({ state: { ...s, audit: s.audit.slice(1).concat([{ id: 'au4', at: 4, action: 'x', detail: '4' }]) } }));
    expect((await store.read()).audit.map((r: { id: string }) => r.id)).toEqual(['au2', 'au3', 'au4']);
    const all = await store.query('SELECT id, live FROM audit ORDER BY ord');
    expect(all.rows).toEqual([
      { id: 'au1', live: false },
      { id: 'au2', live: true },
      { id: 'au3', live: true },
      { id: 'au4', live: true },
    ]);
  });

  it('two instances on one database see each other and never lose a write', async () => {
    const schema = schemaName();
    const a = await createPgStore({ connectionString: PG_URL, schema });
    const b = await createPgStore({ connectionString: PG_URL, schema });
    opened.push(a, b);
    const bump = (s: State) => {
      s.settings.priceRub = Number(s.settings.priceRub) + 1;
      return { state: s };
    };
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).update(bump)));
    expect((await a.read()).settings.priceRub).toBe(20);
    expect((await b.read()).settings.priceRub).toBe(20);
  });

  it('info() names the engine and size, never the host, user or password', async () => {
    const store = await createPgStore({ connectionString: PG_URL, schema: schemaName() });
    opened.push(store);
    const info = await store.info();
    expect(info.engine).toBe('postgres');
    expect(info.bytes).toBeGreaterThan(0);
    // Only these fields: nothing from the connection string except the database name.
    const u = new URL(PG_URL);
    expect(Object.keys(info).sort()).toEqual(['bytes', 'database', 'engine', 'path']);
    expect(info.database).toBe(decodeURIComponent(u.pathname.slice(1)));
    expect(info.path).toBe(info.database);
    const text = JSON.stringify(info);
    expect(text).not.toContain(u.hostname);
    expect(text).not.toContain('@');
  });

  it('migrations are recorded once and the active-device index is unique per code', async () => {
    const schema = schemaName();
    const store = await createPgStore({ connectionString: PG_URL, schema });
    const again = await createPgStore({ connectionString: PG_URL, schema });
    opened.push(store, again);
    expect((await store.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual([{ version: '001_init' }, { version: '002_monitor' }]);
    const idx = await store.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'devices_active_code' AND schemaname = $1", [schema]);
    expect(idx.rows[0].indexdef).toMatch(/UNIQUE.*WHERE \(status = 'active'::text\)/);
  });
});
