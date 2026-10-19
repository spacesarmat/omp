import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePayload, userPayload } from '../src/adminApi.mjs';
import { botCallback, botReply } from '../src/bot.mjs';
import {
  confirmPendingPayment,
  maskIp,
  pendingPayments,
  rejectPendingPayment,
  resetSwaps,
  revokeDevice,
  SEEN_EVERY_MS,
  selfUnbind,
  setDeviceLimit,
  subtractDays,
  swapStatus,
  SWAP_WINDOW_MS,
} from '../src/deviceAdmin.mjs';
import { activeRowForCode, listDevices, touchRow } from '../src/registry.mjs';
import {
  activate,
  adminDashboard,
  applyPayment,
  createSubscription,
  deviceCode,
  ensureTelegramAccount,
  issueCliAdminLogin,
  logAudit,
  migrateTruncatedIps,
  pageAudit,
  quotePurchase,
  truncateIp,
  sessionForDevice,
  sessionOk,
} from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState, readState, registryDb, updateState, writeState } from '../src/store.mjs';

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const ADMIN = { kind: 'admin', id: '99', label: '99' };
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

type State = ReturnType<typeof emptyState>;

/** A Telegram account (id 42) with a 30-day subscription and one phone bound. */
function withDevice(now = NOW) {
  let state: State = emptyState();
  state.settings.priceRub = 150;
  state.settings.extraDeviceRub = 50;
  state.settings.periodDays = 30;
  state.settings.yoomoneyWallet = '4100';
  const opened = ensureTelegramAccount(state, '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV_A, now });
  state = act.state;
  return { state, accountId: opened.account.id, subscriptionId: created.result.subscriptionId, token: act.result.token, codeId: act.result.codeId };
}

/** Bind one more phone on the same subscription. */
function bindAnother(state: State, subscriptionId: string, deviceId: string, now: number) {
  const slot = deviceCode(state, subscriptionId, now);
  const act = activate(slot.state, { code: slot.code, deviceId, now });
  return { state: act.state, token: act.result.token, codeId: act.result.codeId };
}

describe('lastSeen / lastIp', () => {
  it('masks IPv4 and IPv6 partially', () => {
    expect(maskIp('95.24.113.7')).toBe('95.24.113.*');
    expect(maskIp('::ffff:10.1.2.3')).toBe('10.1.2.*');
    expect(maskIp('2a02:6b8:c0e:500:1:2:3:4')).toBe('2a02:6b8:c0e::*');
    expect(maskIp('')).toBe('');
  });

  it('writes the registry row at most once per 10 minutes, truncated, and never a free code', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omp-seen-')), 'billing.db');
    const s = withDevice();
    writeState(file, s.state);
    const db = registryDb(file);
    const row = activeRowForCode(db, s.codeId);
    expect(row.device_id).toBe(DEV_A);
    expect(touchRow(db, row.id, { ip: '95.24.113.7', now: NOW })).toBe(true);
    expect(activeRowForCode(db, s.codeId)).toMatchObject({ last_seen_at: NOW, last_ip_net: '95.24.113.*' });
    expect(touchRow(db, row.id, { ip: '1.2.3.4', now: NOW + SEEN_EVERY_MS - 1 })).toBe(false);
    expect(activeRowForCode(db, s.codeId)).toMatchObject({ last_seen_at: NOW, last_ip_net: '95.24.113.*' });
    expect(touchRow(db, row.id, { ip: '1.2.3.4', now: NOW + SEEN_EVERY_MS })).toBe(true);
    expect(activeRowForCode(db, s.codeId)).toMatchObject({ last_seen_at: NOW + SEEN_EVERY_MS, last_ip_net: '1.2.3.*' });
    // The snapshot is not rewritten for lastSeen any more.
    const snapshot = JSON.stringify(readState(file));
    expect(snapshot).not.toContain('1.2.3.');
    // A free (unbound) code has no registry row.
    const free = deviceCode(s.state, s.subscriptionId, NOW);
    writeState(file, free.state);
    expect(activeRowForCode(db, free.codeId)).toBeNull();
  });

  it('shows the device list from the registry with masked IPs and never the full address', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omp-seen-')), 'billing.db');
    const s = withDevice(Date.now());
    writeState(file, s.state);
    const db = registryDb(file);
    const row = activeRowForCode(db, s.codeId);
    touchRow(db, row.id, { ip: '95.24.113.7', now: Date.now(), force: true });
    const user = userPayload(readState(file), s.accountId, { registry: (subId: string) => listDevices(db, subId) });
    expect(user.devices).toHaveLength(1);
    expect(user.devices[0].id).toBe(row.id);
    expect(user.devices[0].codeId).toBe(s.codeId);
    expect(user.devices[0].deviceId).toBe(DEV_A.slice(0, 8));
    expect(user.devices[0].lastIp).toBe('95.24.113.*');
    expect(user.devices[0].auth).toBe('legacy');
    expect(user.devices[0].boundAt).toBeGreaterThan(0);
    expect(user.devices[0].lastSeenAt).toBeGreaterThan(0);
    expect(JSON.stringify(user)).not.toContain('95.24.113.7');
    expect(JSON.stringify(user)).not.toContain(DEV_A);
  });
});

