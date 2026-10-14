import { codeHash, deviceOk, normalizeCode, randomCode, randomId, sha256 } from './crypto.mjs';

const DAY = 24 * 60 * 60 * 1000;
const ATTEMPT_CAP = 200;

function fail(error, state) {
  return { state, result: { error } };
}

function attempt(state, row) {
  const attempts = state.attempts.concat([row]).slice(-ATTEMPT_CAP);
  return { ...state, attempts };
}

export function findAccount(state, id) {
  return state.accounts.find((a) => a.id === id) || null;
}

export function accountByTelegram(state, telegramId) {
  const id = String(telegramId || '');
  return state.accounts.find((a) => a.telegramId === id) || null;
}

export function ensureTelegramAccount(state, telegramId, now) {
  const existing = accountByTelegram(state, telegramId);
  if (existing) return { state, account: existing };
  const account = { id: randomId(), email: '', telegramId: String(telegramId), createdAt: now };
  return { state: { ...state, accounts: state.accounts.concat([account]) }, account };
}

function liveSub(state, accountId, now) {
  return (
    state.subscriptions.find((s) => s.accountId === accountId && s.product === 'jackett' && s.paidUntil > now) || null
  );
}

function anySub(state, accountId) {
  const list = state.subscriptions.filter((s) => s.accountId === accountId && s.product === 'jackett');
  return list.length ? list[list.length - 1] : null;
}

function issue(state, subscriptionId, now) {
  const plain = randomCode();
  const row = {
    id: randomId(),
    subscriptionId,
    hash: codeHash(plain),
    deviceId: '',
    boundAt: 0,
    createdAt: now,
    revoked: false,
  };
  return { state: { ...state, codes: state.codes.concat([row]) }, code: plain, codeId: row.id };
}

export function createSubscription(state, { accountId, now, days }) {
  const period = days || state.settings.periodDays || 30;
  const sub = {
    id: randomId(),
    accountId,
    product: 'jackett',
    paidUntil: now + period * DAY,
    deviceLimit: 1,
    createdAt: now,
  };
  const issued = issue({ ...state, subscriptions: state.subscriptions.concat([sub]) }, sub.id, now);
  return { state: issued.state, result: { subscriptionId: sub.id, code: issued.code, paidUntil: sub.paidUntil } };
}

export function activate(state, { code, deviceId, now }) {
  if (!deviceOk(deviceId) || normalizeCode(code).length !== 8) return fail('bad_code', state);
  const hash = codeHash(code);
  const row = state.codes.find((c) => c.hash === hash && !c.revoked);
  if (!row) return fail('bad_code', attempt(state, { at: now, hash, deviceId, ok: false, reason: 'bad_code' }));
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  if (!sub || sub.paidUntil <= now) {
    return fail('expired', attempt(state, { at: now, hash, deviceId, ok: false, reason: 'expired' }));
  }
  if (row.deviceId && row.deviceId !== deviceId) {
    return fail('other_device', attempt(state, { at: now, hash, deviceId, ok: false, reason: 'other_device' }));
  }
  const codes = state.codes.map((c) => (c.id === row.id && !c.deviceId ? { ...c, deviceId, boundAt: now } : c));
  const token = randomId() + randomId();
  const sessions = state.sessions.filter((s) => s.codeId !== row.id).concat([{ codeId: row.id, hash: sha256(token), createdAt: now }]);
  const next = attempt({ ...state, codes, sessions }, { at: now, hash, deviceId, ok: true, reason: 'ok' });
  return { state: next, result: { token, paidUntil: sub.paidUntil, codeId: row.id } };
}

export function sessionOk(state, { token, deviceId, now }) {
  if (!token || !deviceOk(deviceId)) return null;
  const hash = sha256(token);
  const session = state.sessions.find((s) => s.hash === hash);
  if (!session) return null;
  const row = state.codes.find((c) => c.id === session.codeId && !c.revoked);
  if (!row || row.deviceId !== deviceId) return null;
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  if (!sub || sub.paidUntil <= now) return null;
  return { code: row, subscription: sub };
}

function seenPayment(state, operationId) {
  return state.payments.some((p) => p.operationId === operationId);
}

