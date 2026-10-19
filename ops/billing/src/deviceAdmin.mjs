/**
 * Admin tools for one subscription (PR-3 «Админка: устройства») and the bot's limit on
 * self-service device changes. Pure functions over the billing state, like logic.mjs.
 */
import {
  activeExtras,
  applyPayment,
  deviceLimitNow,
  findAccount,
  logAudit,
  mainSubscription,
  mskDate,
  telegramDisplay,
  truncateIp,
  unbindCode,
} from './logic.mjs';

const DAY = 24 * 60 * 60 * 1000;

/** lastSeen / lastIp of a device are written at most this often (registry row, src/registry.mjs). */
export const SEEN_EVERY_MS = 10 * 60 * 1000;

/** Self-service device changes in the bot («Отвязать», then «Код» for the freed slot). */
export const SWAP_LIMIT = 2;
export const SWAP_WINDOW_MS = 30 * DAY;
const SWAP_CAP = 20;

/** Bounds for the admin limit form. */
export const LIMIT_MAX = 20;
export const SUBTRACT_MAX_DAYS = 3650;

function intIn(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) return null;
  return n;
}

/** «95.24.113.*» / «2a02:6b8:c0e::*». Stored this way already; also safe on an older full address. */
export function maskIp(ip) {
  return truncateIp(ip);
}

function codeById(state, codeId) {
  return (state.codes || []).find((c) => c.id === codeId) || null;
}

function subOf(state, accountId) {
  return accountId ? mainSubscription(state, accountId) : null;
}

function replaceSub(state, sub) {
  return { ...state, subscriptions: state.subscriptions.map((s) => (s.id === sub.id ? sub : s)) };
}

function who(state, accountId) {
  const acc = findAccount(state, accountId);
  return acc ? telegramDisplay(acc) || acc.email || acc.id : accountId;
}

function audited(state, actor, action, detail, accountId, now) {
  return logAudit(state, { action, detail, now, actor, accountId });
}

/* ---------- self-service device changes (bot) ---------- */

function countedSwaps(sub, now) {
  const resetAt = Number(sub && sub.swapsResetAt) || 0;
  return ((sub && sub.swaps) || [])
    .map((s) => Number(s && s.at) || 0)
    .filter((at) => at > now - SWAP_WINDOW_MS && at > resetAt && at <= now)
    .sort((a, b) => a - b);
}

/**
 * Changes used in the rolling window, how many are left, and when `need` more become possible
 * (0 when they are possible now).
 */
export function swapStatus(sub, now, need) {
  const want = Math.max(1, Math.floor(Number(need) || 1));
  const list = countedSwaps(sub, now);
  const used = list.length;
  const left = Math.max(0, SWAP_LIMIT - used);
  let nextAt = 0;
  if (want > SWAP_LIMIT) nextAt = Infinity;
  else if (left < want) nextAt = list[used - SWAP_LIMIT + want - 1] + SWAP_WINDOW_MS;
  return { used, left, limit: SWAP_LIMIT, nextAt, resetAt: Number(sub && sub.swapsResetAt) || 0 };
}

/**
 * Bot «Отвязать»: unbind these devices of the account and count one change per device.
 * Refused as a whole with `swap_limit` when fewer changes are left than devices asked.
 */
export function selfUnbind(state, { accountId, deviceIds, now }) {
  const sub = subOf(state, accountId);
  const ids = (deviceIds || []).filter(Boolean);
  if (!sub || !ids.length) return { state, result: { error: 'not_found' } };
  const status = swapStatus(sub, now, ids.length);
  if (status.left < ids.length) return { state, result: { error: 'swap_limit', ...status, need: ids.length } };
  let next = state;
  const mine = (deviceId) =>
    next.codes.filter((c) => {
      if (c.deviceId !== deviceId || c.revoked) return false;
      const own = next.subscriptions.find((s) => s.id === c.subscriptionId);
      return own && own.accountId === accountId;
    });
  const swaps = (sub.swaps || []).slice();
  let unbound = 0;
  for (let i = 0; i < ids.length; i++) {
    const rows = mine(ids[i]);
    if (!rows.length) continue;
    for (let r = 0; r < rows.length; r++) next = unbindCode(next, rows[r].id);
    swaps.push({ at: now, device: String(ids[i]).slice(0, 8) });
    unbound += 1;
  }
  if (!unbound) return { state, result: { error: 'not_found' } };
  const cur = next.subscriptions.find((s) => s.id === sub.id);
  next = replaceSub(next, { ...cur, swaps: swaps.slice(-SWAP_CAP) });
  const after = swapStatus(next.subscriptions.find((s) => s.id === sub.id), now, 1);
  return { state: next, result: { ok: true, unbound, ...after } };
}