describe('stored IPs are truncated', () => {
  it('cuts the last part of IPv4 and keeps three IPv6 groups, idempotently', () => {
    expect(truncateIp('95.24.113.7')).toBe('95.24.113.*');
    expect(truncateIp('95.24.113.*')).toBe('95.24.113.*');
    expect(truncateIp('::ffff:10.1.2.3')).toBe('10.1.2.*');
    expect(truncateIp('2A02:6B8:C0E:500:1:2:3:4')).toBe('2a02:6b8:c0e::*');
    expect(truncateIp('2a02:6b8:c0e::*')).toBe('2a02:6b8:c0e::*');
    expect(truncateIp('')).toBe('');
  });

  it('migrates full addresses written by an earlier build when the snapshot is read', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'omp-ipmig-')), 'billing.db');
    const s = withDevice();
    const b = bindAnother(s.state, s.subscriptionId, DEV_B, NOW);
    const raw = {
      ...b.state,
      codes: b.state.codes.map((c: { id: string }) =>
        c.id === s.codeId ? { ...c, lastSeenAt: NOW, lastIp: '95.24.113.7' } : c.id === b.codeId ? { ...c, lastSeenAt: NOW, lastIp: '2a02:6b8:c0e:500::1' } : c,
      ),
    };
    // Written as is, the way an older server would have stored it.
    writeState(file, raw);
    const read = readState(file);
    expect(read.codes.find((c: { id: string }) => c.id === s.codeId).lastIp).toBe('95.24.113.*');
    expect(read.codes.find((c: { id: string }) => c.id === b.codeId).lastIp).toBe('2a02:6b8:c0e::*');
    expect(JSON.stringify(read)).not.toContain('95.24.113.7');
    expect(migrateTruncatedIps(read)).toBe(read);
  });
});

describe('admin: revoke, limit, subtract', () => {
  it('revokes a device: the token stops working, the slot gets a new code, the timeline has it', () => {
    const s = withDevice();
    expect(sessionOk(s.state, { token: s.token, deviceId: DEV_A, now: NOW + MIN })).not.toBeNull();
    const out = revokeDevice(s.state, { accountId: s.accountId, codeId: s.codeId, now: NOW + MIN, actor: ADMIN });
    expect(out.result.ok).toBe(true);
    expect(sessionOk(out.state, { token: s.token, deviceId: DEV_A, now: NOW + 2 * MIN })).toBeNull();
    expect(sessionForDevice(out.state, { token: s.token, deviceId: DEV_A })).toBeNull();
    const row = out.state.codes.find((c: { id: string }) => c.id === s.codeId);
    expect(row.deviceId).toBe('');
    expect(row.plain).toBeTruthy();
    const audit = out.state.audit[out.state.audit.length - 1];
    expect(audit.action).toBe('device_revoke');
    expect(audit.accountId).toBe(s.accountId);
    expect(audit.actor.kind).toBe('admin');
    const feed = adminDashboard(out.state, NOW + 2 * MIN).events;
    expect(feed.some((e: { kind: string; text: string; accountId: string }) => e.kind === 'admin' && e.text.indexOf('Отозвано устройство aaaaaaaa') === 0 && e.accountId === s.accountId)).toBe(true);
    // Twice, or a device of another account, is refused.
    expect(revokeDevice(out.state, { accountId: s.accountId, codeId: s.codeId, now: NOW, actor: ADMIN }).result.error).toBe('not_bound');
    const other = ensureTelegramAccount(s.state, '77', NOW);
    expect(revokeDevice(other.state, { accountId: other.account.id, codeId: s.codeId, now: NOW, actor: ADMIN }).result.error).toBe('not_found');
  });

  it('changes the limit and extra slots, and warns when bound devices exceed it', () => {
    const s = withDevice();
    const two = bindAnother(s.state, s.subscriptionId, DEV_B, NOW + MIN);
    const up = setDeviceLimit(two.state, { accountId: s.accountId, extraSlots: '1', now: NOW, actor: ADMIN });
    expect(up.result.total).toBe(3);
    const sub = up.state.subscriptions[0];
    expect(sub.extraSlots).toBe(1);
    expect(sub.extraUntil).toBe(sub.paidUntil);
    expect(up.state.audit[up.state.audit.length - 1].detail).toContain('Лимит устройств 2 (2 базовых) → 3 (2 базовых + 1 купленный)');
    const down = setDeviceLimit(up.state, { accountId: s.accountId, limitOverride: 1, extraSlots: 0, now: NOW, actor: ADMIN });
    expect(down.result.total).toBe(1);
    // The newest phone is over the limit now: no access, a warning on the card and on the home page.
    expect(sessionOk(down.state, { token: two.token, deviceId: DEV_B, now: NOW + 2 * MIN })).toBeNull();
    expect(sessionOk(down.state, { token: s.token, deviceId: DEV_A, now: NOW + 2 * MIN })).not.toBeNull();
    const now = NOW + 2 * MIN;
    const alerts = adminDashboard(down.state, now).alerts;
    expect(alerts.some((a: { text: string }) => a.text.indexOf('Устройств больше лимита (2 из 1)') === 0)).toBe(true);
    expect(down.state.subscriptions[0].limitOverride).toBe(1);
    expect(down.result.text).toBe('1 (индивидуальный лимит)');
    for (const bad of [0, 21, 1.5, 'x']) {
      expect(setDeviceLimit(down.state, { accountId: s.accountId, limitOverride: bad, now, actor: ADMIN }).result.error).toBe('bad_args');
    }
    expect(setDeviceLimit(down.state, { accountId: s.accountId, limitOverride: 2, extraSlots: -1, now, actor: ADMIN }).result.error).toBe('bad_args');
    // empty = back to the global base
    const back = setDeviceLimit(down.state, { accountId: s.accountId, limitOverride: '', now, actor: ADMIN });
    expect(back.state.subscriptions[0].limitOverride).toBeNull();
    expect(back.result.total).toBe(2);
  });

  it('subtracts days and cuts extra slots to the new date', () => {
    const s = withDevice();
    const extra = setDeviceLimit(s.state, { accountId: s.accountId, extraSlots: 1, now: NOW, actor: ADMIN }).state;
    const before = extra.subscriptions[0].paidUntil;
    const out = subtractDays(extra, { accountId: s.accountId, days: '10', now: NOW, actor: ADMIN });
    expect(out.result.paidUntil).toBe(before - 10 * DAY);
    expect(out.state.subscriptions[0].extraUntil).toBe(before - 10 * DAY);
    expect(out.state.audit[out.state.audit.length - 1].action).toBe('days_subtract');
    // Into the past: access ends once the grace period is over.
    const gone = subtractDays(out.state, { accountId: s.accountId, days: 40, now: NOW, actor: ADMIN });
    expect(sessionOk(gone.state, { token: s.token, deviceId: DEV_A, now: NOW + 4 * DAY })).toBeNull();
    for (const bad of [0, -1, 2.5, 'abc', 3651]) {
      expect(subtractDays(out.state, { accountId: s.accountId, days: bad, now: NOW, actor: ADMIN }).result.error).toBe('bad_args');
    }
  });
});

