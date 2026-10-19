import { codeHash, deviceOk, normalizeCode, randomCode, randomId, sha256 } from './crypto.mjs';

const DAY = 24 * 60 * 60 * 1000;
const ATTEMPT_CAP = 200;

/** Devices included in a base subscription (phone + second phone). Extra paid slots add to it. */
export const DEVICE_BASE = 2;

/** Days of access after paidUntil while the user renews. `settings.graceDays` overrides it (0–30). */
export const GRACE_DAYS_DEFAULT = 3;

/** Moscow has no DST since 2014: calendar days and reminder hours use a fixed UTC+3. */
const MSK_OFFSET = 3 * 60 * 60 * 1000;

function fail(error, state) {
  return { state, result: { error } };
}

function attempt(state, row) {
  const attempts = state.attempts.concat([row]).slice(-ATTEMPT_CAP);
  return { ...state, attempts };
}

/** Account behind an activation attempt: the code that was tried, else the device's current link. */
function accountIdForAttempt(state, row) {
  if (row && row.accountId) return String(row.accountId);
  const hash = row && row.hash ? String(row.hash) : '';
  if (hash) {
    const code = (state.codes || []).find((c) => c.hash === hash);
    if (code) {
      const sub = (state.subscriptions || []).find((s) => s.id === code.subscriptionId);
      if (sub && sub.accountId) return String(sub.accountId);
    }
  }
  const deviceId = row && row.deviceId ? String(row.deviceId) : '';
  if (!deviceId) return '';
  const linked = accountByDevice(state, deviceId);
  return linked ? linked.id : '';
}