/** Admin: start counting self-service changes from now. */
export function resetSwaps(state, { accountId, now, actor }) {
  const sub = subOf(state, accountId);
  if (!sub) return { state, result: { error: 'no_subscription' } };
  const before = swapStatus(sub, now, 1);
  const next = replaceSub(state, { ...sub, swapsResetAt: now });
  return {
    state: audited(next, actor, 'swaps_reset', 'Сброшен счётчик смен устройства (было ' + before.used + ' из ' + SWAP_LIMIT + ')', accountId, now),
    result: { ok: true, was: before.used },
  };
}

/* ---------- devices ---------- */

/** Admin «Отозвать»: unbind the device and drop its session token. The slot gets a fresh code. */
export function revokeDevice(state, { accountId, codeId, now, actor }) {
  const sub = subOf(state, accountId);
  const row = codeById(state, codeId);
  const ownSub = row ? state.subscriptions.find((s) => s.id === row.subscriptionId) : null;
  if (!sub || !row || row.revoked || !ownSub || ownSub.accountId !== accountId) return { state, result: { error: 'not_found' } };
  if (!row.deviceId) return { state, result: { error: 'not_bound' } };
  const device = row.deviceId.slice(0, 8);
  const next = unbindCode(state, codeId);
  return {
    state: audited(next, actor, 'device_revoke', 'Отозвано устройство ' + device + '… (' + who(state, accountId) + ')', accountId, now),
    result: { ok: true, device, telegramId: (findAccount(state, accountId) || {}).telegramId || '' },
  };
}

/**
 * The registry saw a rotated refresh token used again (two holders of one device key, or a phone
 * restored from a backup). Journal and feed only: nothing is unbound and the user is not told;
 * the admin sees the mark in the device list and can revoke by hand.
 */
export function cloneMark(state, { codeId, now }) {
  const row = codeById(state, codeId);
  if (!row || row.revoked || !row.deviceId) return { state, result: { error: 'not_bound' } };
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  const accountId = sub ? sub.accountId : '';
  const device = row.deviceId.slice(0, 8);
  return {
    state: audited(
      state,
      { kind: 'system', id: 'tokens', label: 'Защита от клонов' },
      'device_clone',
      'Подозрение на клон: ключ устройства ' + device + '… использован повторно (' + who(state, accountId) + ')',
      accountId,
      now,
    ),
    result: { ok: true, device, accountId },
  };
}

/** Telegram notice to the owner after an admin revoked one of their devices. */
export function revokeNoticeText(device) {
  return (
    'Устройство ' +
    device +
    '… отключено администратором: поиск OMP на нём больше не работает.\n' +
    'Чтобы подключить устройство снова, нажмите «Код» и введите новый код в OMP. Вопросы — «Поддержка».'
  );
}

/** «2» or «2 + 1 доп.» */
function limitText(base, extras) {
  return extras > 0 ? base + ' + ' + extras + ' доп.' : String(base);
}

/**
 * Admin limit form. `deviceLimit` is the included devices (1–LIMIT_MAX); `extraSlots` the monthly
 * extra slots (0–LIMIT_MAX). Extra slots set here run until paidUntil, like bought ones.
 * Lowering the limit does not unbind anything: the newest devices over it stop working.
 */
export function setDeviceLimit(state, { accountId, deviceLimit, extraSlots, now, actor }) {
  const sub = subOf(state, accountId);
  if (!sub) return { state, result: { error: 'no_subscription' } };
  const base = intIn(deviceLimit, 1, LIMIT_MAX);
  const extra = extraSlots === undefined || extraSlots === '' ? activeExtras(state, sub, now) : intIn(extraSlots, 0, LIMIT_MAX);
  if (base === null || extra === null) return { state, result: { error: 'bad_args' } };
  const oldBase = Number(sub.deviceLimit) || 0;
  const oldExtra = activeExtras(state, sub, now);
  if (base === oldBase && extra === oldExtra) return { state, result: { ok: true, unchanged: true, deviceLimit: base, extraSlots: extra } };
  const next = { ...sub, deviceLimit: base };
  if (extra !== oldExtra) {
    next.extraSlots = extra;
    next.extraUntil = extra > 0 ? Math.max(Number(sub.extraUntil) || 0, Number(sub.paidUntil) || 0) : 0;
  }
  const changed = replaceSub(state, next);
  const detail = 'Лимит устройств ' + limitText(oldBase, oldExtra) + ' → ' + limitText(base, extra) + ' (' + who(state, accountId) + ')';
  return {
    state: audited(changed, actor, 'limit_set', detail, accountId, now),
    result: { ok: true, deviceLimit: base, extraSlots: extra, total: deviceLimitNow(changed, next, now) },
  };
}

/**
 * Admin «Убавить дни»: paidUntil moves back by `days` (it may end up in the past, which ends access
 * after the grace period). Extra slots that ran past the new date are cut to it.
 */