describe('event feed', () => {
  it('hides «Показан код» and «Сохранены настройки» but keeps them in the journal', () => {
    const s = withDevice();
    let st = logAudit(s.state, { action: 'code_reveal', detail: s.codeId, now: NOW, actor: ADMIN });
    st = logAudit(st, { action: 'settings_save', detail: 'ok', now: NOW + 1, actor: ADMIN });
    st = logAudit(st, { action: 'services_save', detail: 'ok', now: NOW + 2, actor: ADMIN });
    st = revokeDevice(st, { accountId: s.accountId, codeId: s.codeId, now: NOW + 3, actor: ADMIN }).state;
    const admin = adminDashboard(st, NOW + MIN).events.filter((e: { kind: string }) => e.kind === 'admin');
    const texts = admin.map((e: { text: string }) => e.text);
    expect(texts.some((t: string) => t === 'Показан код' || t === 'code_reveal')).toBe(false);
    expect(texts.some((t: string) => t === 'Сохранены настройки' || t === 'settings_save')).toBe(false);
    expect(texts).toContain('Сохранены сервисы');
    expect(texts.some((t: string) => t.indexOf('Отозвано устройство') === 0)).toBe(true);
    const journal = pageAudit(st, { limit: 50 }).audit.map((r: { action: string }) => r.action);
    expect(journal).toEqual(expect.arrayContaining(['code_reveal', 'settings_save', 'services_save', 'device_revoke']));
  });
});

