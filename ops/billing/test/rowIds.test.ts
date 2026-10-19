// Stable row ids (meta.rowIds = 1): every row of the billing state gets an `id`, the Postgres primary key later
// (docs/billing/postgres-migration-plan.md, PR 1). Rows stored before get a derived id on read; new rows a random one.
import { describe, expect, it } from 'vitest';
import { confirmPendingPayment, selfUnbind } from '../src/deviceAdmin.mjs';
import {
  activate,
  applyPayment,
  appendSupportMessage,
  createPromo,
  createSubscription,
  deviceCode,
  deviceLimitNow,
  ensureTelegramAccount,
  limitBreakdown,
  logAudit,
  logWebhook,
  migrateRowIds,
  redeemPromo,
  withRowId,
} from '../src/logic.mjs';
import { emptyState, normalizeState } from '../src/state.mjs';
import { readState, writeState, testStore } from './pg';

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0); // 19.10.2026 12:00 MSK
const DEVS = ['a', 'b', 'c'].map((c) => c.repeat(32));
const HEX16 = /^[0-9a-f]{16}$/;

type State = ReturnType<typeof emptyState>;
type Row = Record<string, unknown> & { id?: string };

/** Account 42 with a subscription, two bound phones and one self-service device change. */
function live() {
  let state: State = emptyState();
  Object.assign(state.settings, { priceRub: 150, extraDeviceRub: 50, periodDays: 30 });
  const opened = ensureTelegramAccount(state, '42', NOW);
  const accountId = opened.account.id as string;
  const created = createSubscription(opened.state, { accountId, now: NOW, days: 30 });
  state = created.state;
  const sub = created.result.subscriptionId as string;
  for (let i = 0; i < 2; i++) {
    const slot = deviceCode(state, sub, NOW + i);
    state = activate(slot.state, { code: slot.code, deviceId: DEVS[i], now: NOW + i }).state;
  }
  state = activate(state, { code: 'ZZZZ-ZZZZ', deviceId: DEVS[2], now: NOW + 5 }).state; // bad_code attempt
  state = applyPayment(state, { operationId: 'op-1', label: 'sub:' + sub, amount: '150.00', currency: '643', now: NOW + 10 }).state;
  state = logWebhook(state, { kind: 'bad_signature', operationId: 'op-x', label: '', amount: '1', at: NOW + 11 });
  state = logAudit(state, { action: 'settings', detail: 'x', now: NOW + 12 });
  state = appendSupportMessage(state, { telegramId: '42', text: 'привет', direction: 'in', now: NOW + 13 }).state;
  const promo = createPromo(state, { code: 'GIFT1', days: 3, maxUses: 5, now: NOW + 14 });
  state = redeemPromo(promo.state, { code: 'GIFT1', accountId, now: NOW + 15 }).state;
  state = selfUnbind(state, { accountId, deviceIds: [DEVS[1]], now: NOW + 16 }).state as State;
  return { state, sub, accountId };
}

/** The same state the way the previous image stored it: no ids on log rows, swaps or promo uses, no meta.rowIds. */
function withoutIds(state: State) {
  const strip = (list: Row[]) => list.map(({ id: _id, ...rest }) => rest);
  const { rowIds: _r, ...meta } = state.meta as Record<string, unknown>;
  return {
    ...state,
    meta,
    payments: strip(state.payments),
    attempts: strip(state.attempts),
    webhooks: strip(state.webhooks),
    audit: strip(state.audit),
    subscriptions: state.subscriptions.map((s: Row) => ({ ...s, swaps: strip((s.swaps as Row[]) || []) })),
    promos: state.promos.map((p: Row) => ({ ...p, uses: strip((p.uses as Row[]) || []) })),
  } as Record<string, unknown>;
}

/** What a read of a stored snapshot gives: the one-time migrations run in normalizeState on every read. */
function readRaw(snapshot: unknown): State {
  return normalizeState(JSON.parse(JSON.stringify(snapshot)));
}

/** Every id of every row collection, by collection. */
function idsOf(state: State) {
  const out: Record<string, string[]> = {};
  for (const key of ['payments', 'attempts', 'webhooks', 'audit', 'supportMessages', 'accounts', 'subscriptions', 'codes', 'promos']) {
    out[key] = (state[key as keyof State] as Row[]).map((r) => r.id as string);
  }
  out.swaps = state.subscriptions.flatMap((s: Row) => ((s.swaps as Row[]) || []).map((r) => r.id as string));
  out.uses = state.promos.flatMap((p: Row) => ((p.uses as Row[]) || []).map((r) => r.id as string));
  return out;
}

