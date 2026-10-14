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

export function isAdminChat(settings, chatId) {
  const raw = String((settings && settings.adminTelegramIds) || '');
  if (!raw.trim()) return false;
  const id = String(chatId);
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => s === id);
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
  if (Number(s.priceRub) > 0 && !s.yoomoneyWallet) alerts.push({ level: 'bad', text: 'Цена задана, но кошелёк ЮMoney пуст' });
  if (!s.publicOrigin) alerts.push({ level: 'warn', text: 'publicOrigin пуст — ссылки «Открыть в OMP» в боте без http' });
  if (!String(s.adminTelegramIds || '').trim()) alerts.push({ level: 'warn', text: 'Нет adminTelegramIds — админ-кабинет в боте недоступен' });

  const soon = now + 2 * DAY;
  const expiring = state.subscriptions.filter((sub) => sub.paidUntil > now && sub.paidUntil <= soon);
  for (let i = 0; i < expiring.length; i++) {
    const sub = expiring[i];
    const acc = findAccount(state, sub.accountId);
    const who = acc ? acc.telegramId || acc.email || acc.id : sub.accountId;
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