describe('held YooMoney payments', () => {
  function held() {
    const s = withDevice();
    const quote = quotePurchase(s.state, { kind: 'sub', accountId: s.accountId, subscriptionId: s.subscriptionId, now: NOW });
    const pay = applyPayment(quote.state, {
      operationId: 'op-1',
      label: quote.result.label,
      amount: '150.00',
      currency: '643',
      unaccepted: 'true',
      now: NOW + MIN,
    });
    expect(pay.result.pending).toBe(true);
    return { ...s, state: pay.state, label: quote.result.label, before: pay.state.subscriptions[0].paidUntil };
  }

  it('lists held payments for the home page and the card', () => {
    const h = held();
    const rows = pendingPayments(h.state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operationId: 'op-1', amount: '150.00', kind: 'sub', price: 150, accountId: h.accountId });
    expect(pendingPayments(h.state, 'someone-else')).toHaveLength(0);
    expect(homePayload(h.state, '/tmp/x.db', {}).pending).toHaveLength(1);
    expect(adminDashboard(h.state, NOW + MIN).alerts.some((a: { text: string }) => a.text.indexOf('Платёж ждёт подтверждения') === 0)).toBe(true);
  });

  it('confirms once: a second click and the later accepted notice change nothing', () => {
    const h = held();
    const first = confirmPendingPayment(h.state, { operationId: 'op-1', now: NOW + 2 * MIN, actor: ADMIN });
    expect(first.result.kind).toBe('renew');
    expect(first.result.confirmed).toBe(true);
    const after = first.state.subscriptions[0].paidUntil;
    expect(after).toBe(h.before + 30 * DAY);
    expect(pendingPayments(first.state)).toHaveLength(0);
    const applied = first.state.payments.filter((p: { operationId: string }) => p.operationId === 'op-1');
    expect(applied).toHaveLength(1);
    expect(applied[0].confirmedBy).toBe('admin');
    expect(first.state.audit[first.state.audit.length - 1].action).toBe('payment_confirm');

    const twice = confirmPendingPayment(first.state, { operationId: 'op-1', now: NOW + 3 * MIN, actor: ADMIN });
    expect(twice.result.error).toBe('already');
    expect(twice.state).toBe(first.state);

    const late = applyPayment(first.state, { operationId: 'op-1', label: h.label, amount: '150.00', currency: '643', now: NOW + 4 * MIN });
    expect(late.result.duplicate).toBe(true);
    expect(late.state.subscriptions[0].paidUntil).toBe(after);
    expect(confirmPendingPayment(first.state, { operationId: 'nope', now: NOW, actor: ADMIN }).result.error).toBe('not_found');
  });

  it('rejects without extending; YooMoney accepting it later still applies once', () => {
    const h = held();
    const out = rejectPendingPayment(h.state, { operationId: 'op-1', now: NOW + 2 * MIN, actor: ADMIN });
    expect(out.result.ok).toBe(true);
    expect(pendingPayments(out.state)).toHaveLength(0);
    expect(out.state.subscriptions[0].paidUntil).toBe(h.before);
    expect(rejectPendingPayment(out.state, { operationId: 'op-1', now: NOW, actor: ADMIN }).result.error).toBe('already');
    expect(confirmPendingPayment(out.state, { operationId: 'op-1', now: NOW, actor: ADMIN }).result.error).toBe('already');
    const accepted = applyPayment(out.state, { operationId: 'op-1', label: h.label, amount: '150.00', currency: '643', now: NOW + 5 * MIN });
    expect(accepted.result.kind).toBe('renew');
    const again = applyPayment(accepted.state, { operationId: 'op-1', label: h.label, amount: '150.00', currency: '643', now: NOW + 6 * MIN });
    expect(again.result.duplicate).toBe(true);
  });
});