describe('new rows get an id when they are made', () => {
  it('payments, attempts, webhooks, audit, support, swaps and promo uses', () => {
    const { state } = live();
    const ids = idsOf(state);
    for (const key of ['payments', 'attempts', 'webhooks', 'audit', 'supportMessages', 'swaps', 'uses']) {
      expect(ids[key].length, key).toBeGreaterThan(0);
      for (const id of ids[key]) expect(id, key).toMatch(HEX16);
      expect(new Set(ids[key]).size, key).toBe(ids[key].length);
    }
    expect(state.meta.rowIds).toBe(1);
    // nothing to fill: the same object comes back
    expect(migrateRowIds(state)).toBe(state);
  });

  it('a held payment keeps its id when it is accepted (by YooMoney or the admin)', () => {
    const { state, sub } = live();
    const held = applyPayment(state, { operationId: 'op-2', label: 'sub:' + sub, amount: '150.00', currency: '643', unaccepted: true, now: NOW + 20 });
    const heldId = held.state.payments.find((p: Row) => p.operationId === 'op-2').id;
    expect(heldId).toMatch(HEX16);
    const accepted = applyPayment(held.state, { operationId: 'op-2', label: 'sub:' + sub, amount: '150.00', currency: '643', now: NOW + 30 });
    const rows = accepted.state.payments.filter((p: Row) => p.operationId === 'op-2');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(heldId);
    expect(rows[0].pending).toBeUndefined();
    const confirmed = confirmPendingPayment(held.state, { operationId: 'op-2', now: NOW + 30, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(confirmed.state.payments.filter((p: Row) => p.operationId === 'op-2').map((p: Row) => p.id)).toEqual([heldId]);
  });

  it('withRowId keeps an id that is there', () => {
    const row = { id: 'abc', at: 1 };
    expect(withRowId(row)).toBe(row);
    expect(withRowId({ at: 1 }).id).toMatch(HEX16);
  });
});

describe('migration of a snapshot from before row ids', () => {
  it('fills every missing id and changes nothing else; the device limit stays the same', () => {
    const { state, sub } = live();
    const old = withoutIds(state);
    const read = readRaw(old);
    expect(read.meta.rowIds).toBe(1);
    const ids = idsOf(read);
    for (const key of Object.keys(ids)) {
      for (const id of ids[key]) expect(id, key).toMatch(HEX16);
      expect(new Set(ids[key]).size, key).toBe(ids[key].length);
    }
    // only `id` and meta.rowIds were added
    expect(withoutIds(read)).toEqual(withoutIds(readRaw(state)));
    const before = readRaw({ ...old, meta: { ...(old.meta as object) } });
    const s0 = before.subscriptions.find((s: Row) => s.id === sub);
    const s1 = read.subscriptions.find((s: Row) => s.id === sub);
    expect(deviceLimitNow(read, s1, NOW)).toBe(deviceLimitNow(state, state.subscriptions.find((s: Row) => s.id === sub), NOW));
    expect(limitBreakdown(read, s1, NOW)).toEqual(limitBreakdown(before, s0, NOW));
  });

  it('is stable: every read of the same snapshot gives the same ids, and a write keeps them', async () => {
    const old = withoutIds(live().state);
    const a = readRaw(old);
    const b = readRaw(old);
    expect(idsOf(b)).toEqual(idsOf(a));
    const file = await testStore();
    await writeState(file, a);
    expect(idsOf((await readState(file)))).toEqual(idsOf(a));
    // idempotent
    expect(migrateRowIds(a)).toBe(a);
    expect(migrateRowIds({ ...a, meta: { ...a.meta, rowIds: 0 } }).payments).toBe(a.payments);
  });

  it('rows added without an id (an older writer) are filled on the next read; the others keep theirs', () => {
    const migrated = readRaw(withoutIds(live().state));
    const snap = JSON.parse(JSON.stringify(migrated));
    snap.audit.push({ at: NOW + 100, action: 'old_image', detail: 'y' });
    snap.payments.push({ operationId: 'op-old', label: 'x', amount: '1', at: NOW + 101, error: 'bad_label' });
    const again = readRaw(snap);
    const before = idsOf(migrated);
    const after = idsOf(again);
    expect(after.audit.slice(0, -1)).toEqual(before.audit);
    expect(after.payments.slice(0, -1)).toEqual(before.payments);
    expect(after.audit.at(-1)).toMatch(HEX16);
    expect(after.payments.at(-1)).toMatch(HEX16);
    expect(new Set(after.payments).size).toBe(after.payments.length);
  });

  it('a repeated id on a log row is replaced; entities keep theirs', () => {
    const { state } = live();
    const dupPayments = state.payments.concat([{ ...state.payments[0], operationId: 'op-copy' }]);
    const dupAccounts = state.accounts.concat([{ ...state.accounts[0], telegramId: '43' }]);
    const out = migrateRowIds({ ...state, payments: dupPayments, accounts: dupAccounts });
    expect(out.payments[0].id).toBe(state.payments[0].id);
    expect(out.payments.at(-1).id).not.toBe(state.payments[0].id);
    expect(out.payments.at(-1).id).toMatch(HEX16);
    expect(out.accounts.map((a: Row) => a.id)).toEqual(dupAccounts.map((a: Row) => a.id));
    // deterministic
    expect(migrateRowIds({ ...state, payments: dupPayments }).payments.at(-1).id).toBe(out.payments.at(-1).id);
  });

  it('an empty or missing state still gets meta.rowIds', () => {
    expect(emptyState().meta.rowIds).toBe(1);
    expect(readRaw({ settings: {}, meta: { deviceBase: 2, extraMonthly: 1, limitModel: 1 } }).meta.rowIds).toBe(1);
  });
});
