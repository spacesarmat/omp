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
  const codes = state.codes.map((c) =>
    c.id === row.id && !c.deviceId ? { ...c, deviceId, boundAt: now, plain: '' } : c.id === row.id ? { ...c, plain: '' } : c,
  );
  const token = randomId() + randomId();
  const sessions = state.sessions.filter((s) => s.codeId !== row.id).concat([{ codeId: row.id, hash: sha256(token), createdAt: now }]);
  let next = attempt({ ...state, codes, sessions }, { at: now, hash, deviceId, ok: true, reason: 'ok' });
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

const WEBHOOK_CAP = 200;

export function logWebhook(state, row) {
  const webhooks = (state.webhooks || []).concat([row]).slice(-WEBHOOK_CAP);
  return { ...state, webhooks };
}

const AUDIT_CAP = 200;

/** Append an admin panel action (password change, grant, unbind, …). */
export function logAudit(state, { action, detail, now }) {
  const row = { at: now || Date.now(), action: String(action || ''), detail: String(detail || '') };
  const audit = (state.audit || []).concat([row]).slice(-AUDIT_CAP);
  return { ...state, audit };
}

export function applyPayment(state, { operationId, label, amount, now }) {
  if (!operationId || seenPayment(state, operationId)) {
    return {
      state: logWebhook(state, { kind: 'duplicate', operationId: operationId || '', label: label || '', amount: amount || '', at: now }),
      result: { duplicate: true },
    };
  }
  const mark = String(label || '');
  const days = state.settings.periodDays || 30;
  const row = { operationId, label: mark, amount, at: now };

  if (mark.indexOf('sub:') === 0) {
    const id = mark.slice(4);
    const sub = state.subscriptions.find((s) => s.id === id);
    if (!sub) {
      const payments = state.payments.concat([{ ...row, error: 'bad_label' }]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    const subscriptions = state.subscriptions.map((s) => {
      if (s.id !== id) return s;
      const from = Math.max(s.paidUntil, now);
      return { ...s, paidUntil: from + days * DAY };
    });
    const next = subscriptions.find((s) => s.id === id);
    return {
      state: { ...state, payments: state.payments.concat([row]), subscriptions },
      result: { kind: 'renew', subscriptionId: id, paidUntil: next ? next.paidUntil : 0 },
    };
  }
  if (mark.indexOf('dev:') === 0) {
    const id = mark.slice(4);
    if (!state.subscriptions.find((s) => s.id === id)) {
      const payments = state.payments.concat([{ ...row, error: 'bad_label' }]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    const subscriptions = state.subscriptions.map((s) => (s.id === id ? { ...s, deviceLimit: s.deviceLimit + 1 } : s));
    const issued = issue({ ...state, payments: state.payments.concat([row]), subscriptions }, id, now);
    return { state: issued.state, result: { kind: 'device', subscriptionId: id, code: issued.code } };
  }
  if (mark.indexOf('new:') === 0) {
    const accountId = mark.slice(4);
    if (!findAccount(state, accountId)) {
      const payments = state.payments.concat([{ ...row, error: 'bad_label' }]);
      return { state: { ...state, payments }, result: { error: 'bad_label' } };
    }
    const base = { ...state, payments: state.payments.concat([row]) };
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
  const payments = state.payments.concat([{ ...row, error: 'bad_label' }]);
  return { state: { ...state, payments }, result: { error: 'bad_label' } };
}

function money(amount) {
  const n = Number(String(amount || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function resolvePaymentAccount(state, label) {
  const mark = String(label || '');
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
    problems.push({
      at: p.at || 0,
      kind: err,
      text: (p.amount || '') + ' · ' + (p.label || '') + ' · ' + (p.operationId || '').slice(0, 12),
      operationId: p.operationId || '',
    });
  }
  for (let i = 0; i < (state.webhooks || []).length; i++) {
    const w = state.webhooks[i];
    problems.push({
      at: w.at || 0,
      kind: w.kind || 'webhook',
      text: (w.amount || '') + ' · ' + (w.label || '') + ' · ' + String(w.operationId || '').slice(0, 12),
      operationId: w.operationId || '',
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
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    lines.push(
      [
        cell(new Date(p.at).toISOString()),
        cell(p.amount),
        cell(p.label),
        cell(p.operationId),
        cell(resolved.accountId || ''),
        cell(acc ? acc.telegramId || '' : ''),
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

const ADMIN_LOGIN_TTL = 5 * 60 * 1000;

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

export function confirmAdminPanelLogin(state, { token, telegramId, now }) {
  const key = String(token || '')
    .trim()
    .toLowerCase();
  if (!key) return { state, result: { error: 'bad_link' } };
  if (!isAdminChat(state.settings, telegramId)) {
    const adminLogins = (state.adminLogins || []).map((l) =>
      l.token === key && !l.consumedAt && l.expiresAt > now ? { ...l, deniedAt: now, telegramId: String(telegramId) } : l,
    );
    return { state: { ...state, adminLogins }, result: { error: 'forbidden' } };
  }
  const row = (state.adminLogins || []).find((l) => l.token === key && !l.consumedAt && l.expiresAt > now);
  if (!row) return { state, result: { error: 'bad_link' } };
  if (row.deniedAt) return { state, result: { error: 'forbidden' } };
  const adminLogins = state.adminLogins.map((l) =>
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
  const stillLinked = linked.length > 0;
  // If no devices left on this TG account, clear telegramId so the phone can re-bind cleanly.
  const nextAccounts = stillLinked
    ? accounts
    : accounts.map((a) => (a.id === account.id ? { ...a, telegramId: '', telegramUsername: '', telegramName: '' } : a));
  return {
    state: logAudit(
      { ...state, accounts: nextAccounts },
      { action: 'tg_unlink', detail: account.id + ' ' + deviceId.slice(0, 8), now: now || Date.now() },
    ),
    result: { ok: true, telegramId: stillLinked ? account.telegramId || '' : '' },
  };
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
    const from = Math.max(existing.paidUntil, now);
    const paidUntil = from + n * DAY;
    const subscriptions = cur.subscriptions.map((s) => (s.id === existing.id ? { ...s, paidUntil } : s));
    const issued = issue({ ...cur, subscriptions }, existing.id, now);
    return {
      state: issued.state,
      result: { kind: 'grant', code: issued.code, paidUntil, days: n, accountId: account.id },
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

/**
 * Home dashboard: recent events + operational alerts.
 * @returns {{ events: { at, kind, text, accountId }[], alerts: { level, text }[] }}
 */
export function adminDashboard(state, now) {
  const events = [];
  for (let i = 0; i < state.payments.length; i++) {
    const p = state.payments[i];
    const label = String(p.label || '');
    let accountId = '';
    if (label.indexOf('new:') === 0) accountId = label.slice(4);
    else if (label.indexOf('sub:') === 0 || label.indexOf('dev:') === 0) {
      const sub = state.subscriptions.find((s) => s.id === label.slice(4));
      accountId = sub ? sub.accountId : '';
    }
    events.push({
      at: p.at || 0,
      kind: 'pay',
      text: 'Оплата ' + (p.amount || '') + ' · ' + label,
      accountId,
    });
  }
  for (let i = 0; i < (state.promos || []).length; i++) {
    const promo = state.promos[i];
    for (let u = 0; u < (promo.uses || []).length; u++) {
      const use = promo.uses[u];
      events.push({
        at: use.at || 0,
        kind: 'promo',
        text: 'Промо ' + promo.code + ' (+' + promo.days + ' дн.)',
        accountId: use.accountId || '',
      });
    }
  }
  for (let i = 0; i < state.attempts.length; i++) {
    const a = state.attempts[i];
    if (a.ok) {
      const code = state.codes.find((c) => c.deviceId === a.deviceId);
      const sub = code ? state.subscriptions.find((s) => s.id === code.subscriptionId) : null;
      events.push({
        at: a.at || 0,
        kind: 'activate',
        text: 'Активация · устройство ' + String(a.deviceId || '').slice(0, 8) + '…',
        accountId: sub ? sub.accountId : '',
      });
    } else {
      events.push({
        at: a.at || 0,
        kind: 'fail',
        text: 'Отказ: ' + (a.reason || '?') + ' · ' + String(a.deviceId || '').slice(0, 8) + '…',
        accountId: '',
      });
    }
  }
  events.sort((a, b) => b.at - a.at);
  const feed = events.slice(0, 40);

  const alerts = [];
  const s = state.settings || {};
  if (!s.botToken) alerts.push({ level: 'bad', text: 'Не задан токен бота Telegram' });
  if (!s.jackettUrl) alerts.push({ level: 'bad', text: 'Не задан адрес Jackett' });
  if (!s.jackettApiKey) alerts.push({ level: 'bad', text: 'Не задан API-ключ Jackett' });
  if (!s.jacredUrl) alerts.push({ level: 'warn', text: 'Не задан адрес JacRed' });
  if (!s.jacredApiKey) alerts.push({ level: 'warn', text: 'Не задан API-ключ JacRed' });
  if (Number(s.priceRub) > 0 && !s.yoomoneyWallet) alerts.push({ level: 'bad', text: 'Цена задана, но кошелёк ЮMoney пуст' });
  if (!s.publicOrigin) alerts.push({ level: 'warn', text: 'publicOrigin пуст — ссылки «Открыть в OMP» в боте без http' });
  if (!String(s.adminTelegramIds || '').trim()) {
    alerts.push({ level: 'warn', text: 'Нет adminTelegramIds — вход в панель и админ-кабинет в боте недоступны' });
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
  const subIds = state.subscriptions.filter((s) => s.accountId === account.id).map((s) => s.id);
  const payments = state.payments
    .filter((p) => {
      const label = String(p.label || '');
      return label.indexOf(account.id) >= 0 || subIds.some((id) => label.indexOf(id) >= 0);
    })
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

  if (existing) {
    const from = Math.max(existing.paidUntil, now);
    paidUntil = from + promo.days * DAY;
    const subscriptions = next.subscriptions.map((s) => (s.id === existing.id ? { ...s, paidUntil } : s));
    const issued = issue({ ...next, subscriptions }, existing.id, now);
    next = issued.state;
    subscriptionId = existing.id;
    activationCode = issued.code;
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
    result: { kind: 'promo', code: activationCode, paidUntil, days: promo.days, promoCode: promo.code },
  };
}

export { liveSub };