describe('self-service device changes in the bot', () => {
  function chat(state: State, text: string, now: number, awaiting?: { kind: string }) {
    return botReply(state, { chatId: '42', text, now, awaiting: awaiting || null });
  }
  function press(state: State, data: string, now: number, chatId = '42') {
    return botCallback(state, { chatId, data, now });
  }
  /** callback_data of every inline button of a bot message. */
  function buttons(msg: { inline?: { inline_keyboard: { callback_data?: string }[][] } }): string[] {
    return ((msg.inline && msg.inline.inline_keyboard) || []).flat().map((b) => b.callback_data || '').filter(Boolean);
  }

  it('allows 2 changes per rolling 30 days through inline buttons, then says when the next one is possible', () => {
    const s = withDevice();
    // «Отвязать» from an old keyboard opens «Устройства».
    const list = chat(s.state, 'Отвязать', NOW);
    expect(list.messages[0].text).toContain('Смен устройства осталось: 2 из 2 за 30 дней.');
    expect(buttons(list.messages[0])).toContain('u1:' + s.codeId);
    expect(list.messages[0].await).toBeUndefined();
    const ask = press(list.state, 'u1:' + s.codeId, NOW);
    expect(ask.messages[0].text).toContain('Это 1 смена из 2 за 30 дней (останется 1).');
    const yes = 'y1:' + s.codeId + ':aaaaaaaa';
    expect(buttons(ask.messages[0])).toEqual([yes, 'ux']);
    // Asking changes nothing yet.
    expect(sessionOk(ask.state, { token: s.token, deviceId: DEV_A, now: NOW })).not.toBeNull();
    const one = press(ask.state, yes, NOW);
    expect(one.clearMarkup).toBe(true);
    expect(one.messages[0].text).toContain('Устройство 1 (aaaaaaaa…) отвязано');
    expect(one.messages[0].text).toContain('Смен устройства осталось: 1 из 2');
    expect(sessionOk(one.state, { token: s.token, deviceId: DEV_A, now: NOW })).toBeNull();
    // A second tap on the same «Да» is stale: nothing more is counted.
    const again = press(one.state, yes, NOW + MIN);
    expect(again.answer).toBe('Устройство уже отвязано или сменилось.');
    expect(swapStatus(again.state.subscriptions[0], NOW + MIN, 1).used).toBe(1);
    // The freed slot gets a new code, a new phone takes it.
    const b = bindAnother(one.state, s.subscriptionId, DEV_B, NOW + DAY);
    const two = press(b.state, 'y1:' + b.codeId + ':bbbbbbbb', NOW + DAY);
    expect(two.messages[0].text).toContain('Это была последняя смена на 30 дней: следующая - с 18.11.2026 12:00 МСК.');
    const c = bindAnother(two.state, s.subscriptionId, DEV_C, NOW + 2 * DAY);
    const third = chat(c.state, 'Устройства', NOW + 2 * DAY);
    expect(third.messages[0].text).toContain('Смены устройства на 30 дней исчерпаны: следующая - с 18.11.2026 12:00 МСК.');
    expect(buttons(third.messages[0]).filter((d) => d.indexOf('u1:') === 0)).toEqual([]);
    const tap = press(c.state, 'u1:' + c.codeId, NOW + 2 * DAY);
    expect(tap.messages[0].text).toBe(
      'Сменить устройство сейчас нельзя: самостоятельно - не больше 2 раз за 30 дней.\n' +
        'Следующая смена - с 18.11.2026 12:00 МСК.\n' +
        'Уже привязанные устройства работают. Если нужно срочно - напишите в «Поддержку».',
    );
    // Even a stale confirm button is refused, and the phone stays bound.
    const sneaky = press(c.state, 'y1:' + c.codeId + ':cccccccc', NOW + 2 * DAY);
    expect(sneaky.messages[0].text).toContain('Сменить устройство сейчас нельзя');
    expect(sessionOk(sneaky.state, { token: c.token, deviceId: DEV_C, now: NOW + 2 * DAY })).not.toBeNull();
    // 30 days after the first change one is possible again.
    const later = chat(c.state, 'Устройства', NOW + SWAP_WINDOW_MS + 1);
    expect(later.messages[0].text).toContain('Смен устройства осталось: 1 из 2');
  });

  it('ignores prefix text after the old «Отвязать» prompt', () => {
    const s = withDevice();
    const typed = chat(s.state, 'aaaa', NOW, { kind: 'unlink_device' });
    expect(typed.messages[0].text).toContain('Не понял');
    expect(sessionOk(typed.state, { token: s.token, deviceId: DEV_A, now: NOW })).not.toBeNull();
  });

  it('confirms «Отвязать все» with the change cost and refuses a stale or unknown button', () => {
    const s = withDevice();
    const b = bindAnother(s.state, s.subscriptionId, DEV_B, NOW);
    const list = chat(b.state, 'Устройства', NOW);
    expect(buttons(list.messages[0])).toContain('ua');
    const ask = press(list.state, 'ua', NOW);
    expect(ask.messages[0].text).toContain('Отвязать все устройства (2)? Они сразу перестанут работать.');
    expect(ask.messages[0].text).toContain('Это 2 смены из 2 за 30 дней (останется 0).');
    const yes = buttons(ask.messages[0])[0];
    expect(yes.indexOf('ya:')).toBe(0);
    // The set changed after the question (one phone replaced): the old «Да» is stale.
    const out = selfUnbind(ask.state, { accountId: s.accountId, deviceIds: [DEV_A], now: NOW });
    const c = bindAnother(out.state, s.subscriptionId, DEV_C, NOW + MIN);
    const stale = press(c.state, yes, NOW + MIN);
    expect(stale.answer).toBe('Список устройств изменился.');
    expect(stale.clearMarkup).toBe(true);
    expect(sessionOk(stale.state, { token: c.token, deviceId: DEV_C, now: NOW + MIN })).not.toBeNull();
    // Cancel and garbage only clear the buttons.
    expect(press(b.state, 'ux', NOW)).toMatchObject({ answer: 'Отменено', clearMarkup: true, messages: [] });
    expect(press(b.state, 'zz:1', NOW).answer).toBe('Кнопка устарела - откройте «Устройства» ещё раз.');
    // A chat without an account (never wrote to the bot) gets no change.
    expect(press(b.state, 'ua', NOW, '777').messages).toEqual([]);
    const done = press(ask.state, yes, NOW + MIN);
    expect(done.messages[0].text).toContain('Все устройства отвязаны (2)');
    expect(sessionOk(done.state, { token: b.token, deviceId: DEV_B, now: NOW + MIN })).toBeNull();
  });

  it('counts the swaps in the timeline and lets the admin reset the counter', () => {
    const s = withDevice();
    const b = bindAnother(s.state, s.subscriptionId, DEV_B, NOW);
    const used = selfUnbind(b.state, { accountId: s.accountId, deviceIds: [DEV_A, DEV_B], now: NOW });
    expect(used.result.ok).toBe(true);
    expect(used.result.left).toBe(0);
    const feed = adminDashboard(used.state, NOW + MIN).events.filter((e: { kind: string }) => e.kind === 'device');
    expect(feed).toHaveLength(2);
    const sub = used.state.subscriptions[0];
    expect(swapStatus(sub, NOW + MIN, 1).nextAt).toBe(NOW + SWAP_WINDOW_MS);
    const reset = resetSwaps(used.state, { accountId: s.accountId, now: NOW + 2 * MIN, actor: ADMIN });
    expect(reset.result.was).toBe(2);
    expect(swapStatus(reset.state.subscriptions[0], NOW + 3 * MIN, 1).left).toBe(2);
    expect(reset.state.audit[reset.state.audit.length - 1].action).toBe('swaps_reset');
    const card = userPayload(reset.state, s.accountId, {});
    expect(card.subscription.swaps.used).toBe(0);
  });

  it('refuses «все» when fewer changes are left than devices', () => {
    const s = withDevice();
    const b = bindAnother(s.state, s.subscriptionId, DEV_B, NOW);
    const one = selfUnbind(b.state, { accountId: s.accountId, deviceIds: [DEV_A], now: NOW });
    const c = bindAnother(one.state, s.subscriptionId, DEV_C, NOW + MIN);
    const all = press(c.state, 'ua', NOW + 2 * MIN);
    expect(all.messages[0].text).toContain('Отвязать все устройства (2) сейчас нельзя: смен устройства осталось: 1 из 2');
    expect(sessionOk(all.state, { token: b.token, deviceId: DEV_B, now: NOW + 3 * MIN })).not.toBeNull();
  });

  it('adds the next change date to «Код» when every slot is taken', () => {
    const s = withDevice();
    const b = bindAnother(s.state, s.subscriptionId, DEV_B, NOW);
    const used = selfUnbind(b.state, { accountId: s.accountId, deviceIds: [DEV_A, DEV_B], now: NOW });
    const x = bindAnother(used.state, s.subscriptionId, DEV_A, NOW + MIN);
    const y = bindAnother(x.state, s.subscriptionId, DEV_C, NOW + MIN);
    const code = chat(y.state, 'Код', NOW + 2 * MIN);
    expect(code.messages[0].text).toContain('Смены устройства на 30 дней исчерпаны: следующая - с 18.11.2026 12:00 МСК.');
  });
});