export function applyPayment(state, { operationId, label, amount, now }) {
  if (!operationId || seenPayment(state, operationId)) return { state, result: { duplicate: true } };
  const payments = state.payments.concat([{ operationId, label, amount, at: now }]);
  const base = { ...state, payments };
  const mark = String(label || '');
  const days = state.settings.periodDays || 30;
  if (mark.indexOf('sub:') === 0) {
    const id = mark.slice(4);
    const subscriptions = base.subscriptions.map((s) => {
      if (s.id !== id) return s;
      const from = Math.max(s.paidUntil, now);
      return { ...s, paidUntil: from + days * DAY };
    });
    const sub = subscriptions.find((s) => s.id === id);
    return { state: { ...base, subscriptions }, result: { kind: 'renew', subscriptionId: id, paidUntil: sub ? sub.paidUntil : 0 } };
  }
  if (mark.indexOf('dev:') === 0) {
    const id = mark.slice(4);
    const subscriptions = base.subscriptions.map((s) => (s.id === id ? { ...s, deviceLimit: s.deviceLimit + 1 } : s));
    const issued = issue({ ...base, subscriptions }, id, now);
    return { state: issued.state, result: { kind: 'device', subscriptionId: id, code: issued.code } };
  }
  if (mark.indexOf('new:') === 0) {
    const accountId = mark.slice(4);
    if (!findAccount(base, accountId)) return { state: base, result: { error: 'bad_label' } };
    const existing = anySub(base, accountId);
    if (existing) {
      const subscriptions = base.subscriptions.map((s) => {
        if (s.id !== existing.id) return s;
        const from = Math.max(s.paidUntil, now);
        return { ...s, paidUntil: from + days * DAY };
      });
      const sub = subscriptions.find((s) => s.id === existing.id);
      return { state: { ...base, subscriptions }, result: { kind: 'renew', subscriptionId: existing.id, paidUntil: sub.paidUntil } };
    }
    const created = createSubscription(base, { accountId, now, days });
    return { state: created.state, result: { kind: 'new', ...created.result } };
  }
  return { state: base, result: { error: 'bad_label' } };
}

export function openAccount(state, { email, telegramId, now }) {
  const mail = String(email || '').trim().toLowerCase();
  const tg = String(telegramId || '').trim();
  let account = tg ? accountByTelegram(state, tg) : null;
  if (!account && mail) account = state.accounts.find((a) => a.email === mail) || null;
  if (account) {
    const accounts = state.accounts.map((a) => (a.id === account.id ? { ...a, email: a.email || mail, telegramId: a.telegramId || tg } : a));
    const next = accounts.find((a) => a.id === account.id);
    return { state: { ...state, accounts }, account: next };
  }
  account = { id: randomId(), email: mail, telegramId: tg, createdAt: now };
  return { state: { ...state, accounts: state.accounts.concat([account]) }, account };
}

export function unbindCode(state, codeId) {
  return {
    ...state,
    codes: state.codes.map((c) => (c.id === codeId ? { ...c, deviceId: '', boundAt: 0 } : c)),
    sessions: state.sessions.filter((s) => s.codeId !== codeId),
  };
}

export function revokeCode(state, codeId) {
  return {
    ...state,
    codes: state.codes.map((c) => (c.id === codeId ? { ...c, revoked: true } : c)),
    sessions: state.sessions.filter((s) => s.codeId !== codeId),
  };
}

export function subscriptionView(state, accountId, now) {
  const sub = anySub(state, accountId);
  if (!sub) return null;
  const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
  return {
    id: sub.id,
    paidUntil: sub.paidUntil,
    active: sub.paidUntil > now,
    deviceLimit: sub.deviceLimit,
    devices: codes.map((c) => ({ id: c.id, bound: !!c.deviceId, deviceId: c.deviceId, boundAt: c.boundAt })),
  };
}

export function priceText(settings) {
  const days = settings.periodDays || 30;
  const price = Number(settings.priceRub) || 0;
  const extra = Number(settings.extraDeviceRub) || 0;
  return { days, price, extra };
}

export { liveSub };