export function subtractDays(state, { accountId, days, now, actor }) {
  const sub = subOf(state, accountId);
  if (!sub) return { state, result: { error: 'no_subscription' } };
  const n = intIn(days, 1, SUBTRACT_MAX_DAYS);
  if (n === null) return { state, result: { error: 'bad_args' } };
  const paidUntil = (Number(sub.paidUntil) || 0) - n * DAY;
  const next = { ...sub, paidUntil };
  if ((Number(sub.extraUntil) || 0) > paidUntil) next.extraUntil = paidUntil;
  const changed = replaceSub(state, next);
  const detail = 'Убавлено ' + n + ' дн.: подписка до ' + mskDate(paidUntil) + ' (было ' + mskDate(sub.paidUntil) + ', ' + who(state, accountId) + ')';
  return { state: audited(changed, actor, 'days_subtract', detail, accountId, now), result: { ok: true, days: n, paidUntil } };
}

/* ---------- held YooMoney payments ---------- */

function purposeOf(state, label) {
  const mark = String(label || '');
  if (mark.indexOf('buy:') === 0) {
    const quote = (state.purchases || []).find((p) => p.id === mark.slice(4));
    if (!quote) return { kind: '', price: 0, accountId: '' };
    let accountId = quote.accountId || '';
    if (!accountId) {
      const sub = state.subscriptions.find((s) => s.id === quote.subscriptionId);
      accountId = sub ? sub.accountId : '';
    }
    return { kind: quote.kind || '', price: Number(quote.price) || 0, accountId };
  }
  const kind = mark.split(':')[0];
  return { kind: kind === 'new' || kind === 'sub' || kind === 'dev' ? kind : '', price: 0, accountId: '' };
}

/** Payments YooMoney still holds (`unaccepted`), newest first. `accountId` limits to one account. */
export function pendingPayments(state, accountId) {
  return (state.payments || [])
    .filter((p) => p && p.pending)
    .map((p) => {
      const purpose = purposeOf(state, p.label);
      const owner = p.accountId || purpose.accountId || '';
      return {
        operationId: String(p.operationId || ''),
        amount: String(p.amount || ''),
        at: Number(p.at) || 0,
        label: String(p.label || ''),
        kind: purpose.kind,
        price: purpose.price,
        accountId: owner,
        who: owner ? who(state, owner) : '',
      };
    })
    .filter((p) => !accountId || p.accountId === accountId)
    .sort((a, b) => b.at - a.at);
}

function heldRow(state, operationId) {
  const id = String(operationId || '');
  if (!id) return null;
  return (state.payments || []).find((p) => p && p.pending && String(p.operationId) === id) || null;
}

function settledError(state, operationId) {
  const id = String(operationId || '');
  const seen = id && (state.payments || []).some((p) => p && String(p.operationId) === id);
  return seen ? 'already' : 'not_found';
}

/**
 * «Подтвердить платёж»: apply a held payment exactly once, as if YooMoney sent it accepted.
 * A second click, or the accepted notice from YooMoney afterwards, finds no held row and changes nothing.
 */
export function confirmPendingPayment(state, { operationId, now, actor }) {
  const row = heldRow(state, operationId);
  if (!row) return { state, result: { error: settledError(state, operationId) } };
  const applied = applyPayment(state, {
    operationId: row.operationId,
    label: row.label,
    amount: row.amount,
    currency: row.currency || '643',
    unaccepted: false,
    now,
  });
  const idx = applied.state.payments.map((p) => String(p.operationId)).lastIndexOf(String(row.operationId));
  const payments = applied.state.payments.map((p, i) => (i === idx ? { ...p, confirmedBy: 'admin', heldAt: Number(row.at) || 0 } : p));
  const accountId = (payments[idx] && payments[idx].accountId) || row.accountId || '';
  const outcome = applied.result && applied.result.error ? ' — не применён: ' + applied.result.error : '';
  const detail = 'Платёж подтверждён вручную: ' + (row.amount || '?') + ' ₽' + outcome + (accountId ? ' (' + who(state, accountId) + ')' : '');
  return {
    state: audited({ ...applied.state, payments }, actor, 'payment_confirm', detail, accountId, now),
    result: { ...(applied.result || {}), confirmed: !(applied.result && applied.result.error), accountId },
  };
}

/** «Отклонить»: drop a held payment from the queue. An accepted notice later still applies it. */
export function rejectPendingPayment(state, { operationId, now, actor }) {
  const row = heldRow(state, operationId);
  if (!row) return { state, result: { error: settledError(state, operationId) } };
  let done = false;
  const payments = state.payments.map((p) => {
    if (done || p !== row) return p;
    done = true;
    return { ...p, pending: false, error: 'rejected', rejectedAt: now };
  });
  const accountId = row.accountId || purposeOf(state, row.label).accountId || '';
  const detail = 'Платёж отклонён: ' + (row.amount || '?') + ' ₽' + (accountId ? ' (' + who(state, accountId) + ')' : '');
  return { state: audited({ ...state, payments }, actor, 'payment_reject', detail, accountId, now), result: { ok: true, accountId } };
}