/* ---------- HTTP ---------- */

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

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      cookie: opts.cookie || '',
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = null;
  }
  return { status: res.status, data, body: res.body };
}

async function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'omp-devadm-')), 'billing.db');
  const s = withDevice(Date.now());
  s.state.settings.botToken = 'token';
  writeState(file, s.state);
  const sent: string[] = [];
  const fetchImpl = async (url: string, init?: { body?: string }) => {
    if (String(url).indexOf('sendMessage') >= 0) sent.push(String((init && init.body) || ''));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
  };
  const app = createApp(file, fetchImpl);
  return { file, app, sent, ...s };
}

/** Admin session the same way as the other tests: the one-time CLI login link (Telegram login is unchanged). */
async function adminCookie(app: (req: unknown, res: unknown) => Promise<void>, file: string) {
  const link = await updateState(file, (st: State) => issueCliAdminLogin(st, { now: Date.now() }));
  const res = mockRes();
  await app(
    {
      method: 'GET',
      url: '/admin/login/once?token=' + encodeURIComponent(link.token),
      headers: {},
      async *[Symbol.asyncIterator]() {},
    },
    res,
  );
  const cookie = String(res.headers['set-cookie'] || '');
  const home = await call(app, 'GET', '/admin/api/home', { cookie });
  return { cookie, csrf: String((home.data && home.data.csrf) || '') };
}