function recordAttempt(state, row) {
  const accountId = accountIdForAttempt(state, row);
  const next = { ...row, at: row.at || Date.now() };
  if (accountId) next.accountId = accountId;
  return attempt(state, next);
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

/** @username and display name next to the numeric Telegram id. */
export function telegramDisplay(account) {
  if (!account) return '';
  const nick = account.telegramUsername ? '@' + String(account.telegramUsername).replace(/^@/, '') : '';
  const name = !nick && account.telegramName ? String(account.telegramName) : '';
  const id = account.telegramId || '';
  const human = nick || name;
  if (human && id) return human + ' · ' + id;
  return human || id || account.email || account.id || '';
}

/** Store the Telegram @username / name seen on a message or getChat. Empty username clears a removed nick. */
export function rememberTelegramProfile(state, { telegramId, username, name }, now) {
  const id = String(telegramId || '').trim();
  if (!id) return { state, account: null };
  const ensured = ensureTelegramAccount(state, id, now || Date.now());
  const nick = String(username || '')
    .replace(/^@/, '')
    .trim()
    .slice(0, 64);
  const label = String(name || '')
    .trim()
    .slice(0, 80);
  const prev = ensured.account;
  if ((prev.telegramUsername || '') === nick && (prev.telegramName || '') === label) return ensured;
  const account = { ...prev, telegramUsername: nick, telegramName: label };
  const accounts = ensured.state.accounts.map((a) => (a.id === account.id ? account : a));
  return { state: { ...ensured.state, accounts }, account };
}

function liveSub(state, accountId, now) {
  return (
    state.subscriptions.find((s) => s.accountId === accountId && s.product === 'jackett' && s.paidUntil > now) || null
  );
}

/** Grace period in days from settings: a number 0–30, default GRACE_DAYS_DEFAULT. */
export function graceDays(settings) {
  const raw = settings ? settings.graceDays : undefined;
  if (raw === undefined || raw === null || raw === '') return GRACE_DAYS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return GRACE_DAYS_DEFAULT;
  return Math.min(30, Math.floor(n));
}

function graceMs(state) {
  return graceDays(state && state.settings) * DAY;
}

/** End of access for `sub`: paidUntil plus the grace period. */
export function accessUntil(state, sub) {
  return sub ? (Number(sub.paidUntil) || 0) + graceMs(state) : 0;
}

/** paid: before paidUntil; grace: after it but inside the grace period; access: either. */
export function subAccess(state, sub, now) {
  if (!sub) return { paid: false, grace: false, access: false, accessUntil: 0 };
  const until = accessUntil(state, sub);
  const paid = sub.paidUntil > now;
  const grace = !paid && now < until;
  return { paid, grace, access: paid || grace, accessUntil: until };
}

/**
 * Monthly extra slots that still count at `now`. They are paid until `extraUntil` (normally the same
 * date as paidUntil) and get the same grace period as the subscription.
 */
export function activeExtras(state, sub, now) {
  if (!sub) return 0;
  const n = Math.max(0, Math.floor(Number(sub.extraSlots) || 0));
  if (!n) return 0;
  return now < (Number(sub.extraUntil) || 0) + graceMs(state) ? n : 0;
}

/** Devices allowed at `now`: the included ones (deviceLimit) plus extra slots that have not lapsed. */
export function deviceLimitNow(state, sub, now) {
  if (!sub) return 0;
  return (Number(sub.deviceLimit) || 0) + activeExtras(state, sub, now === undefined ? Date.now() : now);
}

/** Bound codes of a subscription, oldest binding first. The newest ones are the ones over a lowered limit. */
function boundCodes(state, subscriptionId) {
  return (state.codes || [])
    .filter((c) => c.subscriptionId === subscriptionId && !c.revoked && c.deviceId)
    .slice()
    .sort((a, b) => (Number(a.boundAt) || 0) - (Number(b.boundAt) || 0) || String(a.id).localeCompare(String(b.id)));
}

/**
 * True when this bound code is inside the device limit at `now`. When an extra slot lapses,
 * the most recently bound devices over the limit stop getting access; their binding is kept,
 * so renewing the slot brings them back without a new code.
 */
export function codeWithinLimit(state, sub, codeRow, now) {
  if (!sub || !codeRow) return false;
  const list = boundCodes(state, sub.id);
  const idx = list.findIndex((c) => c.id === codeRow.id);
  if (idx < 0) return true;
  return idx < deviceLimitNow(state, sub, now);
}

/**
 * Access of one phone by its device id (for /v1/me without a token).
 * `overLimit` is set when the phone is bound but sits over the current device limit.
 */
export function deviceAccess(state, deviceId, now) {
  if (!deviceOk(deviceId)) return null;
  const row = (state.codes || []).find((c) => c.deviceId === deviceId && !c.revoked);
  if (!row) return null;
  const sub = (state.subscriptions || []).find((s) => s.id === row.subscriptionId);
  if (!sub) return null;
  return { subscription: sub, code: row, overLimit: !codeWithinLimit(state, sub, row, now) };
}

function anySub(state, accountId) {
  const list = state.subscriptions.filter((s) => s.accountId === accountId && s.product === 'jackett');
  if (!list.length) return null;
  // The real subscription is the one that lasts longest. A later short code must not hide it.
  return list.reduce((best, s) => (s.paidUntil > best.paidUntil ? s : best));
}

/** Codes bound to a device on this subscription (not revoked). */
export function boundDevices(state, subscriptionId) {
  return (state.codes || []).filter((c) => c.subscriptionId === subscriptionId && !c.revoked && c.deviceId).length;
}

/** True when the subscription already has as many bound devices as it allows at `now`. */
export function deviceLimitReached(state, sub, now) {
  if (!sub) return true;
  return boundDevices(state, sub.id) >= deviceLimitNow(state, sub, now);
}

/**
 * Activation code for one more device on `sub`, within deviceLimit.
 * An unbound code that is still showable is handed out again instead of minting a new slot.
 * When every allowed device is bound, no code is created and `limit` is true.
 */
function slotCode(state, sub, now) {
  const free = (state.codes || []).find((c) => c.subscriptionId === sub.id && !c.revoked && !c.deviceId && c.plain);
  if (free) return { state, code: free.plain, codeId: free.id, reused: true, limit: false };
  if (deviceLimitReached(state, sub, now)) return { state, code: '', codeId: '', reused: false, limit: true };
  const issued = issue(state, sub.id, now);
  return { state: issued.state, code: issued.code, codeId: issued.codeId, reused: false, limit: false };
}

/** Bot «Код»: a free code of this subscription, or a new one within deviceLimit. `limit` when none is allowed. */
export function deviceCode(state, subscriptionId, now) {
  const sub = (state.subscriptions || []).find((s) => s.id === subscriptionId);
  if (!sub) return { state, code: '', codeId: '', reused: false, limit: true };
  return slotCode(state, sub, now);
}

/**
 * One-time move to DEVICE_BASE devices per subscription. Subscriptions stored under the old base of 1
 * get the difference added, so a bought extra slot is kept. `meta.deviceBase` makes it run once.
 */
export function migrateDeviceBase(state) {
  if (!state || typeof state !== 'object') return state;
  const meta = state.meta && typeof state.meta === 'object' && !Array.isArray(state.meta) ? state.meta : {};
  const from = Number(meta.deviceBase) || 1;
  if (from >= DEVICE_BASE) return state.meta === meta ? state : { ...state, meta };
  const add = DEVICE_BASE - from;
  const subscriptions = (state.subscriptions || []).map((s) =>
    s && typeof s === 'object' ? { ...s, deviceLimit: Math.max(DEVICE_BASE, (Number(s.deviceLimit) || 1) + add) } : s,
  );
  return { ...state, subscriptions, meta: { ...meta, deviceBase: DEVICE_BASE } };
}

/**
 * One-time move from lifetime extra devices to monthly extra slots. Everything above DEVICE_BASE
 * in deviceLimit becomes `extraSlots`, valid until the current paidUntil (then renewed with the
 * subscription). `meta.extraMonthly` makes it run once. Runs after migrateDeviceBase.
 */
export function migrateExtraSlots(state) {
  if (!state || typeof state !== 'object') return state;
  const meta = state.meta && typeof state.meta === 'object' && !Array.isArray(state.meta) ? state.meta : {};
  if (Number(meta.extraMonthly) >= 1) return state;
  const subscriptions = (state.subscriptions || []).map((s) => {
    if (!s || typeof s !== 'object') return s;
    const limit = Number(s.deviceLimit) || DEVICE_BASE;
    const extra = Math.max(0, limit - DEVICE_BASE) + Math.max(0, Math.floor(Number(s.extraSlots) || 0));
    if (limit <= DEVICE_BASE && !extra) return s;
    return {
      ...s,
      deviceLimit: Math.min(limit, DEVICE_BASE),
      extraSlots: extra,
      extraUntil: Math.max(Number(s.extraUntil) || 0, Number(s.paidUntil) || 0),
    };
  });
  return { ...state, subscriptions, meta: { ...meta, extraMonthly: 1 } };
}

function issue(state, subscriptionId, now) {
  const plain = randomCode();
  const row = {
    id: randomId(),
    subscriptionId,
    hash: codeHash(plain),
    /** Kept until the code is bound so the bot can show / deep-link it again. */
    plain,
    deviceId: '',
    boundAt: 0,
    createdAt: now,
    revoked: false,
  };
  return { state: { ...state, codes: state.codes.concat([row]) }, code: plain, codeId: row.id };
}

/** XXXX-XXXX from a normalized or dashed code. */
export function formatCode(code) {
  const n = normalizeCode(code);
  if (n.length !== 8) return String(code || '');
  return n.slice(0, 4) + '-' + n.slice(4);
}

/** Custom scheme that opens OMP and fills the subscription code. */
export function appSchemeUrl(code) {
  return 'omp://billing?code=' + encodeURIComponent(formatCode(code));
}

/** HTTPS page that redirects into the app (Telegram-friendly). */
export function openAppUrl(origin, code) {
  const base = String(origin || '').replace(/\/+$/, '');
  if (!base) return appSchemeUrl(code);
  return base + '/go/' + encodeURIComponent(formatCode(code));
}

export function adminChatIds(settings) {
  return String((settings && settings.adminTelegramIds) || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdminChat(settings, chatId) {
  const id = String(chatId);
  return adminChatIds(settings).some((s) => s === id);
}

const SUPPORT_CAP = 400;

export const SUPPORT_CLOSED_TEXT =
  'Диалог с поддержкой завершён. Если вопрос останется — нажмите «Поддержка» и напишите снова.';

export function appendSupportMessage(state, { telegramId, text, direction, now, via }) {
  const body = String(text || '').trim().slice(0, 2000);
  const id = String(telegramId || '').trim();
  if (!body || !id) return { state, result: { error: 'empty' } };
  const row = {
    id: randomId(),
    telegramId: id,
    text: body,
    direction: direction === 'out' ? 'out' : 'in',
    at: now || Date.now(),
    via: via === 'panel' ? 'panel' : 'bot',
  };
  const supportMessages = (state.supportMessages || []).concat([row]).slice(-SUPPORT_CAP);
  // Any new message (admin or user) reopens a previously closed support thread in the panel.
  const closed = { ...(state.supportClosed || {}) };
  if (closed[id]) delete closed[id];
  return { state: { ...state, supportMessages, supportClosed: closed }, result: { message: row } };
}

export function rememberSupportReply(state, { adminChatId, messageId, telegramId, now }) {
  if (!adminChatId || !messageId || !telegramId) return state;
  const key = String(adminChatId) + ':' + String(messageId);
  const row = { key, telegramId: String(telegramId), at: now || Date.now() };
  const supportReplies = (state.supportReplies || [])
    .filter((r) => r.key !== key)
    .concat([row])
    .slice(-200);
  return { ...state, supportReplies };
}

export function supportReplyTarget(state, adminChatId, messageId) {
  const key = String(adminChatId || '') + ':' + String(messageId || '');
  const row = (state.supportReplies || []).find((r) => r.key === key);
  return row ? row.telegramId : '';
}

export function supportThreads(state) {
  const map = new Map();
  const list = state.supportMessages || [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const prev = map.get(m.telegramId) || {
      telegramId: m.telegramId,
      count: 0,
      lastText: '',
      lastAt: 0,
      lastDirection: 'in',
    };
    prev.count += 1;
    if ((m.at || 0) >= prev.lastAt) {
      prev.lastText = m.text || '';
      prev.lastAt = m.at || 0;
      prev.lastDirection = m.direction || 'in';
    }
    map.set(m.telegramId, prev);
  }
  return Array.from(map.values())
    .filter((row) => {
      const closedAt = Number((state.supportClosed || {})[row.telegramId] || 0);
      return !closedAt || row.lastAt > closedAt;
    })
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((row) => {
      const acc = accountByTelegram(state, row.telegramId);
      return {
        ...row,
        username: acc && acc.telegramUsername ? acc.telegramUsername : '',
        name: acc && acc.telegramName ? acc.telegramName : '',
      };
    });
}

export function supportThread(state, telegramId) {
  const id = String(telegramId || '');
  return (state.supportMessages || []).filter((m) => m.telegramId === id);
}

/** Hide the thread in the panel and keep the notice in history. A newer user message opens it again. */
export function closeSupportThread(state, { telegramId, text, now }) {
  const id = String(telegramId || '').trim();
  if (!id) return { state, result: { error: 'empty' } };
  const has = (state.supportMessages || []).some((m) => m.telegramId === id);
  if (!has) return { state, result: { error: 'empty' } };
  const at = now || Date.now();
  const notice = String(text || SUPPORT_CLOSED_TEXT).trim() || SUPPORT_CLOSED_TEXT;
  const saved = appendSupportMessage(state, { telegramId: id, text: notice, direction: 'out', now: at, via: 'panel' });
  const supportClosed = { ...(saved.state.supportClosed || {}), [id]: at };
  return { state: { ...saved.state, supportClosed }, result: { ok: true, text: notice } };
}

export function createSubscription(state, { accountId, now, days }) {
  const period = days || state.settings.periodDays || 30;
  const sub = {
    id: randomId(),
    accountId,
    product: 'jackett',
    paidUntil: now + period * DAY,
    deviceLimit: DEVICE_BASE,
    extraSlots: 0,
    extraUntil: 0,
    createdAt: now,
    extendedAt: now,
  };
  const issued = issue({ ...state, subscriptions: state.subscriptions.concat([sub]) }, sub.id, now);
  return { state: issued.state, result: { subscriptionId: sub.id, code: issued.code, paidUntil: sub.paidUntil } };
}

/**
 * Issue an activation code. An account that already has a subscription gets a code on that
 * subscription; paidUntil stays the real expiry. Days apply only when creating the first one.
 */
export function issueActivation(state, { email, telegramId, accountId, days, now }) {
  const opened = accountId
    ? { state, account: findAccount(state, accountId) }
    : openAccount(state, { email, telegramId, now });
  if (!opened.account) return { state, result: { error: 'bad_account' } };
  const cur = opened.state;
  const account = opened.account;
  const existing = anySub(cur, account.id);
  if (existing) {
    const slot = slotCode(cur, existing, now);
    if (slot.limit) {
      return {
        state,
        result: { error: 'device_limit', account, deviceLimit: deviceLimitNow(cur, existing, now), bound: boundDevices(cur, existing.id) },
      };
    }
    return {
      state: slot.state,
      result: {
        code: slot.code,
        codeId: slot.codeId,
        account,
        paidUntil: existing.paidUntil,
        days: 0,
        created: false,
        reused: slot.reused,
      },
    };
  }
  const period = days > 0 ? Math.floor(Number(days)) : cur.settings.periodDays || 30;
  const created = createSubscription(cur, { accountId: account.id, now, days: period });
  return {
    state: created.state,
    result: {
      code: created.result.code,
      account,
      paidUntil: created.result.paidUntil,
      days: period,
      created: true,
    },
  };
}

/** N fresh accounts, each with its own subscription code. Count is capped at 100. */
export function issueMany(state, { count, days, now }) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
  const period = days > 0 ? Math.floor(Number(days)) : state.settings.periodDays || 30;
  let cur = state;
  const codes = [];
  for (let i = 0; i < n; i++) {
    const opened = openAccount(cur, { email: '', telegramId: '', now: now + i });
    const created = createSubscription(opened.state, { accountId: opened.account.id, now: now + i, days: period });
    cur = created.state;
    codes.push({
      code: formatCode(created.result.code),
      plain: created.result.code,
      accountId: opened.account.id,
      paidUntil: created.result.paidUntil,
    });
  }
  return { state: cur, result: { codes } };
}

export function activate(state, { code, deviceId, now }) {
  if (!deviceOk(deviceId) || normalizeCode(code).length !== 8) return fail('bad_code', state);
  const hash = codeHash(code);
  const row = state.codes.find((c) => c.hash === hash && !c.revoked);
  if (!row) return fail('bad_code', recordAttempt(state, { at: now, hash, deviceId, ok: false, reason: 'bad_code' }));
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  if (!sub || !subAccess(state, sub, now).access) {
    return fail('expired', recordAttempt(state, { at: now, hash, deviceId, ok: false, reason: 'expired', accountId: sub ? sub.accountId : '' }));
  }
  if (row.deviceId && row.deviceId !== deviceId) {
    return fail('other_device', recordAttempt(state, { at: now, hash, deviceId, ok: false, reason: 'other_device', accountId: sub.accountId }));
  }
  // A new device needs a free slot. A code already bound to this device (re-entry) always passes.
  if (!row.deviceId && deviceLimitReached(state, sub, now)) {
    return fail('device_limit', recordAttempt(state, { at: now, hash, deviceId, ok: false, reason: 'device_limit', accountId: sub.accountId }));
  }
  // Re-entry on a phone that sits over a lapsed extra slot: the binding stays, access returns on renewal.
  if (row.deviceId && !codeWithinLimit(state, sub, row, now)) {
    return fail('device_limit', recordAttempt(state, { at: now, hash, deviceId, ok: false, reason: 'device_limit', accountId: sub.accountId }));
  }
  const codes = state.codes.map((c) =>
    c.id === row.id && !c.deviceId ? { ...c, deviceId, boundAt: now, plain: '' } : c.id === row.id ? { ...c, plain: '' } : c,
  );
  const token = randomId() + randomId();
  const sessions = state.sessions.filter((s) => s.codeId !== row.id).concat([{ codeId: row.id, hash: sha256(token), createdAt: now }]);
  let next = recordAttempt({ ...state, codes, sessions }, { at: now, hash, deviceId, ok: true, reason: 'ok', accountId: sub.accountId });
  // Keep the phone↔Telegram link in sync when the code belongs to a TG account.
  const account = findAccount(next, sub.accountId);
  if (account) {
    const linked = Array.isArray(account.linkedDevices) ? account.linkedDevices : [];
    if (linked.indexOf(deviceId) < 0) {
      const accounts = next.accounts.map((a) =>
        a.id === account.id ? { ...a, linkedDevices: linked.concat([deviceId]) } : a,
      );
      next = { ...next, accounts };
    }
  }
  return { state: next, result: { token, paidUntil: sub.paidUntil, codeId: row.id } };
}

/** The code row behind `token` when that session belongs to `deviceId`. Expiry is not checked. */
export function sessionForDevice(state, { token, deviceId }) {
  if (!token || !deviceOk(deviceId)) return null;
  const hash = sha256(token);
  const session = state.sessions.find((s) => s.hash === hash);
  if (!session) return null;
  const row = state.codes.find((c) => c.id === session.codeId && !c.revoked);
  return row && row.deviceId === deviceId ? row : null;
}

export function sessionOk(state, { token, deviceId, now }) {
  if (!token || !deviceOk(deviceId)) return null;
  const hash = sha256(token);
  const session = state.sessions.find((s) => s.hash === hash);
  if (!session) return null;
  const row = state.codes.find((c) => c.id === session.codeId && !c.revoked);
  if (!row || row.deviceId !== deviceId) return null;
  const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
  // Access lasts through the grace period after paidUntil (server clock only).
  const access = subAccess(state, sub, now);
  if (!sub || !access.access) return null;
  if (!codeWithinLimit(state, sub, row, now)) return null;
  return { code: row, subscription: sub, grace: access.grace, accessUntil: access.accessUntil };
}

/** A pending (unaccepted) row does not count: the accepted notification for it must still apply. */
function seenPayment(state, operationId) {
  return state.payments.some((p) => p.operationId === operationId && !p.pending);
}

function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

const WEBHOOK_CAP = 200;

export function logWebhook(state, row) {
  const webhooks = (state.webhooks || []).concat([row]).slice(-WEBHOOK_CAP);
  return { ...state, webhooks };
}

const AUDIT_CAP = 200;

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const kind = String(actor.kind || '');
  if (kind !== 'user' && kind !== 'device' && kind !== 'admin' && kind !== 'system') return null;
  return {
    kind,
    id: String(actor.id || '').slice(0, 80),
    label: String(actor.label || '').slice(0, 120),
  };
}

/** Old audit rows stored "telegram 123" in the detail and no actor. */
function actorFromAuditDetail(row) {
  const detail = String((row && row.detail) || '');
  const tg = detail.match(/(?:^|\s)telegram\s+(\d+)/i);
  if (!tg) return null;
  return { kind: 'admin', id: tg[1], label: tg[1] };
}

/** Append an admin panel action. `actor` is { kind, id, label } when the caller knows who. */
export function logAudit(state, { action, detail, now, actor }) {
  const row = { at: now || Date.now(), action: String(action || ''), detail: String(detail || '') };
  const who = normalizeActor(actor);
  if (who) row.actor = who;
  const audit = (state.audit || []).concat([row]).slice(-AUDIT_CAP);
  return { ...state, audit };
}

/**
 * Additive migration: fill accountId / actor where they can be derived.
 * Every existing field is kept. Rows that cannot be attributed are left unchanged.
 */
export function enrichActors(state) {
  if (!state || typeof state !== 'object') return state;
  const payments = (state.payments || []).map((p) => {
    if (!p || typeof p !== 'object' || p.accountId) return p;
    const resolved = resolvePaymentAccount(state, p.label);
    if (!resolved.accountId) return p;
    return { ...p, accountId: resolved.accountId };
  });
  const attempts = (state.attempts || []).map((a) => {
    if (!a || typeof a !== 'object' || a.accountId) return a;
    const accountId = accountIdForAttempt(state, a);
    if (!accountId) return a;
    return { ...a, accountId };
  });
  const audit = (state.audit || []).map((row) => {
    if (!row || typeof row !== 'object' || (row.actor && row.actor.kind)) return row;
    const actor = actorFromAuditDetail(row);
    if (!actor) return row;
    return { ...row, actor };
  });
  return { ...state, payments, attempts, audit };
}

/**
 * YooMoney credits `amount` after its own fee. A card payment can leave about 3% with YooMoney,
 * so a credited sum a little under the price is still that purchase. Anything lower is not.
 */
const PAYMENT_FEE = 0.03;

/** True when `amount` is rubles (currency 643) and covers `price` after the fee allowance. */
export function paymentCovers(amount, currency, price) {
  const expected = Number(price) || 0;
  if (!(expected > 0)) return false;
  if (String(currency || '') !== '643') return false;
  return money(amount) + 1e-9 >= expected * (1 - PAYMENT_FEE) - 0.01;
}

function priceOf(state, mark) {
  if (mark.indexOf('dev:') === 0) return Number(state.settings.extraDeviceRub) || 0;
  if (mark.indexOf('sub:') === 0 || mark.indexOf('new:') === 0) return Number(state.settings.priceRub) || 0;
  return 0;
}

function stampPayment(state, row) {
  const at = row && row.at ? row.at : Date.now();
  const base = { ...row, at };
  if (base.accountId) return base;
  const resolved = resolvePaymentAccount(state, base.label);
  if (!resolved.accountId) return base;
  return { ...base, accountId: resolved.accountId };
}

function rejectAmount(state, row) {
  const payments = state.payments.concat([stampPayment(state, { ...row, error: 'amount' })]);
  return { state: { ...state, payments }, result: { error: 'amount' } };
}

/**
 * A paid renewal by `days`. Inside access (paid or grace) it continues from paidUntil, so grace days
 * are not free; after the grace period it starts now. `extras` slots that were quoted move to the new
 * paidUntil. With extras 0 the stored slots keep their own date and lapse on it.
 */
function extendPaid(state, sub, days, now, extras) {
  const from = subAccess(state, sub, now).access ? Number(sub.paidUntil) || now : now;
  const paidUntil = from + days * DAY;
  const next = { ...sub, paidUntil, extendedAt: now };
  const n = Math.max(0, Math.floor(Number(extras) || 0));
  if (n > 0) {
    next.extraSlots = n;
    next.extraUntil = paidUntil;
  }
  return next;
}

/**
 * Gift days (promo, admin grant): from max(paidUntil, now) as before. Extra slots that are still
 * active and run with the subscription are carried along, so a gift never cuts off a paid device.
 */
function extendGift(state, sub, days, now) {
  const from = Math.max(Number(sub.paidUntil) || 0, now);
  const paidUntil = from + days * DAY;
  const next = { ...sub, paidUntil, extendedAt: now };
  if (activeExtras(state, sub, now) > 0 && (Number(sub.extraUntil) || 0) >= (Number(sub.paidUntil) || 0)) {
    next.extraUntil = paidUntil;
  }
  return next;
}

/**
 * Renewal price at `now`: base price plus every extra slot that still counts.
 * `withExtras: false` quotes the subscription alone (the extra slots then lapse on their date).
 */
/**
 * Extra slots a renewal at `now` brings along: the ones that still count, or, once access is over,
 * the ones that ran with this subscription and lapsed with it (extraUntil reached paidUntil).
 * Slots dropped by an earlier base-only renewal are not offered again; they are bought with «Код».
 */
export function renewableExtras(state, sub, now) {
  if (!sub) return 0;
  const active = activeExtras(state, sub, now);
  if (active > 0) return active;
  if (subAccess(state, sub, now).access) return 0;
  const n = Math.max(0, Math.floor(Number(sub.extraSlots) || 0));
  return n && (Number(sub.extraUntil) || 0) >= (Number(sub.paidUntil) || 0) ? n : 0;
}

export function renewalPrice(state, sub, now, opts) {
  const prices = priceText(state.settings);
  const extras = opts && opts.withExtras === false ? 0 : renewableExtras(state, sub, now);
  return {
    days: prices.days,
    base: prices.price,
    extraRub: prices.extra,
    extras,
    extraSum: extras * prices.extra,
    total: prices.price + extras * prices.extra,
  };
}

export function applyPayment(input, { operationId, label, amount, currency, unaccepted, now }) {
  if (!operationId || seenPayment(input, operationId)) {
    return {
      state: logWebhook(input, { kind: 'duplicate', operationId: operationId || '', label: label || '', amount: amount || '', at: now }),
      result: { duplicate: true },
    };
  }
  const hadPending = input.payments.some((p) => p.operationId === operationId && p.pending);
  if (isTrue(unaccepted)) {
    // YooMoney holds the transfer until the wallet owner accepts it. Record it, do not extend anything.
    if (hadPending) {
      return {
        state: logWebhook(input, { kind: 'duplicate', operationId, label: label || '', amount: amount || '', at: now }),
        result: { duplicate: true },
      };
    }
    const held = stampPayment(input, {
      operationId,
      label: String(label || ''),
      amount,
      at: now || Date.now(),
      error: 'unaccepted',
      pending: true,
    });
    return { state: { ...input, payments: input.payments.concat([held]) }, result: { error: 'unaccepted', pending: true } };
  }
  // The accepted notice replaces the held row for the same operation.
  const state = hadPending ? { ...input, payments: input.payments.filter((p) => !(p.operationId === operationId && p.pending)) } : input;
  const mark = String(label || '');
  const days = state.settings.periodDays || 30;
  const row = { operationId, label: mark, amount, at: now || Date.now() };
  let act = mark;
  let quoted = null;
  let quotedExtras = 0;
  if (mark.indexOf('buy:') === 0) {
    const quote = (state.purchases || []).find((p) => p.id === mark.slice(4));
    if (!quote) {
      const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    quoted = Number(quote.price) || 0;
    quotedExtras = Math.max(0, Math.floor(Number(quote.extras) || 0));
    if (quote.kind === 'new') act = 'new:' + quote.accountId;
    else if (quote.kind === 'sub') act = 'sub:' + quote.subscriptionId;
    else if (quote.kind === 'dev') act = 'dev:' + quote.subscriptionId;
    else {
      const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
  }
  const covers = (kindMark) => paymentCovers(amount, currency, quoted !== null ? quoted : priceOf(state, kindMark));

  if (act.indexOf('sub:') === 0) {
    const id = act.slice(4);
    const sub = state.subscriptions.find((s) => s.id === id);
    if (!sub) {
      const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    if (!covers(act)) return rejectAmount(state, row);
    const subscriptions = state.subscriptions.map((s) => (s.id === id ? extendPaid(state, s, days, now, quotedExtras) : s));
    const next = subscriptions.find((s) => s.id === id);
    return {
      state: { ...state, payments: state.payments.concat([stampPayment(state, row)]), subscriptions },
      result: { kind: 'renew', subscriptionId: id, paidUntil: next ? next.paidUntil : 0, extras: quotedExtras },
    };
  }
  if (act.indexOf('dev:') === 0) {
    const id = act.slice(4);
    if (!state.subscriptions.find((s) => s.id === id)) {
      const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    if (!covers(act)) return rejectAmount(state, row);
    // A monthly slot: it lasts until paidUntil and is renewed together with the subscription.
    const subscriptions = state.subscriptions.map((s) =>
      s.id === id
        ? { ...s, extraSlots: activeExtras(state, s, now) + 1, extraUntil: Math.max(Number(s.paidUntil) || 0, Number(s.extraUntil) || 0) }
        : s,
    );
    const paidState = { ...state, payments: state.payments.concat([stampPayment(state, row)]), subscriptions };
    const bought = subscriptions.find((s) => s.id === id);
    const slot = slotCode(paidState, bought, now);
    return {
      state: slot.state,
      result: { kind: 'device', subscriptionId: id, code: slot.code, extraUntil: bought.extraUntil, extras: bought.extraSlots },
    };
  }
  if (act.indexOf('new:') === 0) {
    const accountId = act.slice(4);
    if (!findAccount(state, accountId)) {
      const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    if (!covers(act)) return rejectAmount(state, row);
    const base = { ...state, payments: state.payments.concat([stampPayment(state, row)]) };
    const existing = anySub(base, accountId);
    if (existing) {
      const subscriptions = base.subscriptions.map((s) => (s.id === existing.id ? extendPaid(base, s, days, now, quotedExtras) : s));
      const sub = subscriptions.find((s) => s.id === existing.id);
      return {
        state: { ...base, subscriptions },
        result: { kind: 'renew', subscriptionId: existing.id, paidUntil: sub.paidUntil, extras: quotedExtras },
      };
    }
    const created = createSubscription(base, { accountId, now, days });
    return { state: created.state, result: { kind: 'new', ...created.result } };
  }
  const payments = state.payments.concat([stampPayment(state, { ...row, error: 'bad_label' })]);
  return { state: { ...state, payments }, result: { error: 'bad_label' } };
}

function money(amount) {
  const n = Number(String(amount || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function resolvePaymentAccount(state, label) {
  const mark = String(label || '');
  if (mark.indexOf('buy:') === 0) {
    const quote = (state.purchases || []).find((p) => p.id === mark.slice(4));
    if (!quote) return { problem: 'bad_label' };
    if (quote.accountId && findAccount(state, quote.accountId)) return { accountId: quote.accountId };
    const sub = state.subscriptions.find((s) => s.id === quote.subscriptionId);
    return sub ? { accountId: sub.accountId } : { problem: 'no_account' };
  }
  if (mark.indexOf('new:') === 0) {
    const id = mark.slice(4);
    return findAccount(state, id) ? { accountId: id } : { problem: 'no_account' };
  }
  if (mark.indexOf('sub:') === 0 || mark.indexOf('dev:') === 0) {
    const sub = state.subscriptions.find((s) => s.id === mark.slice(4));
    return sub ? { accountId: sub.accountId } : { problem: 'no_subscription' };
  }
  return { problem: 'bad_label' };
}

function problemLine(row) {
  const amount = String((row && row.amount) || '').trim();
  const label = String((row && row.label) || '').trim();
  const op = String((row && row.operationId) || '').trim();
  const bits = [];
  if (amount) bits.push(amount + ' ₽');
  if (label) bits.push(label);
  if (op) bits.push(op);
  return { amount, label, operationId: op, text: bits.join(' · ') };
}

/** Payments list + day/week/month totals + problem rows for the admin finance section. */
export function financeReport(state, now) {
  const dayFrom = now - DAY;
  const weekFrom = now - 7 * DAY;
  const monthFrom = now - 30 * DAY;
  const okPay = (p) => !p.error;
  const sumFrom = (from) =>
    state.payments.filter((p) => okPay(p) && p.at >= from).reduce((acc, p) => acc + money(p.amount), 0);
  const countFrom = (from) => state.payments.filter((p) => okPay(p) && p.at >= from).length;

  const payments = state.payments
    .slice()
    .reverse()
    .slice(0, 100)
    .map((p) => {
      const resolved = resolvePaymentAccount(state, p.label);
      const acc = resolved.accountId ? findAccount(state, resolved.accountId) : null;
      return {
        ...p,
        accountId: resolved.accountId || '',
        who: acc ? telegramDisplay(acc) || acc.email || acc.id : '',
        problem: p.error || resolved.problem || '',
      };
    });

  const problems = [];
  for (let i = 0; i < state.payments.length; i++) {
    const p = state.payments[i];
    const resolved = resolvePaymentAccount(state, p.label);
    const err = p.error || resolved.problem;
    if (!err) continue;
    const line = problemLine(p);
    problems.push({
      at: p.at || 0,
      kind: err,
      amount: line.amount,
      label: line.label,
      operationId: line.operationId,
      text: line.text,
    });
  }
  for (let i = 0; i < (state.webhooks || []).length; i++) {
    const w = state.webhooks[i];
    const line = problemLine(w);
    problems.push({
      at: w.at || 0,
      kind: w.kind || 'webhook',
      amount: line.amount,
      label: line.label,
      operationId: line.operationId,
      text: line.text,
    });
  }
  problems.sort((a, b) => b.at - a.at);

  return {
    summary: {
      day: { sum: sumFrom(dayFrom), count: countFrom(dayFrom) },
      week: { sum: sumFrom(weekFrom), count: countFrom(weekFrom) },
      month: { sum: sumFrom(monthFrom), count: countFrom(monthFrom) },
      total: {
        sum: state.payments.filter(okPay).reduce((acc, p) => acc + money(p.amount), 0),
        count: state.payments.filter(okPay).length,
      },
    },
    payments,
    problems: problems.slice(0, 50),
  };
}

/** CSV of successful payments in [from, to] (ms). */
export function paymentsCsv(state, from, to) {
  const lines = ['at,amount,label,operationId,accountId,telegramId'];
  const rows = state.payments
    .filter((p) => !p.error && p.at >= from && p.at <= to)
    .slice()
    .sort((a, b) => a.at - b.at);
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const resolved = resolvePaymentAccount(state, p.label);
    const acc = resolved.accountId ? findAccount(state, resolved.accountId) : null;
    lines.push(
      [
        csvCell(new Date(p.at).toISOString()),
        csvCell(p.amount),
        csvCell(p.label),
        csvCell(p.operationId),
        csvCell(resolved.accountId || ''),
        csvCell(acc ? acc.telegramId || '' : ''),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Revenue and new subscriptions per UTC day, oldest first, `days` long (max 90). */
export function dailySeries(state, now, days) {
  const n = Math.max(1, Math.min(90, Math.floor(Number(days) || 30)));
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const startMs = end.getTime() - (n - 1) * DAY;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const from = startMs + i * DAY;
    const to = from + DAY;
    let revenue = 0;
    const payments = state.payments || [];
    for (let p = 0; p < payments.length; p++) {
      const row = payments[p];
      if (row.error || row.at < from || row.at >= to) continue;
      revenue += money(row.amount);
    }
    let subs = 0;
    const subscriptions = state.subscriptions || [];
    for (let s = 0; s < subscriptions.length; s++) {
      const created = subscriptions[s].createdAt || 0;
      if (created >= from && created < to) subs += 1;
    }
    rows.push({ day: dayKey(from), revenue, subs });
  }
  return rows;
}

function paymentView(state, p) {
  const resolved = resolvePaymentAccount(state, p.label);
  const acc = resolved.accountId ? findAccount(state, resolved.accountId) : null;
  return {
    at: p.at || 0,
    amount: p.amount || '',
    label: p.label || '',
    operationId: p.operationId || '',
    error: p.error || '',
    accountId: resolved.accountId || '',
    who: acc ? telegramDisplay(acc) || acc.email || acc.id : '',
    problem: p.error || resolved.problem || '',
  };
}

/** Filtered payment history. `from` / `to` are ms, inclusive. */
export function pagePayments(state, { q, from, to, offset, limit }) {
  const query = String(q || '').trim().toLowerCase();
  const startAt = Number(from) || 0;
  const endAt = Number(to) || 0;
  const rows = (state.payments || [])
    .slice()
    .reverse()
    .map((p) => paymentView(state, p))
    .filter((p) => {
      if (startAt && (p.at || 0) < startAt) return false;
      if (endAt && (p.at || 0) > endAt) return false;
      if (!query) return true;
      const hay = [p.who, p.label, p.amount, p.operationId, p.accountId, p.error].join(' ').toLowerCase();
      return hay.indexOf(query) >= 0;
    });
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
  return { total: rows.length, payments: rows.slice(start, start + size) };
}

export function pageAudit(state, { q, action, offset, limit }) {
  const query = String(q || '').trim().toLowerCase();
  const act = String(action || '').trim();
  const rows = (state.audit || [])
    .slice()
    .reverse()
    .filter((row) => {
      if (act && row.action !== act) return false;
      if (!query) return true;
      const who = row.actor ? String(row.actor.kind || '') + ' ' + String(row.actor.label || '') + ' ' + String(row.actor.id || '') : '';
      return (String(row.action || '') + ' ' + String(row.detail || '') + ' ' + who).toLowerCase().indexOf(query) >= 0;
    });
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 30)));
  return { total: rows.length, audit: rows.slice(start, start + size) };
}

export function pageFails(state, { reason, q, offset, limit }) {
  const why = String(reason || '').trim();
  const query = String(q || '').trim().toLowerCase();
  const rows = (state.attempts || [])
    .filter((a) => !a.ok)
    .slice()
    .reverse()
    .filter((a) => {
      if (why && a.reason !== why) return false;
      if (!query) return true;
      return (String(a.reason || '') + ' ' + String(a.deviceId || '')).toLowerCase().indexOf(query) >= 0;
    })
    .map((a) => ({
      at: a.at || 0,
      reason: a.reason || '',
      deviceId: a.deviceId || '',
    }));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 30)));
  return { total: rows.length, fails: rows.slice(start, start + size) };
}

export function subscriptionsCsv(state, now) {
  const lines = ['accountId,who,telegramId,email,paidUntil,active,deviceLimit,bound'];
  const subs = state.subscriptions || [];
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    const acc = findAccount(state, sub.accountId) || {};
    const bound = (state.codes || []).filter((c) => c.subscriptionId === sub.id && !c.revoked && c.deviceId).length;
    lines.push(
      [
        csvCell(sub.accountId),
        csvCell(telegramDisplay(acc) || acc.email || ''),
        csvCell(acc.telegramId || ''),
        csvCell(acc.email || ''),
        csvCell(sub.paidUntil ? new Date(sub.paidUntil).toISOString() : ''),
        csvCell(sub.paidUntil > now ? '1' : '0'),
        csvCell(sub.deviceLimit),
        csvCell(bound),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function usersCsv(state) {
  const lines = ['id,email,telegramId,telegramUsername,telegramName,createdAt'];
  const accounts = state.accounts || [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    lines.push(
      [
        csvCell(a.id),
        csvCell(a.email || ''),
        csvCell(a.telegramId || ''),
        csvCell(a.telegramUsername || ''),
        csvCell(a.telegramName || ''),
        csvCell(a.createdAt ? new Date(a.createdAt).toISOString() : ''),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function promosCsv(state) {
  const lines = ['code,days,uses,maxUses,revoked'];
  const promos = state.promos || [];
  for (let i = 0; i < promos.length; i++) {
    const p = promos[i];
    lines.push(
      [csvCell(p.code), csvCell(p.days), csvCell((p.uses || []).length), csvCell(p.maxUses), csvCell(p.revoked ? '1' : '0')].join(
        ',',
      ),
    );
  }
  return lines.join('\n') + '\n';
}

export function codesCsv(codes) {
  const lines = ['code,accountId,paidUntil'];
  const rows = codes || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push(
      [
        csvCell(row.code || row.plain || ''),
        csvCell(row.accountId || ''),
        csvCell(row.paidUntil ? new Date(row.paidUntil).toISOString() : ''),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
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
  const row = state.codes.find((c) => c.id === codeId);
  const deviceId = row && row.deviceId ? row.deviceId : '';
  let accounts = state.accounts;
  if (deviceId) {
    accounts = state.accounts.map((a) => {
      const linked = Array.isArray(a.linkedDevices) ? a.linkedDevices.filter((d) => d !== deviceId) : [];
      return linked.length === (a.linkedDevices || []).length ? a : { ...a, linkedDevices: linked };
    });
  }
  // Plaintext was cleared on activate — mint a fresh code for the same slot.
  const plain = randomCode();
  return {
    ...state,
    accounts,
    codes: state.codes.map((c) =>
      c.id === codeId ? { ...c, deviceId: '', boundAt: 0, plain, hash: codeHash(plain) } : c,
    ),
    sessions: state.sessions.filter((s) => s.codeId !== codeId),
  };
}

/** Unbind every code slot tied to this device for the account (user self-service). */
export function unbindDevice(state, { accountId, deviceId }) {
  if (!deviceOk(deviceId) || !findAccount(state, accountId)) return state;
  const mine = state.codes.filter((c) => {
    if (c.deviceId !== deviceId || c.revoked) return false;
    const sub = state.subscriptions.find((s) => s.id === c.subscriptionId);
    return sub && sub.accountId === accountId;
  });
  let next = state;
  for (let i = 0; i < mine.length; i++) next = unbindCode(next, mine[i].id);
  return next;
}

export function startDeviceLink(state, { deviceId, now }) {
  if (!deviceOk(deviceId)) return { state, result: { error: 'bad_device' } };
  const token = randomId() + randomId();
  const fresh = (state.links || []).filter((l) => !l.usedAt && l.expiresAt > now);
  const links = fresh.concat([{ token, deviceId, createdAt: now, expiresAt: now + 10 * 60 * 1000, usedAt: 0, accountId: '' }]).slice(-80);
  return { state: { ...state, links }, result: { token, expiresAt: now + 10 * 60 * 1000 } };
}

const ADMIN_LOGIN_TTL = 10 * 60 * 1000;

/** Start a Telegram login for the admin web panel. Payload: /start admin_TOKEN */
export function startAdminPanelLogin(state, { now }) {
  const token = randomId() + randomId();
  const expiresAt = now + ADMIN_LOGIN_TTL;
  const fresh = (state.adminLogins || []).filter((l) => !l.consumedAt && l.expiresAt > now);
  const adminLogins = fresh
    .concat([{ token, createdAt: now, expiresAt, telegramId: '', confirmedAt: 0, consumedAt: 0, deniedAt: 0 }])
    .slice(-40);
  return { state: { ...state, adminLogins }, result: { token, expiresAt } };
}

/**
 * Confirm a panel login link.
 * error is unknown | expired | used | wrong_user. The token is never part of the error.
 * Precedence: unknown, already used, expired, then wrong user.
 */
export function confirmAdminPanelLogin(state, { token, telegramId, now }) {
  const key = String(token || '')
    .trim()
    .toLowerCase();
  const rows = state.adminLogins || [];
  if (!key) return { state, result: { error: 'unknown' } };
  const row = rows.find((l) => l.token === key);
  if (!row) return { state, result: { error: 'unknown' } };
  if (row.consumedAt) return { state, result: { error: 'used' } };
  if (!(row.expiresAt > now)) return { state, result: { error: 'expired' } };
  if (!isAdminChat(state.settings, telegramId) || row.deniedAt) {
    if (row.deniedAt) return { state, result: { error: 'wrong_user' } };
    const adminLogins = rows.map((l) =>
      l.token === key ? { ...l, deniedAt: now, telegramId: String(telegramId) } : l,
    );
    return { state: { ...state, adminLogins }, result: { error: 'wrong_user' } };
  }
  const adminLogins = rows.map((l) =>
    l.token === key ? { ...l, telegramId: String(telegramId), confirmedAt: now, deniedAt: 0 } : l,
  );
  return { state: { ...state, adminLogins }, result: { ok: true } };
}

/** Browser poll: pending | ok | expired | denied. Consumes the token when ok. */
export function takeAdminPanelLogin(state, { token, now }) {
  const key = String(token || '')
    .trim()
    .toLowerCase();
  if (!key) return { state, result: { status: 'expired' } };
  const row = (state.adminLogins || []).find((l) => l.token === key);
  if (!row || row.consumedAt || row.expiresAt <= now) return { state, result: { status: 'expired' } };
  if (row.deniedAt) return { state, result: { status: 'denied' } };
  if (!row.confirmedAt) return { state, result: { status: 'pending' } };
  const adminLogins = state.adminLogins.map((l) => (l.token === key ? { ...l, consumedAt: now } : l));
  return { state: { ...state, adminLogins }, result: { status: 'ok', telegramId: row.telegramId } };
}

const CLI_LOGIN_TTL = 10 * 60 * 1000;

/**
 * One-time break-glass login minted from the server shell.
 * The raw token is returned to the caller and is not written into the snapshot or the audit row.
 */
export function issueCliAdminLogin(state, { now }) {
  const at = now || Date.now();
  const token = randomId() + randomId();
  const hash = sha256(token);
  const expiresAt = at + CLI_LOGIN_TTL;
  const fresh = (state.adminCliLogins || []).filter((l) => l && !l.consumedAt && l.expiresAt > at);
  const adminCliLogins = fresh.concat([{ hash, createdAt: at, expiresAt, consumedAt: 0 }]).slice(-20);
  const next = logAudit(
    { ...state, adminCliLogins },
    { action: 'login_cli', detail: 'ссылка выдана', now: at, actor: { kind: 'admin', id: 'cli', label: 'cli' } },
  );
  return { state: next, result: { token, expiresAt } };
}

/** Redeem a shell login link. Single use. Expired and unknown tokens do not change state. */
export function takeCliAdminLogin(state, { token, now }) {
  const at = now || Date.now();
  const raw = String(token || '');
  if (!raw) return { state, result: { status: 'expired' } };
  const hash = sha256(raw);
  const row = (state.adminCliLogins || []).find((l) => l && l.hash === hash);
  if (!row || row.consumedAt || row.expiresAt <= at) return { state, result: { status: 'expired' } };
  const adminCliLogins = state.adminCliLogins.map((l) => (l && l.hash === hash ? { ...l, consumedAt: at } : l));
  const next = logAudit(
    { ...state, adminCliLogins },
    { action: 'login', detail: 'cli', now: at, actor: { kind: 'admin', id: 'cli', label: 'cli' } },
  );
  return { state: next, result: { status: 'ok' } };
}

export function confirmDeviceLink(state, { token, telegramId, now }) {
  const key = String(token || '').trim().toLowerCase();
  if (!key) return { state, result: { error: 'bad_link' } };
  const link = (state.links || []).find((l) => l.token === key && !l.usedAt && l.expiresAt > now);
  if (!link) return { state, result: { error: 'bad_link' } };
  const ensured = ensureTelegramAccount(state, telegramId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const linked = Array.isArray(account.linkedDevices) ? account.linkedDevices.slice() : [];
  if (linked.indexOf(link.deviceId) < 0) linked.push(link.deviceId);
  const accounts = cur.accounts.map((a) => (a.id === account.id ? { ...a, linkedDevices: linked } : a));
  const links = cur.links.map((l) => (l.token === key ? { ...l, usedAt: now, accountId: account.id } : l));
  return {
    state: { ...cur, accounts, links },
    result: { ok: true, deviceId: link.deviceId, accountId: account.id },
  };
}

export function accountByDevice(state, deviceId) {
  if (!deviceOk(deviceId)) return null;
  const viaLink = state.accounts.find((a) => Array.isArray(a.linkedDevices) && a.linkedDevices.indexOf(deviceId) >= 0);
  if (viaLink) return viaLink;
  const code = state.codes.find((c) => c.deviceId === deviceId && !c.revoked);
  if (!code) return null;
  const sub = state.subscriptions.find((s) => s.id === code.subscriptionId);
  return sub ? findAccount(state, sub.accountId) : null;
}

/** Drop this device from the account's Telegram link list (keeps telegramId on the account). */
export function unlinkDeviceTelegram(state, { deviceId, now }) {
  if (!deviceOk(deviceId)) return { state, result: { error: 'bad_device' } };
  const account = accountByDevice(state, deviceId);
  if (!account) return { state, result: { error: 'not_linked' } };
  const linked = (Array.isArray(account.linkedDevices) ? account.linkedDevices : []).filter((d) => d !== deviceId);
  const accounts = state.accounts.map((a) => (a.id === account.id ? { ...a, linkedDevices: linked } : a));
  return {
    state: logAudit(
      { ...state, accounts },
      {
        action: 'tg_unlink',
        detail: account.id + ' ' + deviceId.slice(0, 8),
        now: now || Date.now(),
        actor: {
          kind: 'user',
          id: account.id,
          label: telegramDisplay(account) || account.telegramId || account.id,
        },
      },
    ),
    // The device is gone. The paying account keeps its Telegram id, so the next message still finds this subscription.
    result: { ok: true, telegramId: linked.length ? account.telegramId || '' : '' },
  };
}

/** Telegram id to show for this phone. The account keeps its id; a phone that unlinked does not look linked. */
export function telegramForDevice(account, deviceId) {
  if (!account || !deviceOk(deviceId)) return '';
  const linked = Array.isArray(account.linkedDevices) ? account.linkedDevices : [];
  if (linked.indexOf(deviceId) < 0) return '';
  return account.telegramId || '';
}

/** Unbound activation code still showable in the bot (has plaintext). */
export function revealableCode(state, accountId) {
  const sub = anySub(state, accountId);
  if (!sub) return null;
  const row = state.codes.find((c) => c.subscriptionId === sub.id && !c.revoked && !c.deviceId && c.plain);
  return row ? { code: row.plain, codeId: row.id } : null;
}

export function grantDays(state, { telegramId, accountId, days, now }) {
  const n = days > 0 ? Math.floor(days) : 0;
  if (!n) return { state, result: { error: 'bad_args' } };
  let cur = state;
  let account = accountId ? findAccount(cur, accountId) : null;
  if (!account && telegramId) {
    const opened = ensureTelegramAccount(cur, telegramId, now);
    cur = opened.state;
    account = opened.account;
  }
  if (!account) return { state, result: { error: 'bad_args' } };
  const existing = anySub(cur, account.id);
  if (existing) {
    const extended = extendGift(cur, existing, n, now);
    const paidUntil = extended.paidUntil;
    const subscriptions = cur.subscriptions.map((s) => (s.id === existing.id ? extended : s));
    // Days always apply. A device code comes only while a slot is free (or a free code exists).
    const slot = slotCode({ ...cur, subscriptions }, existing, now);
    return {
      state: slot.state,
      result: { kind: 'grant', code: slot.code, paidUntil, days: n, accountId: account.id, limitReached: slot.limit },
    };
  }
  const created = createSubscription(cur, { accountId: account.id, now, days: n });
  return {
    state: created.state,
    result: {
      kind: 'grant',
      code: created.result.code,
      paidUntil: created.result.paidUntil,
      days: n,
      accountId: account.id,
    },
  };
}

export function adminSummary(state, now) {
  const active = state.subscriptions.filter((s) => s.paidUntil > now).length;
  const promos = (state.promos || []).filter((p) => !p.revoked).length;
  const bound = state.codes.filter((c) => !c.revoked && c.deviceId).length;
  const fails = state.attempts.filter((a) => !a.ok && a.at > now - DAY).length;
  return { accounts: state.accounts.length, active, promos, bound, fails };
}

const ATTEMPT_REASON = {
  bad_code: 'неверный код',
  expired: 'подписка истекла',
  other_device: 'чужое устройство',
  device_limit: 'лимит устройств',
};

function attemptReasonText(reason) {
  return ATTEMPT_REASON[reason] || reason || 'неизвестно';
}

function eventActor(state, accountId, deviceId, systemLabel) {
  const acc = accountId ? findAccount(state, accountId) : null;
  if (acc) return { kind: 'user', id: acc.id, label: telegramDisplay(acc) || acc.email || acc.id };
  const dev = String(deviceId || '');
  if (dev) return { kind: 'device', id: dev, label: dev.slice(0, 8) };
  return { kind: 'system', id: '', label: systemLabel || 'система' };
}

function payText(p) {
  const amount = String((p && p.amount) || '').trim();
  return amount ? amount + ' ₽' : 'сумма не указана';
}

const LOGIN_FEED = {
  login: 1,
  login_fail: 1,
  login_cli: 1,
  login_telegram_start: 1,
  logout: 1,
};

function adminFeedText(row) {
  const action = String((row && row.action) || '');
  const detail = String((row && row.detail) || '');
  if (action === 'login_cli') return 'Аварийная ссылка входа';
  if (action === 'login' && detail.indexOf('cli') === 0) return 'Вход с сервера';
  if (action === 'login' && detail.indexOf('telegram') === 0) return 'Вход через Telegram';
  if (action === 'login') return 'Вход';
  if (action === 'login_fail') return 'Отказ во входе';
  if (action === 'login_telegram_start') return 'Запрос входа через Telegram';
  if (action === 'logout') return 'Выход';
  return action;
}

/**
 * Home dashboard: recent events + operational alerts.
 * @returns {{ events: { at, kind, text, accountId, actor, deviceId? }[], alerts: { level, text }[] }}
 */
export function adminDashboard(state, now) {
  const events = [];
  for (let i = 0; i < state.payments.length; i++) {
    const p = state.payments[i];
    const label = String(p.label || '');
    const accountId = p.accountId || resolvePaymentAccount(state, label).accountId || '';
    events.push({
      at: p.at || 0,
      kind: 'pay',
      text: payText(p),
      accountId,
      actor: eventActor(state, accountId, '', 'ЮMoney'),
    });
  }
  for (let i = 0; i < (state.promos || []).length; i++) {
    const promo = state.promos[i];
    for (let u = 0; u < (promo.uses || []).length; u++) {
      const use = promo.uses[u];
      const accountId = use.accountId || '';
      events.push({
        at: use.at || 0,
        kind: 'promo',
        text: promo.code + ' · +' + promo.days + ' дн.',
        accountId,
        actor: eventActor(state, accountId, '', 'промо'),
      });
    }
  }
  for (let i = 0; i < state.attempts.length; i++) {
    const a = state.attempts[i];
    const accountId = a.accountId || accountIdForAttempt(state, a) || '';
    if (a.ok) {
      events.push({
        at: a.at || 0,
        kind: 'activate',
        text: 'код принят',
        accountId,
        deviceId: a.deviceId || '',
        actor: eventActor(state, accountId, a.deviceId, 'активация'),
      });
    } else {
      events.push({
        at: a.at || 0,
        kind: 'fail',
        text: 'Отказ: ' + attemptReasonText(a.reason),
        accountId,
        deviceId: a.deviceId || '',
        actor: eventActor(state, accountId, a.deviceId, 'активация'),
      });
    }
  }
  const audit = state.audit || [];
  for (let i = 0; i < audit.length; i++) {
    const row = audit[i];
    if (!LOGIN_FEED[row.action]) continue;
    const actor = normalizeActor(row.actor) || actorFromAuditDetail(row) || { kind: 'admin', id: '', label: 'админ' };
    events.push({
      at: row.at || 0,
      kind: 'admin',
      text: adminFeedText(row),
      accountId: '',
      actor,
    });
  }
  events.sort((a, b) => b.at - a.at);
  const feed = events.slice(0, 150);

  const alerts = [];
  const s = state.settings || {};
  if (!s.botToken) alerts.push({ level: 'bad', text: 'Не задан токен бота Telegram' });
  if (!s.jackettUrl) alerts.push({ level: 'bad', text: 'Не задан адрес Jackett' });
  if (!s.jackettApiKey) alerts.push({ level: 'bad', text: 'Не задан API-ключ Jackett' });
  if (!s.jacredUrl) alerts.push({ level: 'warn', text: 'Не задан адрес JacRed' });
  if (!s.jacredApiKey) alerts.push({ level: 'warn', text: 'Не задан API-ключ JacRed' });
  if (Number(s.priceRub) > 0 && !s.yoomoneyWallet) alerts.push({ level: 'bad', text: 'Цена задана, но кошелёк ЮMoney пуст' });
  if (!s.publicOrigin) alerts.push({ level: 'warn', text: 'Публичный адрес не задан — ссылки «Открыть в OMP» в боте без http' });
  if (!String(s.adminTelegramIds || '').trim()) {
    alerts.push({ level: 'warn', text: 'Не указаны Telegram id администраторов — вход в панель и админ-кабинет в боте недоступны' });
  }

  const soon = now + 2 * DAY;
  const expiring = state.subscriptions.filter((sub) => sub.paidUntil > now && sub.paidUntil <= soon);
  for (let i = 0; i < expiring.length; i++) {
    const sub = expiring[i];
    const acc = findAccount(state, sub.accountId);
    const who = acc ? telegramDisplay(acc) || acc.email || acc.id : sub.accountId;
    alerts.push({
      level: 'warn',
      text: 'Истекает ' + new Date(sub.paidUntil).toISOString().slice(0, 10) + ': ' + who,
      accountId: sub.accountId,
    });
  }

  const failsDay = state.attempts.filter((a) => !a.ok && a.at > now - DAY).length;
  if (failsDay >= 5) alerts.push({ level: 'bad', text: 'Отказов ввода кода за сутки: ' + failsDay });

  return { events: feed, alerts };
}

export function adminFind(state, query, now) {
  const q = String(query || '').trim();
  if (!q) return null;
  let account = findAccount(state, q) || accountByTelegram(state, q);
  if (!account && !/^\d+$/.test(q)) {
    const nick = q.replace(/^@/, '').toLowerCase();
    if (nick) account = state.accounts.find((a) => String(a.telegramUsername || '').toLowerCase() === nick) || null;
  }
  if (!account && q.indexOf('@') >= 0) {
    const mail = q.toLowerCase();
    account = state.accounts.find((a) => a.email && a.email.toLowerCase() === mail) || null;
  }
  if (!account && /^[a-f0-9]{6,}$/i.test(q)) {
    const needle = q.toLowerCase();
    account =
      state.accounts.find((a) => a.id.indexOf(needle) === 0) ||
      state.accounts.find((a) => Array.isArray(a.linkedDevices) && a.linkedDevices.some((d) => d.indexOf(needle) === 0)) ||
      null;
    if (!account) {
      const code = state.codes.find((c) => c.deviceId && c.deviceId.indexOf(needle) === 0);
      if (code) {
        const sub = state.subscriptions.find((s) => s.id === code.subscriptionId);
        account = sub ? findAccount(state, sub.accountId) : null;
      }
    }
  }
  if (!account) {
    const hash = codeHash(q);
    if (hash) {
      const row = state.codes.find((c) => c.hash === hash);
      if (row) {
        const sub = state.subscriptions.find((s) => s.id === row.subscriptionId);
        account = sub ? findAccount(state, sub.accountId) : null;
      }
    }
  }
  if (!account) return null;
  return accountCard(state, account.id, now);
}

/** Full admin card: profile, subscription, codes, payments/promos/attempts. */
export function accountCard(state, accountId, now) {
  const account = findAccount(state, accountId);
  if (!account) return null;
  const sub = subscriptionView(state, account.id, now);
  const reveal = revealableCode(state, account.id);
  const codes = sub
    ? state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked).map((c) => ({
        id: c.id,
        plain: c.plain || '',
        deviceId: c.deviceId || '',
        boundAt: c.boundAt || 0,
        createdAt: c.createdAt || 0,
      }))
    : [];
  const payments = state.payments
    .filter((p) => resolvePaymentAccount(state, p.label).accountId === account.id)
    .slice(-30)
    .reverse();
  const promos = (state.promos || [])
    .flatMap((p) =>
      (p.uses || [])
        .filter((u) => u.accountId === account.id)
        .map((u) => ({ code: p.code, days: p.days, at: u.at, activation: u.code || '' })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 30);
  const deviceIds = new Set(
    []
      .concat(Array.isArray(account.linkedDevices) ? account.linkedDevices : [])
      .concat(codes.map((c) => c.deviceId).filter(Boolean)),
  );
  const attempts = state.attempts
    .filter((a) => a.deviceId && deviceIds.has(a.deviceId))
    .slice(-30)
    .reverse();
  return { account, sub, reveal, codes, payments, promos, attempts };
}

export function revokeCode(state, codeId) {
  return {
    ...state,
    codes: state.codes.map((c) => (c.id === codeId ? { ...c, revoked: true } : c)),
    sessions: state.sessions.filter((s) => s.codeId !== codeId),
  };
}

/**
 * Subscription as the bot, /v1/me and the panel show it.
 * `active` means access (paid or grace); `paid` is before paidUntil; `inGrace` is the grace period.
 * `deviceLimit` is the limit at `now` (included devices + extra slots that count), `baseLimit` the included ones.
 * A bound device over that limit has `overLimit` and gets no access until the slot is renewed.
 */
export function subscriptionView(state, accountId, now) {
  const sub = anySub(state, accountId);
  if (!sub) return null;
  const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
  const access = subAccess(state, sub, now);
  const extras = activeExtras(state, sub, now);
  return {
    id: sub.id,
    paidUntil: sub.paidUntil,
    active: access.access,
    paid: access.paid,
    inGrace: access.grace,
    accessUntil: access.accessUntil,
    graceDays: graceDays(state.settings),
    deviceLimit: deviceLimitNow(state, sub, now),
    baseLimit: Number(sub.deviceLimit) || 0,
    extraSlots: extras,
    extraUntil: extras ? Number(sub.extraUntil) || 0 : 0,
    devices: codes.map((c) => ({
      id: c.id,
      bound: !!c.deviceId,
      deviceId: c.deviceId,
      boundAt: c.boundAt,
      overLimit: !!c.deviceId && !codeWithinLimit(state, sub, c, now),
    })),
  };
}

const PURCHASE_CAP = 2000;

/** A checkout at the price configured now. The label is `buy:<id>`; later price changes do not rewrite it. */
/**
 * A checkout at the price configured now. The label is `buy:<id>`; later price changes do not rewrite it.
 * A renewal (`sub`) includes every extra slot that still counts (base + extra × slots) unless
 * `withExtras` is false. The quote keeps how many slots it paid for.
 */
export function quotePurchase(state, { kind, accountId, subscriptionId, now, withExtras }) {
  const at = now || Date.now();
  const prices = priceText(state.settings);
  if (kind !== 'new' && kind !== 'sub' && kind !== 'dev') return { state, result: { error: 'bad_label' } };
  let price = kind === 'dev' ? prices.extra : prices.price;
  if (!(price > 0)) return { state, result: { error: 'no_price' } };
  let extras = 0;
  if (kind === 'sub') {
    const sub = (state.subscriptions || []).find((s) => s.id === subscriptionId);
    if (sub) {
      const quote = renewalPrice(state, sub, at, { withExtras: withExtras !== false });
      price = quote.total;
      extras = quote.extras;
    }
  }
  const row = {
    id: randomId(),
    kind,
    accountId: accountId || '',
    subscriptionId: subscriptionId || '',
    price,
    extras,
    currency: '643',
    at,
  };
  const purchases = trimPurchases((state.purchases || []).concat([row]), state.payments);
  return { state: { ...state, purchases }, result: { label: 'buy:' + row.id, price, id: row.id, extras } };
}

/** Drop oldest paid quotes once the list is past the cap. Unpaid quotes stay: their payment link can still be used. */
function trimPurchases(purchases, payments) {
  if (purchases.length <= PURCHASE_CAP) return purchases;
  const paid = {};
  (payments || []).forEach((p) => {
    if (p.error) return;
    const label = String(p.label || '');
    if (label.indexOf('buy:') === 0) paid[label.slice(4)] = true;
  });
  const out = purchases.slice();
  let i = 0;
  while (out.length > PURCHASE_CAP && i < out.length) {
    if (paid[out[i].id]) out.splice(i, 1);
    else i += 1;
  }
  return out;
}

export function priceText(settings) {
  const days = settings.periodDays || 30;
  const price = Number(settings.priceRub) || 0;
  const extra = Number(settings.extraDeviceRub) || 0;
  return { days, price, extra };
}

/** Promo text: letters and digits, 4–24 chars. Shown as entered (uppercased). */
export function normalizePromo(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function createPromo(state, { code, days, maxUses, now }) {
  const plain = normalizePromo(code) || normalizeCode(randomCode());
  if (plain.length < 4 || plain.length > 24) return { state, result: { error: 'bad_promo' } };
  if (state.promos.some((p) => !p.revoked && p.code === plain)) return { state, result: { error: 'exists' } };
  const row = {
    id: randomId(),
    code: plain,
    days: days > 0 ? Math.floor(days) : 1,
    maxUses: maxUses > 0 ? Math.floor(maxUses) : 1,
    createdAt: now,
    revoked: false,
    uses: [],
  };
  return { state: { ...state, promos: state.promos.concat([row]) }, result: { promo: row } };
}

/** Create `count` promo codes (max 100). A custom code is used only when count is 1. */
export function createPromos(state, { count, code, days, maxUses, now }) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
  let cur = state;
  const promos = [];
  for (let i = 0; i < n; i++) {
    const out = createPromo(cur, {
      code: n === 1 ? code : '',
      days,
      maxUses,
      now: (now || Date.now()) + i,
    });
    if (out.result.error) return { state: cur, result: { error: out.result.error, promos } };
    cur = out.state;
    promos.push(out.result.promo);
  }
  return { state: cur, result: { promos } };
}

export function revokePromo(state, promoId) {
  return {
    ...state,
    promos: state.promos.map((p) => (p.id === promoId ? { ...p, revoked: true } : p)),
  };
}

/**
 * Redeems a promo in the bot: +days on the subscription (or a new one) and a fresh device activation code.
 * The same account cannot redeem the same promo twice.
 */
export function redeemPromo(state, { code, accountId, now }) {
  const plain = normalizePromo(code);
  if (!plain || !findAccount(state, accountId)) return { state, result: { error: 'bad_promo' } };
  const promo = state.promos.find((p) => !p.revoked && p.code === plain);
  if (!promo) return { state, result: { error: 'bad_promo' } };
  if (promo.uses.some((u) => u.accountId === accountId)) return { state, result: { error: 'already' } };
  if (promo.uses.length >= promo.maxUses) return { state, result: { error: 'exhausted' } };

  const existing = anySub(state, accountId);
  let next = state;
  let subscriptionId = '';
  let activationCode = '';
  let paidUntil = 0;
  let limitHit = false;

  if (existing) {
    const extended = extendGift(next, existing, promo.days, now);
    paidUntil = extended.paidUntil;
    const subscriptions = next.subscriptions.map((s) => (s.id === existing.id ? extended : s));
    const slot = slotCode({ ...next, subscriptions }, existing, now);
    next = slot.state;
    subscriptionId = existing.id;
    activationCode = slot.code;
    limitHit = slot.limit;
  } else {
    const created = createSubscription(next, { accountId, now, days: promo.days });
    next = created.state;
    subscriptionId = created.result.subscriptionId;
    activationCode = created.result.code;
    paidUntil = created.result.paidUntil;
  }

  const use = { accountId, at: now, subscriptionId, code: activationCode };
  const promos = next.promos.map((p) => (p.id === promo.id ? { ...p, uses: p.uses.concat([use]) } : p));
  return {
    state: { ...next, promos },
    result: { kind: 'promo', code: activationCode, paidUntil, days: promo.days, promoCode: promo.code, limitReached: limitHit },
  };
}

/** UTC ms of 00:00 Moscow time on the Moscow calendar day of `ms`. */
export function mskDayStart(ms) {
  const local = Number(ms) + MSK_OFFSET;
  return local - (((local % DAY) + DAY) % DAY) - MSK_OFFSET;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 19.10.2026 (Moscow calendar day). */
export function mskDate(ms) {
  const d = new Date(Number(ms) + MSK_OFFSET);
  return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}

/** 15:00 (Moscow time). */
export function mskTime(ms) {
  const d = new Date(Number(ms) + MSK_OFFSET);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/** 19.10.2026 15:00 МСК */
export function mskDateTime(ms) {
  return mskDate(ms) + ' ' + mskTime(ms) + ' МСК';
}

/** Days before the Moscow expiry day: 3 days before, the day before, and the expiry day itself. */
export const REMINDER_OFFSETS = { d3: 3, d1: 1, d0: 0 };
/** A reminder goes out from 10:00 MSK on its day until the end of that day; a missed day is skipped. */
export const REMINDER_HOUR = 10;
/** The «grace ended» notice stays due at least this long after its time, so a 23:59 end is not missed. */
export const END_WINDOW_MS = 60 * 60 * 1000;
/** Telegram failures before a reminder is given up for this expiry date. */
export const REMINDER_TRIES = 3;

/**
 * Reminders due at `now`, at most one per kind and expiry date.
 * Only accounts with Telegram, only their main subscription (the one that lasts longest).
 * A reminder whose time came before the subscription was last extended or created is skipped,
 * so a 1-day promo does not get «завтра» right after it was taken.
 * Plus one «end» notice when access is over (paidUntil + grace), see below.
 * @returns {{ subscriptionId, accountId, telegramId, kind: 'd3'|'d1'|'d0'|'end', paidUntil }[]}
 */
export function dueReminders(state, now) {
  const out = [];
  const accounts = state.accounts || [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (!account || !account.telegramId) continue;
    const sub = anySub(state, account.id);
    if (!sub || !(Number(sub.paidUntil) > 0)) continue;
    const expiryDay = mskDayStart(sub.paidUntil);
    const started = Number(sub.extendedAt || sub.createdAt || 0);
    const mark = sub.reminders && sub.reminders.until === sub.paidUntil ? sub.reminders : null;
    const kinds = Object.keys(REMINDER_OFFSETS);
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const day = expiryDay - REMINDER_OFFSETS[kind] * DAY;
      const dueAt = day + REMINDER_HOUR * 60 * 60 * 1000;
      if (now < dueAt || now >= day + DAY) continue;
      if (started > dueAt) continue;
      if (kind === 'd0' ? !subAccess(state, sub, now).access : !(sub.paidUntil > now)) continue;
      if (mark && mark.sent && mark.sent[kind]) continue;
      out.push({ subscriptionId: sub.id, accountId: account.id, telegramId: String(account.telegramId), kind, paidUntil: sub.paidUntil });
    }
    // «end»: access is over (grace ended). From 10:00 MSK on that Moscow day, or right away when it ended later.
    const endAt = accessUntil(state, sub);
    const endDay = mskDayStart(endAt);
    const endDue = Math.max(endAt, endDay + REMINDER_HOUR * 60 * 60 * 1000);
    // Until the end of that day; a late-evening end still gets END_WINDOW_MS of ticks.
    const endStop = Math.max(endDay + DAY, endDue + END_WINDOW_MS);
    if (now >= endDue && now < endStop && !(mark && mark.sent && mark.sent.end)) {
      out.push({ subscriptionId: sub.id, accountId: account.id, telegramId: String(account.telegramId), kind: 'end', paidUntil: sub.paidUntil });
    }
  }
  return out;
}

function reminderMark(sub, paidUntil) {
  const prev = sub.reminders && sub.reminders.until === paidUntil ? sub.reminders : null;
  return {
    until: paidUntil,
    sent: { ...((prev && prev.sent) || {}) },
    tries: { ...((prev && prev.tries) || {}) },
  };
}

/** Remember that reminder `kind` for this expiry date went out (it is claimed before sending). */
export function markReminder(state, { subscriptionId, kind, paidUntil, now }) {
  const subscriptions = (state.subscriptions || []).map((s) => {
    if (s.id !== subscriptionId || s.paidUntil !== paidUntil) return s;
    const mark = reminderMark(s, paidUntil);
    mark.sent[kind] = now || Date.now();
    return { ...s, reminders: mark };
  });
  return { ...state, subscriptions };
}

/** Telegram did not take the message: free the claim for a retry, up to REMINDER_TRIES. */
export function releaseReminder(state, { subscriptionId, kind, paidUntil }) {
  const subscriptions = (state.subscriptions || []).map((s) => {
    if (s.id !== subscriptionId || !s.reminders || s.reminders.until !== paidUntil) return s;
    const mark = reminderMark(s, paidUntil);
    mark.tries[kind] = (Number(mark.tries[kind]) || 0) + 1;
    if (mark.tries[kind] < REMINDER_TRIES) delete mark.sent[kind];
    return { ...s, reminders: mark };
  });
  return { ...state, subscriptions };
}

export { liveSub };