describe('admin http: devices and payments', () => {
  it('denies every new action without an admin session or with a wrong csrf', async () => {
    const t = await setup();
    const { cookie } = await adminCookie(t.app, t.file);
    const before = JSON.stringify(readState(t.file).subscriptions);
    const routes: [string, Record<string, unknown>][] = [
      ['/admin/device-revoke', { accountId: t.accountId, codeId: t.codeId, confirm: 'yes' }],
      ['/admin/limit', { accountId: t.accountId, limitOverride: 5, extraSlots: 3 }],
      ['/admin/bonus', { accountId: t.accountId, count: 2, days: '' }],
      ['/admin/bonus-remove', { accountId: t.accountId, bonusId: 'x', confirm: 'yes' }],
      ['/admin/subtract', { accountId: t.accountId, days: 5, confirm: 'yes' }],
      ['/admin/swaps-reset', { accountId: t.accountId }],
      ['/admin/payment-confirm', { operationId: 'op', confirm: 'yes' }],
      ['/admin/payment-reject', { operationId: 'op', confirm: 'yes' }],
    ];
    for (const [path, body] of routes) {
      const anon = await call(t.app, 'POST', path, { body: { ...body, csrf: 'x' } });
      expect(anon.status).toBe(403);
      const forged = await call(t.app, 'POST', path, { cookie, body: { ...body, csrf: 'wrong' } });
      expect(forged.status).toBe(403);
      const fake = await call(t.app, 'POST', path, { cookie: 'omp_admin=not-a-session', body: { ...body, csrf: 'x' } });
      expect(fake.status).toBe(403);
    }
    expect(JSON.stringify(readState(t.file).subscriptions)).toBe(before);
    expect(readState(t.file).codes.find((c: { id: string }) => c.id === t.codeId).deviceId).toBe(DEV_A);
    const user = await call(t.app, 'GET', '/admin/api/user?id=' + encodeURIComponent(t.accountId));
    expect(user.status).toBe(401);
  });

  it('records lastSeen on authenticated requests, throttled, and revoke kills the token', async () => {
    const t = await setup();
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    const auth = { authorization: 'Bearer ' + t.token, 'x-device-id': DEV_A, 'x-forwarded-for': '95.24.113.7' };
    const me = await call(t.app, 'GET', '/v1/me', { headers: auth });
    expect(me.status).toBe(200);
    const db = registryDb(t.file);
    const seen = () => activeRowForCode(db, t.codeId);
    const seen1 = seen();
    expect(seen1.last_seen_at).toBeGreaterThan(0);
    expect(seen1.last_ip_net).toBe('95.24.113.*');
    // Inside 10 minutes: nothing is written, even from another IP.
    await call(t.app, 'POST', '/v1/search', { headers: { ...auth, 'x-forwarded-for': '1.2.3.4' }, body: { q: 'x' } });
    expect(seen()).toMatchObject({ last_seen_at: seen1.last_seen_at, last_ip_net: '95.24.113.*' });
    // 11 minutes later the next authenticated request updates it.
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(Date.now() - 11 * MIN, seen1.id);
    await call(t.app, 'POST', '/v1/search', { headers: { ...auth, 'x-forwarded-for': '1.2.3.4' }, body: { q: 'x' } });
    const seen3 = seen();
    expect(seen3.last_ip_net).toBe('1.2.3.*');
    expect(Date.now() - seen3.last_seen_at).toBeLessThan(MIN);
    expect(JSON.stringify(readState(t.file))).not.toContain('1.2.3.4');
    // A bad token records nothing.
    db.prepare("UPDATE devices SET last_seen_at = 1, last_ip_net = '9.9.9.*' WHERE id = ?").run(seen1.id);
    await call(t.app, 'POST', '/v1/search', { headers: { ...auth, authorization: 'Bearer bad' }, body: { q: 'x' } });
    expect(seen().last_ip_net).toBe('9.9.9.*');

    const card = await call(t.app, 'GET', '/admin/api/user?id=' + encodeURIComponent(t.accountId), { cookie });
    expect(card.body).not.toContain('1.2.3.4');

    const noConfirm = await call(t.app, 'POST', '/admin/device-revoke', { cookie, body: { csrf, accountId: t.accountId, codeId: t.codeId } });
    expect((noConfirm.data as { ok?: boolean }).ok).toBe(false);
    expect(readState(t.file).codes.find((c: { id: string }) => c.id === t.codeId).deviceId).toBe(DEV_A);
    const listed = await call(t.app, 'GET', '/admin/api/user?id=' + encodeURIComponent(t.accountId), { cookie });
    const rows = (listed.data && (listed.data.devices as { id: string; codeId: string }[])) || [];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(seen1.id);
    // The panel revokes by registry row id.
    const revoked = await call(t.app, 'POST', '/admin/device-revoke', {
      cookie,
      body: { csrf, accountId: t.accountId, deviceRowId: rows[0].id, codeId: rows[0].codeId, confirm: 'yes' },
    });
    expect((revoked.data as { ok?: boolean }).ok).toBe(true);
    expect(db.prepare('SELECT status, revoke_reason FROM devices WHERE id = ?').get(seen1.id)).toMatchObject({ status: 'revoked', revoke_reason: 'admin' });
    expect(activeRowForCode(db, t.codeId)).toBeNull();
    const again = await call(t.app, 'POST', '/admin/device-revoke', {
      cookie,
      body: { csrf, accountId: t.accountId, deviceRowId: rows[0].id, confirm: 'yes' },
    });
    expect((again.data as { flash?: { error?: string } }).flash?.error).toBe('Устройство уже отвязано');
    expect((revoked.data as { flash?: { text?: string } }).flash?.text).toContain('Пользователю отправлено сообщение');
    const notice = t.sent.map((b) => JSON.parse(b)).find((b: { text: string }) => b.text.indexOf('отключено администратором') >= 0);
    expect(notice).toBeTruthy();
    expect(notice.chat_id).toBe('42');
    expect(notice.text).toBe(
      'Устройство aaaaaaaa… отключено администратором: поиск OMP на нём больше не работает.\n' +
        'Чтобы подключить устройство снова, нажмите «Код» и введите новый код в OMP. Вопросы - «Поддержка».',
    );
    expect(t.sent.filter((b) => b.indexOf('отключено администратором') >= 0)).toHaveLength(1);
    const search = await call(t.app, 'POST', '/v1/search', { headers: auth, body: { q: 'x' } });
    expect(search.status).toBe(403);
    const torrent = await call(t.app, 'POST', '/v1/torrent', { headers: auth, body: { link: 'x' } });
    expect(torrent.status).toBe(403);
    const audit = readState(t.file).audit;
    expect(audit[audit.length - 1]).toMatchObject({ action: 'device_revoke', accountId: t.accountId });
    const home = await call(t.app, 'GET', '/admin/api/home', { cookie });
    const events = (home.data && (home.data.events as { kind: string; text: string }[])) || [];
    expect(events.some((e) => e.kind === 'admin' && e.text.indexOf('Отозвано устройство') === 0)).toBe(true);
  });

  it('revokes a device of an account without Telegram and sends nothing', async () => {
    const t = await setup();
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    await updateState(t.file, (st: State) => ({
      state: { ...st, accounts: st.accounts.map((a: { id: string }) => (a.id === t.accountId ? { ...a, telegramId: '' } : a)) },
    }));
    t.sent.length = 0;
    const out = await call(t.app, 'POST', '/admin/device-revoke', { cookie, body: { csrf, accountId: t.accountId, codeId: t.codeId, confirm: 'yes' } });
    expect((out.data as { ok?: boolean }).ok).toBe(true);
    expect((out.data as { flash?: { text?: string } }).flash?.text).toContain('нет Telegram');
    expect(t.sent).toHaveLength(0);
  });

  it('confirms a held payment once over HTTP and tells the user once', async () => {
    const t = await setup();
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    const label = await updateState(t.file, (st: State) => {
      const q = quotePurchase(st, { kind: 'sub', accountId: t.accountId, subscriptionId: t.subscriptionId, now: Date.now() });
      const p = applyPayment(q.state, { operationId: 'op-h', label: q.result.label, amount: '150.00', currency: '643', unaccepted: true, now: Date.now() });
      return { state: p.state, result: q.result.label };
    });
    expect(label).toContain('buy:');
    const before = readState(t.file).subscriptions[0].paidUntil;
    const home = await call(t.app, 'GET', '/admin/api/home', { cookie });
    expect(((home.data && home.data.pending) as unknown[]).length).toBe(1);
    t.sent.length = 0;
    const first = await call(t.app, 'POST', '/admin/payment-confirm', { cookie, body: { csrf, operationId: 'op-h', confirm: 'yes' } });
    expect((first.data as { ok?: boolean }).ok).toBe(true);
    const second = await call(t.app, 'POST', '/admin/payment-confirm', { cookie, body: { csrf, operationId: 'op-h', confirm: 'yes' } });
    expect((second.data as { flash?: { error?: string } }).flash?.error).toBe('Платёж уже обработан');
    const after = readState(t.file);
    expect(after.subscriptions[0].paidUntil).toBe(before + 30 * DAY);
    expect(after.payments.filter((p: { operationId: string }) => p.operationId === 'op-h')).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain('Подписка продлена');
    const actions = after.audit.map((a: { action: string }) => a.action);
    expect(actions.filter((a: string) => a === 'payment_confirm')).toHaveLength(1);
  });

  it('changes the limit, subtracts days and resets swaps over HTTP, each in the journal', async () => {
    const t = await setup();
    const { cookie, csrf } = await adminCookie(t.app, t.file);
    const before = readState(t.file).subscriptions[0].paidUntil;
    const lim = await call(t.app, 'POST', '/admin/limit', { cookie, body: { csrf, accountId: t.accountId, limitOverride: '3', extraSlots: '0' } });
    expect((lim.data as { flash?: { text?: string } }).flash?.text).toBe('Лимит устройств: 3 (3 (индивидуальный лимит))');
    const sub1 = await call(t.app, 'POST', '/admin/subtract', { cookie, body: { csrf, accountId: t.accountId, days: '5' } });
    expect((sub1.data as { ok?: boolean }).ok).toBe(false);
    const sub2 = await call(t.app, 'POST', '/admin/subtract', { cookie, body: { csrf, accountId: t.accountId, days: '5', confirm: 'yes' } });
    expect((sub2.data as { ok?: boolean }).ok).toBe(true);
    const reset = await call(t.app, 'POST', '/admin/swaps-reset', { cookie, body: { csrf, accountId: t.accountId } });
    expect((reset.data as { ok?: boolean }).ok).toBe(true);
    const st = readState(t.file);
    expect(st.subscriptions[0].limitOverride).toBe(3);
    expect(st.subscriptions[0].paidUntil).toBe(before - 5 * DAY);
    const acts = st.audit.filter((a: { accountId?: string }) => a.accountId === t.accountId).map((a: { action: string }) => a.action);
    expect(acts).toEqual(['limit_set', 'days_subtract', 'swaps_reset']);
  });
});
