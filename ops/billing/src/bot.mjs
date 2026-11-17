import { CRYPTO_ASSETS } from './cryptoPay.mjs';
import { applyBuilt, copyText, escapeHtml, normalizeLang, pickVariant, str, subscriptionCopyState } from './botCopy.mjs';
import { customRowsSync, hasCustomSync } from './botCopyStore.mjs';
import { donateMenu, donateOnCallback, donateOnText } from './donate.mjs';
import { capReferralOff, referralCodeFor } from './referralAdmin.mjs';
import { cryptoOffered, labelSettled, starBlurb, starInvoiceBody, starsOffered } from './payMethods.mjs';
import { payUrl } from './yoomoney.mjs';
import { sha256 } from './crypto.mjs';
import { selfUnbind, swapStatus } from './deviceAdmin.mjs';
import {
  accountByTelegram,
  adminFind,
  adminSummary,
  appSchemeUrl,
  adminChatIds,
  appendSupportMessage,
  confirmAdminPanelLogin,
  isPanelReader,
  confirmDeviceLink,
  createPromo,
  baseDevices,
  deviceCode,
  ensureTelegramAccount,
  formatCode,
  graceDays,
  mskDate,
  mskDateTime,
  mskTime,
  rememberTelegramProfile,
  renewalPrice,
  telegramDisplay,
  grantDays,
  isAdminChat,
  lapsingExtras,
  mainSubscription,
  openAppUrl,
  pendingDeviceLink,
  priceText,
  quotePurchase,
  referralDiscountOf,
  redeemPromo,
  redeemReferralCode,
  subscriptionView,
  supportReplyTarget,
} from './logic.mjs';

/** «до 2 телефонов» / "up to 2 phones". */
function upToPhones(state, lang) {
  const n = baseDevices(state && state.settings);
  if (lang === 'en') return 'up to ' + n + (n === 1 ? ' phone' : ' phones');
  return 'до ' + n + (n === 1 ? ' телефона' : ' телефонов');
}

/** «+30 дней» / «+1 устройство навсегда» / both. */
function promoText(p, lang) {
  const parts = [];
  if (p.days) parts.push('+' + daysText(p.days, lang));
  if (p.bonusSlots) {
    const slots = lang === 'en' ? p.bonusSlots + (p.bonusSlots === 1 ? ' device' : ' devices') : p.bonusSlots + ' устр.';
    parts.push('+' + slots + ' ' + (p.bonusDays ? (lang === 'en' ? 'for ' : 'на ') + daysText(p.bonusDays, lang) : str('promo.bonus_forever', lang)));
  }
  return parts.join(', ');
}

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

/** Rubles with kopecks when they are not zero: 151,50 ₽ or 150 ₽. */
function moneyRub(n) {
  const kop = Math.round(Number(n) * 100);
  if (!Number.isFinite(kop)) return '0 ₽';
  const neg = kop < 0;
  const v = Math.abs(kop);
  const whole = Math.floor(v / 100);
  const frac = v % 100;
  return (neg ? '-' : '') + whole + (frac ? ',' + String(frac).padStart(2, '0') : '') + ' ₽';
}

/** Reply keyboard labels (RU). Kept as constants for parseAction aliases and existing callers. */
export const BTN = {
  cabinet: 'Кабинет',
  /** Buy when there is no subscription, renew otherwise. */
  pay: 'Оплатить',
  /** Code for a free slot, the device list, unbind and one more device. */
  devices: 'Устройства',
  promo: 'Промокод',
  price: 'Цены',
  support: 'Поддержка',
  donate: 'Поддержать проект',
};

/** Labels of the old 8-button keyboard. Phones that still show it keep working. */
export const OLD_BTN = {
  buy: 'Подписка',
  renew: 'Продлить',
  code: 'Код',
  unlink: 'Отвязать',
};

export const ADMIN_BTN = {
  summary: 'Сводка',
  find: 'Найти',
  grant: 'Выдать дни',
  promo: 'Новый промо',
  /** Leave admin pad and use the same keyboard as a regular subscriber. */
  user: 'Как пользователь',
};

/** User pad — no admin entry so admins can test the subscriber flow as-is. `lang` picks the labels. */
export function mainKeyboard(lang) {
  return {
    keyboard: [
      [{ text: str('btn.cabinet', lang) }, { text: str('btn.pay', lang) }],
      [{ text: str('btn.devices', lang) }, { text: str('btn.promo', lang) }],
      [{ text: str('btn.price', lang) }, { text: str('btn.support', lang) }],
      [{ text: str('btn.donate', lang) }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function adminKeyboard(lang) {
  return {
    keyboard: [
      [{ text: str('btn.admin_summary', lang) }, { text: str('btn.admin_find', lang) }],
      [{ text: str('btn.admin_grant', lang) }, { text: str('btn.admin_promo', lang) }],
      [{ text: str('btn.admin_user', lang) }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Reason labels for a failed /start admin_ login. The token is never included. */
const ADMIN_LOGIN_FAIL_REASON = {
  unknown: 'unknown token',
  expired: 'expired',
  used: 'already used',
  wrong_user: 'wrong user',
};

export function adminLoginFailureLine(error) {
  const reason = ADMIN_LOGIN_FAIL_REASON[error] || 'unknown token';
  return 'admin login failed reason=' + reason + '\n';
}

/** Missing flag means on, so existing installs keep admin Telegram notices. */
export function adminNotifyEnabled(settings) {
  const v = settings && settings.adminNotify;
  return v !== false && v !== 'false' && v !== 0 && v !== '0';
}

export function adminBroadcast(settings, text) {
  if (!adminNotifyEnabled(settings)) return [];
  const body = String(text || '').trim();
  if (!body) return [];
  return adminChatIds(settings).map((chatId) => ({
    chatId,
    text: body,
    keyboard: adminKeyboard(),
  }));
}

const PAYMENT_ERROR_TEXT = {
  amount: 'сумма меньше цены',
  bad_label: 'неизвестная метка платежа',
  no_account: 'аккаунт не найден',
  no_subscription: 'подписка не найдена',
};

/** Russian reason for an admin notice; an unknown code is shown as is. */
export function paymentErrorText(error) {
  const key = String(error || '');
  return PAYMENT_ERROR_TEXT[key] || key || 'неизвестно';
}

export function paymentAdminNotices(settings, { ok, pending, amount, label, error, who }) {
  const sum = String(amount || '').trim();
  const mark = String(label || '').trim();
  const person = String(who || '').trim();
  const lines = [];
  if (ok) lines.push('✅ Новая оплата' + (sum ? ': ' + sum + ' ₽' : ''));
  else if (pending) {
    lines.push('⏳ Платёж' + (sum ? ' ' + sum + ' ₽' : '') + ' ждёт подтверждения. Подписка не продлена.');
    lines.push('Подтвердите в кошельке ЮMoney или кнопкой в панели.');
  } else {
    lines.push('Ошибка оплаты: ' + paymentErrorText(error));
    if (sum) lines.push('Сумма: ' + sum + ' ₽');
  }
  if (person) lines.push(person);
  if (mark) lines.push('Метка: ' + mark);
  return adminBroadcast(settings, lines.join('\n'));
}

/**
 * Notify when a configured service goes down. A repeat waits until it recovers.
 * @param prev map of service key → 'ok' | 'down' | 'skip'
 */
export function serviceDownNotices(settings, probes, prev) {
  const names = [
    ['jackett', 'Jackett'],
    ['jacred', 'JacRed'],
    ['bitmagnet', 'bitmagnet'],
    ['torrserver', 'TorrServer'],
  ];
  const snapshot = { ...(prev || {}) };
  const messages = [];
  const list = probes || {};
  for (let i = 0; i < names.length; i++) {
    const key = names[i][0];
    const label = names[i][1];
    const row = list[key];
    if (!row || !row.configured) {
      snapshot[key] = 'skip';
      continue;
    }
    const down = !row.ok;
    const was = snapshot[key];
    snapshot[key] = down ? 'down' : 'ok';
    if (down && was !== 'down') {
      const why = row.error ? ' (' + row.error + ')' : '';
      messages.push(...adminBroadcast(settings, 'Сервис недоступен: ' + label + why));
    }
  }
  return { snapshot, messages };
}

/* ---------- small text helpers ---------- */

/** 1 день, 3 дня, 30 дней. */
export function plural(n, one, few, many) {
  const a = Math.abs(Math.floor(Number(n) || 0));
  const d10 = a % 10;
  const d100 = a % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

export function daysText(n, lang) {
  if (lang === 'en') return n + ' ' + (Math.abs(Math.floor(Number(n) || 0)) === 1 ? 'day' : 'days');
  return n + ' ' + plural(n, 'день', 'дня', 'дней');
}

/** «смена/смены/смен» for a number of device changes; EN change/changes. */
function changesWord(n, lang) {
  if (lang === 'en') return Math.abs(Math.floor(Number(n) || 0)) === 1 ? 'change' : 'changes';
  return plural(n, 'смена', 'смены', 'смен');
}

function accountPaid(state, account) {
  if (!account) return false;
  return (state.payments || []).some((p) => p && p.accountId === account.id && !p.pending && !p.error);
}

/** Subscription state and stored language of a recipient, for notices sent outside a bot reply. */
export function copyRecipient(state, accountId, now) {
  const account = accountId ? (state.accounts || []).find((a) => a && a.id === accountId) || null : null;
  const sub = account ? subscriptionView(state, account.id, now || Date.now()) : null;
  return { state: subscriptionCopyState(sub, accountPaid(state, account)), lang: normalizeLang(account && account.lang) };
}

function spec(id, vars, state, lang, raw) {
  const copy = { id, vars: vars || {} };
  if (state !== undefined) copy.state = state;
  if (lang) copy.lang = lang;
  if (raw && raw.length) copy.raw = raw;
  return { copy };
}

function userVars(state, account, sub, now, extra, lang) {
  const prices = priceText(state.settings);
  const until = sub && sub.paidUntil ? Number(sub.paidUntil) : 0;
  const left = until > now ? Math.max(0, Math.ceil((until - now) / 86400000)) : 0;
  const base = {
    name: account ? telegramDisplay(account) || '' : '',
    days_left: String(left),
    expires_at: until ? mskDateTime(until, lang) : '',
    price: rub(prices.price),
    promo: trialPromo(state),
    ref_link: account ? referralCodeFor(account.id) : '',
    balance: sub && sub.credit > 0 ? rub(sub.credit) : '0 ₽',
    status: '',
    devices: sub ? devicesLine(sub, lang) : '',
    days: daysText(prices.days, lang),
    phones: upToPhones(state, lang),
    trial: trialLine(state, lang),
  };
  return Object.assign(base, extra || {});
}

function urlButton(text, url) {
  return url && String(url).indexOf('http') === 0 ? { text, url } : null;
}

function rows(list) {
  const out = list.filter((r) => r && r.length).map((r) => r.filter(Boolean)).filter((r) => r.length);
  return out.length ? { inline_keyboard: out } : null;
}

function codeButtonRow(origin, code, lang) {
  return [urlButton(str('btn.open_omp', lang), openAppUrl(origin, code))];
}

/**
 * Code for a new device, as shown in the bot and in payment messages (Markdown, code with a hyphen).
 * Without a public https origin the omp:// link is the only way to open the app, so it is shown.
 */
export function codeBlock(origin, code, head, lang) {
  const dashed = formatCode(code);
  const https = openAppUrl(origin, dashed).indexOf('http') === 0;
  return (
    (head || str('code.head_device', lang)) +
    ': `' +
    dashed +
    '`\n' +
    str('code.tap', lang) +
    (https ? str('code.or_button', lang) : ':\n' + appSchemeUrl(dashed))
  );
}

/** The same block for saved HTML replies: a tappable <code> instead of Markdown backticks.
 * Only the code itself is markup; it is [A-Z0-9-] by construction, the rest is plain text. */
export function codeBlockHtml(origin, code, head, lang) {
  const dashed = formatCode(code);
  const https = openAppUrl(origin, dashed).indexOf('http') === 0;
  return (
    (head || str('code.head_device', lang)) +
    ': <code>' +
    dashed +
    '</code>\n' +
    str('code.tap', lang) +
    (https ? str('code.or_button', lang) : ':\n' + appSchemeUrl(dashed))
  );
}

/** Public trial promo from settings, only while it exists and still has uses left. */
export function trialPromo(state) {
  const code = String((state && state.settings && state.settings.publicPromo) || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!code) return '';
  const promo = (state.promos || []).find((p) => !p.revoked && p.code === code);
  if (!promo || (promo.uses || []).length >= promo.maxUses) return '';
  return promo.code;
}

function trialLine(state, lang) {
  const code = trialPromo(state);
  return code ? str('trial.line', lang, { code }) : '';
}

/** Maps a button label or /command to an internal action. RU and EN labels are both accepted. */
export function parseAction(text) {
  const raw = String(text || '').trim();
  if (!raw) return { action: 'cabinet', arg: '' };
  const parts = raw.split(/\s+/);
  // «/Start@OMPBILLINGBOT» → «/start»
  const head = parts[0].charAt(0) === '/' ? parts[0].toLowerCase().replace(/@\w+$/, '') : parts[0];
  const rest = parts.slice(1).join(' ').trim();
  const low = rest.toLowerCase();

  if (head === '/start' && rest) {
    if (low.indexOf('link_') === 0) return { action: 'link', arg: rest.slice(5) };
    if (low.indexOf('admin_') === 0) return { action: 'admin_login', arg: rest.slice(6) };
    if (low === 'renew' || low === 'pay') return { action: 'pay', arg: '' };
    if (low === 'devices') return { action: 'devices', arg: '' };
    if (low.indexOf('support') === 0) return { action: 'support', arg: rest.slice('support'.length).trim() };
    // Any other payload (an old or mistyped link) opens the cabinet.
    return { action: 'cabinet', arg: '' };
  }
  const cmd = rest ? '' : head;
  const is = (...names) => names.indexOf(raw) >= 0 || (cmd && names.indexOf(cmd) >= 0);
  if (is(BTN.cabinet, str('btn.cabinet', 'en'), '/status', '/start', '/menu', '/cabinet')) return { action: 'cabinet', arg: '' };
  if (is(BTN.pay, str('btn.pay', 'en'), OLD_BTN.buy, str('btn.buy', 'en'), OLD_BTN.renew, str('btn.renew', 'en'), '/pay', '/buy', '/renew')) return { action: 'pay', arg: '' };
  if (is(BTN.devices, str('btn.devices', 'en'), OLD_BTN.code, str('btn.code', 'en'), OLD_BTN.unlink, str('btn.unlink', 'en'), '/code', '/device', '/devices', '/unlink')) return { action: 'devices', arg: '' };
  if (is(BTN.promo, str('btn.promo', 'en'), '/promo')) return { action: 'promo', arg: '' };
  if (is(BTN.price, str('btn.price', 'en'), '/price', '/prices')) return { action: 'price', arg: '' };
  if (is(BTN.support, str('btn.support', 'en'), '/support')) return { action: 'support', arg: '' };
  if (is(BTN.donate, str('btn.donate', 'en'), '/donate')) return { action: 'donate', arg: '' };
  if (is('/admin', 'Админ')) return { action: 'admin', arg: '' };
  if (is(ADMIN_BTN.user, str('btn.admin_user', 'en'), '/user', 'В кабинет')) return { action: 'user_mode', arg: '' };
  if (is(ADMIN_BTN.summary, str('btn.admin_summary', 'en'), '/summary')) return { action: 'admin_summary', arg: '' };
  if (is(ADMIN_BTN.find, str('btn.admin_find', 'en'), '/find')) return { action: 'admin_find', arg: '' };
  if (is(ADMIN_BTN.grant, str('btn.admin_grant', 'en'), '/grant')) return { action: 'admin_grant', arg: '' };
  if (raw === ADMIN_BTN.promo || raw === str('btn.admin_promo', 'en')) return { action: 'admin_promo', arg: '' };

  if (head === '/promo' && rest) return { action: 'promo', arg: rest.replace(/\s+/g, '') };
  if (head === '/support' && rest) return { action: 'support', arg: rest };
  if (head === '/find' && rest) return { action: 'admin_find', arg: rest };
  if (head === '/grant' && rest) return { action: 'admin_grant', arg: rest };
  if (head === '/admin_promo' && rest) return { action: 'admin_promo', arg: rest };
  return { action: 'unknown', arg: raw };
}

/** «Устройства: 3 из 4 (2 базовых + 1 бонусный (навсегда) + 1 купленный до 18.11.2026)»; a plain base: «1 из 2». */
function devicesLine(sub, lang) {
  const used = sub.devices.filter((d) => d.bound).length;
  let line = str('dev.line', lang, { used, limit: sub.deviceLimit });
  const limit = sub.limit;
  if (limit && !limit.plain) line += ' (' + limit.text + (limit.extra > 0 ? ' ' + str('lim.until', lang, { date: mskDate(limit.extraUntil) }) : '') + ')';
  return line;
}

function creditLine(sub, lang) {
  return sub && sub.credit > 0 ? str('sub.credit', lang, { amount: rub(sub.credit) }) : '';
}

/** Subscription head line(s): paid, grace period, or ended. Times are Moscow time. */
export function subscriptionHead(sub, lang) {
  if (sub.inGrace) {
    return str('sub.grace', lang, { when: mskDateTime(sub.paidUntil, lang), access: mskDateTime(sub.accessUntil, lang) });
  }
  if (sub.active) return str('sub.until', lang, { when: mskDateTime(sub.paidUntil, lang) });
  return str('sub.ended', lang, { when: mskDateTime(sub.paidUntil, lang) });
}

function freeSlots(sub) {
  if (!sub) return 0;
  const bound = sub.devices.filter((d) => d.bound).length;
  const unboundCodes = sub.devices.filter((d) => !d.bound).length;
  return Math.max(unboundCodes, sub.deviceLimit - bound);
}

/**
 * Cabinet text. `admin` drops the «what next» hints and lists the device prefixes instead.
 */
function statusText(state, sub, account, opts) {
  const admin = !!(opts && opts.admin);
  const lang = (opts && opts.lang) || '';
  const prices = priceText(state.settings);
  const tg = account && account.telegramId ? 'Telegram: ' + (telegramDisplay(account) || account.telegramId) + '\n' : '';
  if (!sub) {
    return (
      tg +
      str('sub.none', lang) +
      (admin
        ? ''
        : str('sub.none_hint', lang, { price: rub(prices.price), days: daysText(prices.days, lang), phones: upToPhones(state, lang) }) + trialLine(state, lang))
    );
  }
  const bound = sub.devices.filter((d) => d.bound);
  const list = admin && bound.length ? str('sub.bound_list', lang, { list: bound.map((d) => (d.deviceId || '').slice(0, 8) + '…').join(', ') }) : '';
  if (!sub.active) {
    return (
      tg +
      subscriptionHead(sub, lang) +
      (bound.length ? str('sub.bound_count', lang, { n: bound.length }) : '') +
      creditLine(sub, lang) +
      list +
      (admin ? '' : str('sub.pay_hint', lang))
    );
  }
  let next = '';
  if (!admin) {
    if (sub.inGrace) next = str('sub.hint_grace', lang);
    else if (freeSlots(sub) > 0) next = str('sub.hint_free', lang);
    else next = str('sub.hint_full', lang, { extra: prices.extra ? str('sub.hint_full_extra', lang, { price: rub(prices.extra) }) : '' });
  }
  return tg + subscriptionHead(sub, lang) + '\n' + devicesLine(sub, lang) + creditLine(sub, lang) + list + next;
}

/**
 * Renewal breakdown for the bot: base + extra slots that still count, minus credit.
 * "Продление на 30 дней, до 18.11.2026 12:00 МСК: подписка - 150 ₽, доп. устройство x 1 - 50 ₽, итого 200 ₽"
 */
export function renewalText(state, subRow, sub, now, opts) {
  const lang = normalizeLang(opts && opts.lang);
  const quote = renewalPrice(state, subRow, now, opts);
  const priced = capReferralOff(quote.total, referralDiscountOf(state, subRow && subRow.accountId, quote.base, now));
  const off = priced.off;
  const from = sub.active ? sub.paidUntil : now;
  const until = from + quote.days * 86400000;
  const lines = [str('ren.head', lang, { days: daysText(quote.days, lang), when: mskDateTime(until, lang) })];
  lines.push(str('ren.sub_line', lang, { price: rub(quote.base) }));
  if (off > 0) lines.push(str('ren.discount_line', lang, { off: rub(off) }));
  if (quote.extras > 0) lines.push(str('ren.extra_line', lang, { n: quote.extras, sum: rub(quote.extraSum) }));
  if (quote.credit > 0) lines.push(str('ren.credit_line', lang, { amount: rub(quote.credit) }));
  if (quote.extras > 0 || quote.credit > 0 || off > 0) lines.push(str('ren.total', lang, { amount: rub(priced.due) }));
  const text = lines.join('\n');
  const rows = customRowsSync('renewal.quote');
  const account = subRow ? (state.accounts || []).find((a) => a && a.id === subRow.accountId) || null : null;
  const saved = rows ? pickVariant(rows, subscriptionCopyState(sub, accountPaid(state, account)), lang) : null;
  if (!saved) return { text, quote };
  const applied = applyBuilt(saved, { text }, {
    days: daysText(quote.days, lang),
    expires_at: mskDateTime(until, lang),
    price: rub(quote.base),
    discount_line: off > 0 ? str('ren.discount_line', lang, { off: rub(off) }) + '\n' : '',
    extra_line: quote.extras > 0 ? str('ren.extra_line', lang, { n: quote.extras, sum: rub(quote.extraSum) }) + '\n' : '',
    credit_line: quote.credit > 0 ? str('ren.credit_line', lang, { amount: rub(quote.credit) }) + '\n' : '',
    total_line: quote.extras > 0 || quote.credit > 0 || off > 0 ? str('ren.total', lang, { amount: rub(priced.due) }) : '',
    total: rub(priced.due),
    balance: rub(quote.credit),
  });
  if (applied.used !== 'template') return { text, quote };
  // The fragment is rendered HTML: the host message must keep that parse mode.
  return { text: applied.text, quote, parseMode: 'HTML' };
}

function withInviteOff(state, subRow, quote, now) {
  if (!quote) return quote;
  const priced = capReferralOff(quote.total, referralDiscountOf(state, subRow && subRow.accountId, quote.base, now));
  if (!(priced.off > 0)) return quote;
  return { ...quote, total: priced.due, referralOff: priced.off };
}

function renewalPriceLine(quote, lang) {
  const bits = [];
  if (quote.extras > 0) bits.push(str('ren.bit_sub', lang, { base: rub(quote.base), extra: rub(quote.extraRub), n: quote.extras }));
  if (quote.credit > 0) bits.push(str('ren.bit_credit', lang, { amount: rub(quote.credit) }));
  if (quote.referralOff > 0) bits.push(str('ren.bit_discount', lang, { off: rub(quote.referralOff) }));
  return str('ren.price_line', lang, { days: daysText(quote.days, lang), total: rub(quote.total), bits: bits.length ? ' (' + bits.join(', ') + ')' : '' });
}

function payInline(settings, lang) {
  return { inline_keyboard: [[{ text: str('btn.pay', lang), url: botDeepLink(settings, 'pay') }]] };
}

/**
 * One-time notice when access is over (the grace period ended, or the subscription with graceDays 0).
 * The renewal brings back the extra slots that lapsed with the subscription (same price as before).
 */
function graceEndMessage(state, row, subRow, grace, now) {
  const rec = copyRecipient(state, (accountByTelegram(state, row.telegramId) || {}).id, now);
  const lang = rec.lang;
  const lines = [grace > 0 ? str('rem.grace_end_grace', lang) : str('rem.grace_end_sub', lang)];
  const quote = subRow ? withInviteOff(state, subRow, renewalPrice(state, subRow, now), now) : null;
  if (quote && quote.base > 0) {
    lines.push(renewalPriceLine(quote, lang));
    lines.push(str('rem.devices_auto', lang));
    if (quote.extras > 0) lines.push(str('rem.without_extra', lang, { amount: rub(withInviteOff(state, subRow, renewalPrice(state, subRow, now, { withExtras: false }), now).total) }));
  } else {
    lines.push(str('rem.renew_continue', lang));
  }
  lines.push(str('rem.pay_hint', lang));
  const priceLine = quote && quote.base > 0 ? renewalPriceLine(quote, lang) : '';
  return {
    chatId: String(row.telegramId),
    text: lines.join('\n'),
    keyboard: mainKeyboard(lang),
    inline: payInline(state.settings, lang),
    ...spec('pay.grace_end', { head: lines[0].replace(/^⚠️ /, ''), renewal: priceLine, price: '' }, rec.state, rec.lang),
  };
}

/**
 * Telegram reminder before / on the expiry day. `row` comes from dueReminders.
 * @returns {{ chatId, text, keyboard, inline }}
 */
export function reminderMessage(state, row, now) {
  const subRow = (state.subscriptions || []).find((s) => s.id === row.subscriptionId);
  const grace = graceDays(state.settings);
  const until = row.paidUntil;
  const accessEnd = until + grace * 86400000;
  if (row.kind === 'end') return graceEndMessage(state, row, subRow, grace, now);
  const rec = copyRecipient(state, (accountByTelegram(state, row.telegramId) || {}).id, now);
  const lang = rec.lang;
  const whenVar = str('rem.when_var', lang, { time: mskTime(until) });
  const expiresVar = str('rem.expires_var', lang, { date: mskDate(until), time: mskTime(until) });
  let head = '';
  if (row.kind === 'd3') head = str('rem.d3', lang, { when: expiresVar });
  else if (row.kind === 'd1') head = str('rem.d1', lang, { when: expiresVar });
  else if (until > now) {
    head = str('rem.today', lang, { when: whenVar });
    if (grace > 0) head += str('rem.grace_after', lang, { days: daysText(grace, lang), when: mskDateTime(accessEnd, lang) });
  } else {
    head = str('rem.ended', lang, { when: whenVar });
    if (grace > 0) head += str('rem.grace_now', lang, { when: mskDateTime(accessEnd, lang) });
  }
  const lines = [head];
  const quote = subRow ? withInviteOff(state, subRow, renewalPrice(state, subRow, now), now) : null;
  if (quote && quote.base > 0) lines.push(renewalPriceLine(quote, lang));
  lines.push(str('rem.pay_hint', lang));
  const renewal = quote && quote.base > 0 ? '\n' + renewalPriceLine(quote, lang) : '';
  let copyId = 'pay.reminder_today';
  if (row.kind === 'd3') copyId = 'pay.reminder_d3';
  else if (row.kind === 'd1') copyId = 'pay.reminder_d1';
  else if (!(until > now)) copyId = 'pay.reminder_ended';
  const graceNote = head.indexOf('\n') > 0 ? head.slice(head.indexOf('\n')) : '';
  return {
    chatId: String(row.telegramId),
    text: lines.join('\n'),
    keyboard: mainKeyboard(lang),
    inline: payInline(state.settings, lang),
    ...spec(copyId, { expires_at: expiresVar, when: whenVar, grace: graceNote, renewal, price: '' }, rec.state, rec.lang),
  };
}

/** Shown instead of a code when every device slot of the subscription is taken. */
export const DEVICE_LIMIT_TEXT = 'Все места заняты - новый код не выдан. Привязанные устройства продолжают работать.';

/** «Смен устройства осталось: 1 из 2 за 30 дней.» */
export function swapLeftLine(status, lang) {
  return str('dev.swap_left', lang, { left: status.left, limit: status.limit });
}

/** Refusal when the self-service changes of the last 30 days are used up. */
export function swapLimitText(status, lang) {
  const when = Number.isFinite(status.nextAt) && status.nextAt > 0 ? mskDateTime(status.nextAt, lang) : '';
  return str('dev.swap_limit', lang, { limit: status.limit, when: when ? str('dev.next_swap', lang, { when }) : '' });
}

/* ---------- payment messages (server.mjs sends them) ---------- */

/** User message after a payment was applied. `result` comes from applyPayment / confirmPendingPayment.
 * `lang` is the recipient language; when omitted it is resolved from the subscription account. */
export function paymentUserMessage(state, result, lang) {
  let ln = lang;
  if (ln === undefined) {
    const sub0 = (state.subscriptions || []).find((s) => s.id === result.subscriptionId) || null;
    const acc = sub0 ? (state.accounts || []).find((a) => a && a.id === sub0.accountId) || null : null;
    ln = normalizeLang(acc && acc.lang);
  }
  const origin = (state.settings && state.settings.publicOrigin) || '';
  const sub = (state.subscriptions || []).find((s) => s.id === result.subscriptionId) || null;
  let text = '';
  let inline = null;
  if (result.kind === 'new' && result.code) {
    text = str('paymsg.new', ln, {
      when: mskDateTime(result.paidUntil, ln),
      phones: upToPhones(state, ln),
      code: codeBlock(origin, result.code, str('code.head_sub', ln), ln),
    });
    inline = rows([codeButtonRow(origin, result.code, ln)]);
  } else if (result.kind === 'renew') {
    text = str('paymsg.renew', ln, { when: mskDateTime(result.paidUntil, ln) });
    if (result.extras > 0) text += str('paymsg.renew_extra', ln, { n: result.extras, when: mskDate(result.paidUntil) });
    if (result.credit > 0) text += str('paymsg.renew_credit', ln, { amount: rub(result.credit) });
    text += str('paymsg.renew_devices', ln);
    if (result.code) {
      text += '\n\n' + codeBlock(origin, result.code, undefined, ln);
      inline = rows([codeButtonRow(origin, result.code, ln)]);
    }
  } else if (result.kind === 'device') {
    text = str('paymsg.device', ln, { when: mskDate(result.extraUntil) });
    if (result.code) {
      text += '\n' + codeBlock(origin, result.code, str('code.head_for_it', ln), ln);
      inline = rows([codeButtonRow(origin, result.code, ln)]);
    } else text += str('paymsg.device_no_code', ln);
  } else if (result.kind === 'credit' && result.reason === 'repeat_discount') {
    text = str('paymsg.credit_repeat', ln, {
      amount: rub(result.credit),
      balance: result.creditTotal > result.credit ? str('paymsg.credit_total', ln, { amount: rub(result.creditTotal) }) : '',
      until: result.paidUntil ? str('paymsg.until', ln, { when: mskDateTime(result.paidUntil, ln) }) : '',
    });
  } else if (result.kind === 'credit') {
    text = str('paymsg.credit', ln, {
      amount: rub(result.credit),
      head: result.grace ? str('paymsg.head_grace', ln) : str('paymsg.head_ended', ln),
      balance: result.creditTotal > result.credit ? str('paymsg.credit_total', ln, { amount: rub(result.creditTotal) }) : '',
    });
  }
  if (!text || !sub) return null;
  let copyId = '';
  const vars = { expires_at: result.paidUntil ? mskDateTime(result.paidUntil, ln) : '', phones: upToPhones(state, ln), code: '', extra: '', balance: '', amount: '', head: '', until: '' };
  if (result.kind === 'new') copyId = 'pay.received_new';
  else if (result.kind === 'renew') {
    copyId = 'pay.received_renew';
    vars.extra = result.extras > 0 ? str('paymsg.renew_extra', ln, { n: result.extras, when: mskDate(result.paidUntil) }) : '';
    vars.balance = result.credit > 0 ? str('paymsg.renew_credit', ln, { amount: rub(result.credit) }) : '';
  } else if (result.kind === 'device') {
    copyId = 'pay.received_device';
    vars.until = result.extraUntil ? mskDate(result.extraUntil) : '';
  } else if (result.kind === 'credit' && result.reason === 'repeat_discount') {
    copyId = 'pay.received_credit_repeat';
    vars.amount = rub(result.credit);
    vars.balance = result.creditTotal > result.credit ? str('paymsg.credit_total', ln, { amount: rub(result.creditTotal) }) : '';
  } else if (result.kind === 'credit') {
    copyId = 'pay.received_credit';
    vars.amount = rub(result.credit);
    vars.head = result.grace ? str('paymsg.head_grace', ln) : str('paymsg.head_ended', ln);
  }
  if (result.code) {
    const head = result.kind === 'device' ? str('code.head_for_it', ln) : result.kind === 'new' ? str('code.head_sub', ln) : undefined;
    const lead = result.kind === 'renew' ? '\n\n' : result.kind === 'device' ? '\n' : '';
    vars.code = lead + codeBlockHtml(origin, result.code, head, ln);
  }
  return { text, inline, parseMode: 'Markdown', keyboard: mainKeyboard(ln), ...(copyId ? spec(copyId, vars, '', '', result.code ? ['code'] : []) : {}) };
}

/** YooMoney holds the transfer (`unaccepted`): tell the payer it arrived. */
export function pendingUserText(amount, lang) {
  const sum = String(amount || '').trim();
  return str('paymsg.pending', lang, { amount: sum ? ' ' + sum + ' ₽' : '' });
}

/** The admin rejected a held payment. */
export function rejectUserText(amount, lang) {
  const sum = String(amount || '').trim();
  return str('paymsg.rejected', lang, { amount: sum ? ' ' + sum + ' ₽' : '' });
}

/** Telegram text to a user who got days from an admin (bot /grant and the panel). */
export function grantUserMessage(origin, result, lang) {
  let text = str('grant.user', lang, { days: daysText(result.days, lang), when: mskDateTime(result.paidUntil, lang) });
  let inline = null;
  if (result.code) {
    text += '\n' + codeBlock(origin, result.code, undefined, lang);
    inline = rows([codeButtonRow(origin, result.code, lang)]);
  }
  return {
    text,
    inline,
    parseMode: 'Markdown',
    keyboard: mainKeyboard(lang),
    ...spec('grant.user', { days: daysText(result.days, lang), expires_at: mskDateTime(result.paidUntil, lang), code: result.code ? '\n' + codeBlockHtml(origin, result.code, undefined, lang) : '' }, '', '', result.code ? ['code'] : []),
  };
}

/* ---------- devices screen and unbind callbacks ---------- */

/** Only private chats get answers; a group or channel creates no account. */
export function isPrivateChat(chat) {
  return !!chat && (chat.type === undefined || chat.type === 'private');
}

/** Bound devices of the main subscription, oldest binding first (the order of the numbers on screen). */
function boundList(sub) {
  if (!sub) return [];
  return sub.devices
    .filter((d) => d.bound)
    .slice()
    .sort((a, b) => (Number(a.boundAt) || 0) - (Number(b.boundAt) || 0) || String(a.id).localeCompare(String(b.id)));
}

/** Short signature of the bound set, so a stale «Отвязать все» does not unbind a newer device. */
function boundSig(list) {
  return sha256(
    list
      .map((d) => d.deviceId)
      .sort()
      .join(','),
  ).slice(0, 10);
}

function deviceLabel(d, n, info, lang) {
  const meta = info ? info(d.id) : null;
  const name = meta && meta.name ? String(meta.name).slice(0, 32) + ' ' : '';
  let line = n + ') ' + name + (d.deviceId || '').slice(0, 8) + '…';
  if (d.overLimit) line += d.overReason === 'extra_expired' ? str('dev.over_extra', lang) : str('dev.over_limit', lang);
  else if (meta && meta.lastSeenAt > 0) line += str('dev.online', lang, { when: mskDateTime(meta.lastSeenAt, lang) });
  else if (d.boundAt > 0) line += str('dev.bound_at', lang, { when: mskDate(d.boundAt) });
  return line;
}

/**
 * «Устройства»: list with unbind buttons, a code for a free slot, and an offer for one more device.
 * Returns the messages to send and the next state (a code or a quote may be created).
 */
function devicesScreen(cur, { account, now, origin, checkout, info, lang }) {
  const prices = priceText(cur.settings);
  const wallet = cur.settings.yoomoneyWallet;
  let state = cur;
  const out = [];
  let sub = subscriptionView(state, account.id, now, lang);
  if (!sub) {
    out.push({
      text: str('sub.none', lang) + str('sub.none_hint', lang, { price: rub(prices.price), days: daysText(prices.days, lang), phones: upToPhones(state, lang) }) + trialLine(state, lang),
      ...spec('devices.none', { price: rub(prices.price), days: daysText(prices.days, lang), phones: upToPhones(state, lang), trial: trialLine(state, lang) }),
    });
    return { state, out };
  }
  const swap = swapStatus(mainSubscription(state, account.id), now, 1);
  const lines = [];
  let code = '';
  if (sub.active) {
    const slot = deviceCode(state, sub.id, now);
    state = slot.state;
    code = slot.code || '';
    sub = subscriptionView(state, account.id, now, lang);
  }
  const bound = boundList(sub);
  if (!sub.active) lines.push(subscriptionHead(sub, lang));
  else if (sub.inGrace) lines.push(subscriptionHead(sub, lang));
  lines.push(devicesLine(sub, lang) + (bound.length ? ':' : '.'));
  for (let i = 0; i < bound.length; i++) lines.push(deviceLabel(bound[i], i + 1, info, lang));
  if (bound.length) {
    lines.push(
      swap.left > 0
        ? swapLeftLine(swap, lang) + str('dev.swap_left_note', lang)
        : str('dev.swap_used', lang, { when: mskDateTime(swap.nextAt, lang) }),
    );
  }
  // The tail is one of: the pay hint, the code block, or the limit line (its own template).
  const listBody = lines.join('\n');
  let tail = '';
  let codeVar = '';
  let listHtml = false;
  let raw = [];
  if (!sub.active) {
    tail = str('dev.pay_hint', lang);
  } else if (code) {
    tail = '\n\n' + codeBlock(origin, code, undefined, lang);
    codeVar = '\n\n' + codeBlockHtml(origin, code, undefined, lang);
    raw = ['code'];
  } else {
    const limitRows = customRowsSync('devices.limit');
    const limitSaved = limitRows ? pickVariant(limitRows, subscriptionCopyState(sub, accountPaid(state, account)), lang) : null;
    const limitApplied = applyBuilt(limitSaved, { text: str('dev.limit_text', lang) }, {});
    tail = '\n' + limitApplied.text;
    codeVar = tail;
    if (limitApplied.used === 'template') {
      listHtml = true;
      raw = ['devices', 'code'];
    }
  }
  const devicesVar = (listHtml ? escapeHtml(listBody) : listBody) + (!sub.active ? tail : '');
  const listText = (listHtml ? escapeHtml(listBody) : listBody) + tail;

  const buttons = [];
  if (code) buttons.push(codeButtonRow(origin, code, lang));
  if (bound.length && swap.left > 0) {
    const row = [];
    for (let i = 0; i < bound.length; i++) {
      row.push({ text: str('btn.unbind_n', lang, { n: i + 1 }), callback_data: 'u1:' + bound[i].id });
      if (row.length === 3) {
        buttons.push(row.splice(0));
      }
    }
    if (row.length) buttons.push(row);
    if (bound.length > 1) buttons.push([{ text: str('btn.unbind_all', lang), callback_data: 'ua' }]);
  }
  out.push({
    text: listText,
    inline: rows(buttons),
    parseMode: code ? 'Markdown' : listHtml ? 'HTML' : undefined,
    ...spec('devices.list', { devices: devicesVar, code: codeVar, left: String(swap.left), limit: String(swap.limit), days_left: '', expires_at: sub.paidUntil ? mskDateTime(sub.paidUntil, lang) : '' }, undefined, undefined, raw),
  });

  // One more device: only when no slot is free. Sold alone only while the subscription is paid.
  const country = account.country || '';
  const deviceYo = !!(wallet && prices.extra && prices.price);
  const deviceAlt = starsOffered(state.settings, 'dev') || cryptoOffered(state.settings, country);
  if (sub.active && !code && (deviceYo || deviceAlt)) {
    const subRow = state.subscriptions.find((s) => s.id === sub.id);
    if (sub.paid) {
      let text = str('extra.head', lang);
      let buttons = [];
      if (deviceYo) {
        const lapsing = lapsingExtras(state, subRow, now);
        const offers = payOffers(checkout, state, { kind: 'dev', accountId: account.id, subscriptionId: sub.id }, lang);
        state = offers.state;
        const nextRenewal = prices.price + (sub.extraSlots + 1) * prices.extra;
        text =
          (lapsing > 0
            ? str('extra.lapsing', lang, { base: rub(offers.base), extra: rub(prices.extra), n: lapsing, when: mskDate(sub.paidUntil), next: rub(nextRenewal) })
            : str('extra.simple', lang, { extra: rub(prices.extra), when: mskDate(sub.paidUntil), next: rub(nextRenewal) })) +
          '\n' +
          offers.text;
        buttons = offers.buttons;
      }
      const alt = collectAlt(state, { kind: 'dev', accountId: account.id, subscriptionId: sub.id }, now, country, undefined, lang);
      state = alt.state;
      const merged = appendAlt(text, buttons, alt);
      out.push({ text: merged.text, inline: rows(merged.buttons), ...spec('devices.extra', { text: merged.text, price: rub(prices.price), extra: rub(prices.extra), expires_at: mskDate(sub.paidUntil) }) });
    } else {
      // Grace: a standalone slot would die with the grace period. Renewal + one more device, one purchase.
      const r = renewalText(state, subRow, sub, now, { addExtra: 1, lang });
      const opening = str('extra.grace_open', lang);
      let text = opening + r.text;
      let tail = '';
      let buttons = [];
      if (deviceYo) {
        const offers = payOffers(checkout, state, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, addExtra: 1 }, lang);
        state = offers.state;
        text += '\n' + offers.text;
        tail += '\n' + offers.text;
        buttons = offers.buttons;
      }
      const alt = collectAlt(state, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, addExtra: 1 }, now, country, undefined, lang);
      state = alt.state;
      if (alt.lines.length) tail += '\n' + alt.lines.join('\n');
      const merged = appendAlt(text, buttons, alt);
      const rHtml = r.parseMode === 'HTML';
      out.push({
        text: rHtml ? escapeHtml(opening) + r.text + escapeHtml(tail) : merged.text,
        inline: rows(merged.buttons),
        parseMode: rHtml ? 'HTML' : undefined,
        ...spec('devices.extra_grace', { renewal: r.text, tail, price: rub(prices.price) }, undefined, undefined, rHtml ? ['renewal'] : []),
      });
    }
  }
  return { state, out };
}

/**
 * Inline button under a bot message (`callback_query.data`). Unbind goes through a confirm step;
 * every step re-checks the state, so a stale button (device already gone, set changed) does nothing.
 * @returns {{ state, messages, answer: string, clearMarkup: boolean }}
 */
export function botCallback(state, { chatId, data, now, info, lang }) {
  const rawData = String(data || '');
  if (rawData.indexOf('alin:') === 0) {
    const token = rawData.slice('alin:'.length);
    const out = confirmAdminPanelLogin(state, { token, telegramId: chatId, now });
    const loginLang = normalizeLang(lang);
    if (out.result && out.result.ok) {
      return {
        state: out.state,
        answer: str('toast.login_ok', loginLang),
        messages: [{ chatId, text: str('lnk.login_ok_short', loginLang), ...spec('login.ok_short', {}, '') }],
        clearMarkup: true,
      };
    }
    return { state: out.state, answer: str('toast.login_stale', loginLang), messages: [], clearMarkup: true };
  }
  const raw = String(data || '');
  const account = accountByTelegram(state, chatId);
  const messages = [];
  const langCode = normalizeLang(lang);
  const stale = str('toast.stale', langCode);
  let cur = state;
  // Remember the language for notices sent later (payments, reminders), not just this reply.
  if (account && langCode && (account.lang || '') !== langCode) {
    cur = rememberTelegramProfile(cur, { telegramId: chatId, username: account.telegramUsername || '', name: account.telegramName || '', lang: langCode }, now).state;
  }
  const cbState = subscriptionCopyState(account ? subscriptionView(cur, account.id, now) : null, accountPaid(cur, account));
  const say = (text, extra) => {
    const rest = { ...(extra || {}) };
    if (rest.copy) {
      rest.copy = {
        id: rest.copy.id,
        vars: rest.copy.vars || {},
        state: rest.copy.state !== undefined ? rest.copy.state : cbState,
        lang: rest.copy.lang || langCode,
        raw: rest.copy.raw,
      };
    }
    messages.push({ chatId: String(chatId), text, keyboard: mainKeyboard(langCode), ...rest });
  };
  const origin = cur.settings.publicOrigin || '';
  const pay = makeCheckout(cur.settings);
  const checkout = (st, opts, targets) => pay(st, { ...opts, now }, targets);
  const showDevices = () => {
    const screen = devicesScreen(cur, { account, now, origin, checkout, info, lang: langCode });
    cur = screen.state;
    for (const m of screen.out) say(m.text, { inline: m.inline || undefined, parseMode: m.parseMode, copy: m.copy });
  };
  if (!account) return { state, messages, answer: stale, clearMarkup: true };

  if (raw.indexOf('dn:') === 0) {
    const out = donateOnCallback(cur, account, raw, now, langCode);
    if (!out) return { state, messages, answer: stale, clearMarkup: true };
    cur = out.state;
    if (out.text) say(out.text, { inline: out.inline, invoice: out.invoice, cryptoIssue: out.cryptoIssue, copy: out.copy });
    return { state: cur, messages, answer: out.answer || '', clearMarkup: false };
  }

  if (raw.indexOf('st:') === 0) {
    const id = raw.slice(3);
    const quote = (cur.purchases || []).find((p) => p.id === id);
    if (!quote || quote.method !== 'stars' || quote.accountId !== account.id) {
      return { state, messages, answer: stale, clearMarkup: true };
    }
    if (labelSettled(cur, 'buy:' + id)) return { state, messages, answer: str('toast.already_paid', langCode), clearMarkup: true };
    const stars = Number(quote.payAmount);
    if (!starsOffered(cur.settings, quote.kind === 'dev' ? 'dev' : 'new') || !Number.isInteger(stars) || stars < 1) {
      return { state, messages, answer: str('toast.stars_off', langCode), clearMarkup: true };
    }
    say(str('don.stars', langCode, { stars: String(stars) }), {
      ...spec('pay.stars', { stars: String(stars) }),
      invoice: starInvoiceBody(chatId, {
        title: str('pm.invoice_title', langCode),
        description: starBlurb(quote, cur.settings.periodDays, langCode),
        payload: 'buy:' + id,
        stars,
      }),
    });
    return { state: cur, messages, answer: '', clearMarkup: false };
  }

  if (raw.indexOf('cr:') === 0) {
    const bits = raw.slice(3).split(':');
    const asset = bits[0];
    const id = bits[1] || '';
    const quote = (cur.purchases || []).find((p) => p.id === id);
    if (!quote || quote.method !== 'crypto' || quote.asset !== asset || quote.accountId !== account.id) {
      return { state, messages, answer: stale, clearMarkup: true };
    }
    if (!cryptoOffered(cur.settings, account.country || '')) {
      return { state, messages, answer: str('toast.crypto_off', langCode), clearMarkup: true };
    }
    if (labelSettled(cur, 'buy:' + id)) return { state, messages, answer: str('toast.already_paid', langCode), clearMarkup: true };
    say(str('don.crypto', langCode, { asset, amount: String(quote.payAmount) }), {
      cryptoIssue: { purchaseId: id },
      ...spec('pay.crypto', { asset, pay_amount: String(quote.payAmount) }),
    });
    return { state: cur, messages, answer: '', clearMarkup: false };
  }

  const sub = subscriptionView(cur, account.id, now, langCode);
  const bound = boundList(sub);
  const swapSub = mainSubscription(cur, account.id);

  if (raw === 'ux') return { state, messages, answer: str('toast.cancelled', langCode), clearMarkup: true };

  if (raw.indexOf('ly:') === 0) {
    const prefix = raw.slice(3);
    if (!/^[a-f0-9]{32}$/.test(prefix)) return { state, messages, answer: stale, clearMarkup: true };
    const link = (cur.links || []).find((l) => l.token.slice(0, 32) === prefix && !l.usedAt && l.expiresAt > now);
    if (!link) return { state, messages, answer: stale, clearMarkup: true };
    const out = confirmDeviceLink(cur, { token: link.token, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) return { state: cur, messages, answer: stale, clearMarkup: true };
    const linked = subscriptionView(cur, account.id, now, langCode);
    say(str('lnk.ok', langCode, { status: statusText(cur, linked, account, { lang: langCode }) }), spec('link.ok', { status: statusText(cur, linked, account, { lang: langCode }), name: telegramDisplay(account) }));
    return { state: cur, messages, answer: str('toast.linked', langCode), clearMarkup: true };
  }

  if (raw.indexOf('u1:') === 0 || raw.indexOf('y1:') === 0) {
    const confirm = raw.indexOf('y1:') === 0;
    const bits = raw.slice(3).split(':');
    const idx = bound.findIndex((d) => d.id === bits[0]);
    const dev = idx >= 0 ? bound[idx] : null;
    if (!dev || (confirm && (dev.deviceId || '').slice(0, 8) !== bits[1])) {
      showDevices();
      return { state: cur, messages, answer: str('toast.device_gone', langCode), clearMarkup: confirm };
    }
    const label = str('dev.label', langCode, { n: idx + 1, id: (dev.deviceId || '').slice(0, 8) });
    if (!confirm) {
      const swap = swapStatus(swapSub, now, 1);
      if (swap.left < 1) {
        say(swapLimitText(swap, langCode), spec('devices.swap_limit', { limit: String(swap.limit), left: String(swap.left), when: swap.nextAt ? str('dev.next_swap', langCode, { when: mskDateTime(swap.nextAt, langCode) }) : '' }));
        return { state: cur, messages, answer: '', clearMarkup: false };
      }
      say(str('dev.unbind_ask', langCode, { device: label.charAt(0).toLowerCase() + label.slice(1), limit: String(swap.limit), left: String(swap.left - 1) }), {
        inline: {
          inline_keyboard: [[{ text: str('btn.yes_unbind', langCode), callback_data: 'y1:' + dev.id + ':' + (dev.deviceId || '').slice(0, 8) }, { text: str('btn.cancel', langCode), callback_data: 'ux' }]],
        },
        ...spec('devices.unbind_ask', { device: label.charAt(0).toLowerCase() + label.slice(1), limit: String(swap.limit), left: String(swap.left - 1) }),
      });
      return { state: cur, messages, answer: '', clearMarkup: false };
    }
    const out = selfUnbind(cur, { accountId: account.id, deviceIds: [dev.deviceId], now });
    if (out.result.error === 'swap_limit') {
      say(swapLimitText(out.result, langCode), spec('devices.swap_limit', { limit: String(out.result.limit), left: String(out.result.left), when: out.result.nextAt ? str('dev.next_swap', langCode, { when: mskDateTime(out.result.nextAt, langCode) }) : '' }));
      return { state: cur, messages, answer: '', clearMarkup: true };
    }
    if (out.result.error) {
      showDevices();
      return { state: cur, messages, answer: stale, clearMarkup: true };
    }
    cur = out.state;
    const unboundNote = out.result.left > 0 ? swapLeftLine(out.result, langCode) : str('dev.last_swap', langCode, { when: mskDateTime(out.result.nextAt, langCode) });
    say(str('dev.unbind_done', langCode, { device: label, text: unboundNote }), spec('devices.unbind_done', { device: label, text: unboundNote, left: String(out.result.left) }));
    showDevices();
    return { state: cur, messages, answer: str('toast.unbound', langCode), clearMarkup: true };
  }

  if (raw === 'ua' || raw.indexOf('ya:') === 0) {
    const confirm = raw.indexOf('ya:') === 0;
    if (bound.length < 2 || (confirm && raw.slice(3) !== boundSig(bound))) {
      showDevices();
      return { state: cur, messages, answer: str('toast.list_changed', langCode), clearMarkup: confirm };
    }
    const swap = swapStatus(swapSub, now, bound.length);
    if (!confirm) {
      if (swap.left < bound.length) {
        const why = swapLeftLine(swap, langCode).toLowerCase() +
          (swap.left > 0 ? str('dev.unbind_one_hint', langCode) : (Number.isFinite(swap.nextAt) && swap.nextAt > 0 ? str('dev.next_swap', langCode, { when: mskDateTime(swap.nextAt, langCode) }) : ''));
        say(str('dev.unbind_all_block', langCode, { count: String(bound.length), text: why }), spec('devices.unbind_all_block', { count: String(bound.length), text: why, left: String(swap.left), when: swap.nextAt ? mskDateTime(swap.nextAt, langCode) : '' }));
        return { state: cur, messages, answer: '', clearMarkup: false };
      }
      say(str('dev.unbind_all_ask', langCode, { count: String(bound.length), changes: changesWord(bound.length, langCode), limit: String(swap.limit), left: String(swap.left - bound.length) }), {
        inline: { inline_keyboard: [[{ text: str('btn.yes_unbind_all', langCode), callback_data: 'ya:' + boundSig(bound) }, { text: str('btn.cancel', langCode), callback_data: 'ux' }]] },
        ...spec('devices.unbind_all_ask', { count: String(bound.length), limit: String(swap.limit), left: String(swap.left - bound.length) }),
      });
      return { state: cur, messages, answer: '', clearMarkup: false };
    }
    const out = selfUnbind(cur, { accountId: account.id, deviceIds: bound.map((d) => d.deviceId), now });
    if (out.result.error === 'swap_limit') {
      say(swapLimitText(out.result, langCode), spec('devices.swap_limit', { limit: String(out.result.limit), left: String(out.result.left), when: out.result.nextAt ? str('dev.next_swap', langCode, { when: mskDateTime(out.result.nextAt, langCode) }) : '' }));
      return { state: cur, messages, answer: '', clearMarkup: true };
    }
    if (out.result.error) {
      showDevices();
      return { state: cur, messages, answer: stale, clearMarkup: true };
    }
    cur = out.state;
    const allNote = out.result.left > 0 ? swapLeftLine(out.result, langCode) : str('dev.last_swap', langCode, { when: mskDateTime(out.result.nextAt, langCode) });
    say(str('dev.unbind_all_done', langCode, { count: String(out.result.unbound), text: allNote }), spec('devices.unbind_all_done', { count: String(out.result.unbound), text: allNote }));
    showDevices();
    return { state: cur, messages, answer: str('toast.unbound', langCode), clearMarkup: true };
  }
  return { state, messages, answer: stale, clearMarkup: true };
}

/**
 * Stars and crypto buttons for one order. Quotes are created here; the invoice itself is sent on the tap.
 * Stars: callback st:<id>. Crypto: callback cr:<asset>:<id>.
 */
function collectAlt(state, opts, now, country, prefix, lang) {
  let cur = state;
  const buttons = [];
  const lines = [];
  const lead = prefix ? prefix + ' ' : '';
  const note = prefix ? prefix + '. ' : '';
  if (starsOffered(cur.settings, opts.kind)) {
    const quoted = quotePurchase(cur, { ...opts, now, method: 'stars' });
    cur = quoted.state;
    if (!quoted.result.error) {
      lines.push(note + str('alt.stars_line', lang, { n: quoted.result.payAmount }));
      buttons.push([{ text: (lead + str('btn.stars', lang, { amount: quoted.result.payAmount })).slice(0, 64), callback_data: 'st:' + quoted.result.id }]);
    }
  }
  if (cryptoOffered(cur.settings, country)) {
    for (let i = 0; i < CRYPTO_ASSETS.length; i++) {
      const asset = CRYPTO_ASSETS[i];
      const quoted = quotePurchase(cur, { ...opts, now, method: 'crypto', asset });
      cur = quoted.state;
      if (quoted.result.error) continue;
      lines.push(note + asset + ': ' + quoted.result.payAmount);
      buttons.push([{ text: (lead + asset + ' - ' + quoted.result.payAmount).slice(0, 64), callback_data: 'cr:' + asset + ':' + quoted.result.id }]);
    }
  }
  return { state: cur, buttons, lines };
}

function appendAlt(text, buttons, alt) {
  const nextText = alt.lines.length ? text + '\n' + alt.lines.join('\n') : text;
  const nextButtons = buttons.concat(alt.buttons);
  return { text: nextText, buttons: nextButtons };
}

/** Quote + YooMoney link. `{ state, url, price }`; url is '' when the quote failed. */
function makeCheckout(settings) {
  return (state, opts) => {
    const quoted = quotePurchase(state, { ...opts, now: opts.now });
    if (quoted.result.error) return { state, url: '', price: 0, base: 0, fee: '0.00', gross: '0.00', method: opts.method || '' };
    const gross = quoted.result.gross || quoted.result.price;
    return {
      state: quoted.state,
      url: payUrl(settings.yoomoneyWallet, {
        sum: gross,
        label: quoted.result.label,
        paymentType: quoted.result.method === 'PC' ? 'PC' : 'AC',
      }),
      price: Number(gross),
      base: quoted.result.price,
      fee: quoted.result.fee || '0.00',
      gross: String(gross),
      method: quoted.result.method || '',
    };
  };
}

/** Wallet and card links for one server-side quote. The fee is the documented YooMoney withholding, grossed up. */
function payOffers(pay, state, opts, lang) {
  const pc = pay(state, { ...opts, method: 'PC' });
  const ac = pay(pc.state, { ...opts, method: 'AC' });
  const text =
    str('offer.fee_note', lang) +
    str('offer.wallet_line', lang, { base: moneyRub(pc.base), fee: moneyRub(pc.fee), gross: moneyRub(pc.gross) }) + '\n' +
    str('offer.card_line', lang, { base: moneyRub(ac.base), fee: moneyRub(ac.fee), gross: moneyRub(ac.gross) });
  return {
    state: ac.state,
    base: pc.base,
    pc,
    ac,
    text,
    buttons: [
      [urlButton(str('btn.wallet', lang, { amount: moneyRub(pc.gross) }), pc.url)],
      [urlButton(str('btn.card', lang, { amount: moneyRub(ac.gross) }), ac.url)],
    ],
  };
}

/* ---------- support rate limit ---------- */

export const SUPPORT_RATE_MAX = 5;
export const SUPPORT_RATE_WINDOW_MS = 10 * 60 * 1000;

function supportTooFast(state, telegramId, now) {
  const id = String(telegramId);
  const from = now - SUPPORT_RATE_WINDOW_MS;
  const n = (state.supportMessages || []).filter((m) => m.telegramId === id && m.direction === 'in' && m.at > from).length;
  return n >= SUPPORT_RATE_MAX;
}

/* ---------- admin /grant target ---------- */

function grantTarget(state, who) {
  const q = String(who || '').trim();
  if (!q) return null;
  if (/^\d+$/.test(q)) return accountByTelegram(state, q);
  const nick = q.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(nick)) return null;
  return state.accounts.find((a) => String(a.telegramUsername || '').toLowerCase() === nick) || null;
}

/**
 * @param awaiting — { kind: 'promo'|'admin_find'|'admin_grant'|'admin_promo'|'support' } | null
 * @param pad — 'user' | 'admin' | null — keyboard mode for this chat (admins only; users always 'user')
 * @param replyTo — Telegram message id this update replies to
 * @param info — optional (codeId) → { name, lastSeenAt } from the device registry
 * @returns {{ state, messages: { chatId, text, keyboard?, inline?, await?, parseMode?, supportNotify? }[], pad: 'user'|'admin' }}
 */
export function botReply(state, { chatId, text, now, awaiting, replyTo, from, pad, info }) {
  const ensured = from
    ? rememberTelegramProfile(
        state,
        {
          telegramId: chatId,
          username: from.username || '',
          name: [from.firstName, from.lastName].filter(Boolean).join(' '),
          lang: from.lang || '',
        },
        now,
      )
    : ensureTelegramAccount(state, chatId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const admin = isAdminChat(cur.settings, chatId);
  const prices = priceText(cur.settings);
  const lang = normalizeLang(from && from.lang);
  const sub = subscriptionView(cur, account.id, now, lang);
  const wallet = cur.settings.yoomoneyWallet;
  const origin = cur.settings.publicOrigin || '';
  const messages = [];
  let { action, arg } = parseAction(text);

  /** Admins default to user pad so they can exercise the subscriber flow; /admin switches. */
  let mode = admin && pad === 'admin' ? 'admin' : 'user';
  if (admin && (action === 'admin' || String(action).indexOf('admin_') === 0)) mode = 'admin';
  if (action === 'user_mode') mode = 'user';

  const pay = makeCheckout(cur.settings);
  const checkout = (opts, targets) => {
    const out = pay(cur, { ...opts, now }, targets);
    cur = out.state;
    return out;
  };
  const subState = subscriptionCopyState(sub, accountPaid(cur, account));
  const uv = (extra) => userVars(cur, account, sub, now, extra, lang);

  const say = (body, extra) => {
    const forceAdmin = extra && extra.adminPad === true;
    const forceUser = extra && extra.adminPad === false;
    const adminPad = forceUser ? false : forceAdmin || mode === 'admin';
    const rest = { ...(extra || {}) };
    delete rest.adminPad;
    if (rest.copy) {
      rest.copy = {
        id: rest.copy.id,
        vars: rest.copy.vars || {},
        state: rest.copy.state !== undefined ? rest.copy.state : subState,
        lang: rest.copy.lang || lang,
        raw: rest.copy.raw,
      };
    }
    if (!rest.inline) delete rest.inline;
    if (!rest.parseMode) delete rest.parseMode;
    messages.push({
      chatId: String(chatId),
      text: body,
      keyboard: admin && adminPad ? adminKeyboard(lang) : mainKeyboard(lang),
      ...rest,
    });
  };

  if (awaiting && awaiting.kind && action === 'unknown') {
    if (awaiting.kind === 'promo') {
      action = 'promo';
      arg = String(text || '').replace(/\s+/g, '');
    } else if (awaiting.kind === 'admin_find') {
      action = 'admin_find';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'admin_grant') {
      action = 'admin_grant';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'admin_promo') {
      action = 'admin_promo';
      arg = String(text || '').trim();
    } else if (awaiting.kind === 'support') {
      action = 'support';
      arg = String(text || '').trim();
    }
  }

  if (replyTo && admin) {
    const target = supportReplyTarget(cur, chatId, replyTo);
    const body = String(text || '').trim();
    if (target && body) {
      const saved = appendSupportMessage(cur, {
        telegramId: target,
        text: body,
        direction: 'out',
        now,
        via: 'bot',
      });
      cur = saved.state;
      const relayRec = copyRecipient(cur, (accountByTelegram(cur, target) || {}).id, now);
      messages.push({
        chatId: String(target),
        text: str('sup.relay', relayRec.lang, { text: body }),
        keyboard: mainKeyboard(relayRec.lang),
        ...spec('support.relay', { text: body }, relayRec.state, relayRec.lang),
      });
      say(str('adm.reply_sent', lang, { who: target }), spec('admin.reply_sent', { who: target }, ''));
      return { state: cur, messages, pad: mode };
    }
  }

  if (action === 'link') {
    const out = pendingDeviceLink(cur, { token: arg, now });
    cur = out.state;
    if (out.result.error) say(str('lnk.stale', lang), spec('link.stale', {}));
    else {
      const device = out.result.deviceId.slice(0, 8);
      say(str('lnk.ask', lang, { device }), {
        inline: { inline_keyboard: [[{ text: str('btn.link', lang), callback_data: out.result.callback }, { text: str('btn.cancel', lang), callback_data: 'ux' }]] },
        ...spec('link.ask', { device }),
      });
    }
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin_login') {
    const out = confirmAdminPanelLogin(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) {
      process.stderr.write(adminLoginFailureLine(out.result.error));
      if (out.result.error === 'wrong_user') {
        say(str('lnk.denied', lang), spec('login.denied', {}, ''));
      } else {
        say(str('lnk.login_stale', lang), spec('login.stale', {}, ''));
      }
    } else {
      say(str('lnk.login_ok', lang), spec('login.ok', {}, ''));
    }
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin' || action === 'admin_summary' || action === 'admin_find' || action === 'admin_grant' || action === 'admin_promo') {
    if (!admin) {
      say(str('adm.no_access', lang), spec('admin.no_access', {}, ''));
      return { state: cur, messages, pad: 'user' };
    }
  }
  if ((action === 'admin_grant' || action === 'admin_promo') && isPanelReader(cur.settings, chatId)) {
    say(str('adm.readonly', lang), { adminPad: true, ...spec('admin.readonly', {}, '') });
    return { state: cur, messages, pad: 'admin' };
  }

  if (action === 'user_mode') {
    const prefix = admin ? str('cab.user_mode_prefix', lang) : '';
    const status = statusText(cur, sub, account, { lang });
    say(str('cab.user_mode', lang, { prefix, status }), { adminPad: false, ...spec('cabinet.user_mode', uv({ prefix, status })) });
  } else if (action === 'admin') {
    say(str('adm.home', lang), { adminPad: true, ...spec('admin.home', {}, '') });
  } else if (action === 'admin_summary') {
    const s = adminSummary(cur, now);
    const summary = str('adm.summary_body', lang, { accounts: s.accounts, active: s.active, promos: s.promos, bound: s.bound, fails: s.fails });
    say(str('adm.summary', lang, { summary }), { adminPad: true, ...spec('admin.summary', { summary }, '') });
  } else if (action === 'admin_find' && !arg) {
    say(str('adm.find_ask', lang), { adminPad: true, await: { kind: 'admin_find' }, ...spec('admin.find_ask', {}, '') });
  } else if (action === 'admin_find' && arg) {
    const found = adminFind(cur, arg, now);
    if (!found) say(str('adm.find_miss', lang, { arg }), { adminPad: true, ...spec('admin.find_miss', { arg }, '') });
    else {
      const who = found.account.telegramId || found.account.id;
      const status = statusText(cur, found.sub, found.account, { admin: true, lang });
      const code = found.reveal ? str('adm.free_code', lang, { code: formatCode(found.reveal.code) }) : '';
      const codeHtml = found.reveal ? '\nСвободный код: <code>' + formatCode(found.reveal.code) + '</code>' : '';
      say(str('adm.find_hit', lang, { who, status, code }), { adminPad: true, ...spec('admin.find_hit', { who, status, code: codeHtml }, '', '', found.reveal ? ['code'] : []) });
    }
  } else if (action === 'admin_grant' && !arg) {
    say(str('adm.grant_ask', lang), { adminPad: true, await: { kind: 'admin_grant' }, ...spec('admin.grant_ask', {}, '') });
  } else if (action === 'admin_grant' && arg) {
    const bits = arg.split(/\s+/);
    const days = Number(bits[1]);
    const target = grantTarget(cur, bits[0]);
    if (!target) {
      const whoArg = String(bits[0] || '').slice(0, 64);
      say(str('adm.grant_bad_user', lang, { arg: whoArg }), { adminPad: true, ...spec('admin.grant_bad_user', { arg: whoArg }, '') });
    } else if (!Number.isInteger(days) || days < 1 || days > 3650) {
      say(str('adm.grant_bad_days', lang, { arg: bits[0] || '123456789' }), { adminPad: true, ...spec('admin.grant_bad_days', { arg: bits[0] || '123456789' }, '') });
    } else {
      const out = grantDays(cur, { accountId: target.id, days, now });
      cur = out.state;
      if (out.result.error) say(str('adm.grant_fail', lang), { adminPad: true, ...spec('admin.grant_fail', {}, '') });
      else {
        const who = telegramDisplay(target) || target.telegramId;
        const grantRec = copyRecipient(cur, target.id, now);
        const note = grantUserMessage(origin, out.result, grantRec.lang);
        if (note.copy) note.copy = { ...note.copy, state: grantRec.state, lang: grantRec.lang };
        messages.push({ chatId: String(target.telegramId), ...note });
        const noteText = out.result.code ? str('adm.grant_note_code', lang) : str('adm.grant_note_nocode', lang);
        say(str('adm.grant_ok', lang, { days: daysText(out.result.days, lang), who, when: mskDateTime(out.result.paidUntil, lang), text: noteText }), { adminPad: true, ...spec('admin.grant_ok', { days: daysText(out.result.days, lang), who, expires_at: mskDateTime(out.result.paidUntil, lang), text: noteText }, '') });
      }
    }
  } else if (action === 'admin_promo' && !arg) {
    say(str('adm.promo_ask', lang), { adminPad: true, await: { kind: 'admin_promo' }, ...spec('admin.promo_ask', {}, '') });
  } else if (action === 'admin_promo' && arg) {
    const bits = arg.split(/\s+/);
    // /admin_promo CODE DAYS USES [BONUS_SLOTS [BONUS_DAYS]]: bonus slots forever when BONUS_DAYS is 0 or missing
    const out = createPromo(cur, {
      code: bits[0],
      days: bits[1] === undefined ? 1 : Number(bits[1]),
      maxUses: Number(bits[2]) || 1,
      bonusSlots: Number(bits[3]) || 0,
      bonusDays: Number(bits[4]) || 0,
      now,
    });
    cur = out.state;
    if (out.result.error === 'exists') say(str('adm.promo_exists', lang), { adminPad: true, ...spec('admin.promo_exists', {}, '') });
    else if (out.result.error) say(str('adm.promo_bad', lang), { adminPad: true, ...spec('admin.promo_bad', {}, '') });
    else say(str('adm.promo_ok', lang, { code: out.result.promo.code, info: promoText(out.result.promo, lang), uses: out.result.promo.maxUses }), { adminPad: true, ...spec('admin.promo_ok', { promo_code: out.result.promo.code, promo_info: promoText(out.result.promo, lang), uses: String(out.result.promo.maxUses) }, '') });
  } else if (action === 'promo' && !arg) {
    say(copyText('promo.ask', lang), { await: { kind: 'promo' }, ...spec('promo.ask', {}) });
  } else if (action === 'promo' && arg) {
    const out = redeemPromo(cur, { code: arg, accountId: account.id, now });
    cur = out.state;
    if (out.result.error === 'bad_promo') {
      const ref = hasCustomSync('referral.bound') ? redeemReferralCode(cur, { code: arg, accountId: account.id, now }) : null;
      if (ref && ref.result && ref.result.kind === 'referral') {
        cur = ref.state;
        say(copyText('referral.bound', lang, { ref_link: ref.result.promoCode }), spec('referral.bound', uv({ ref_link: ref.result.promoCode })));
      } else say(copyText('promo.bad', lang), spec('promo.bad', { promo_code: arg }));
    } else if (out.result.error === 'already') say(copyText('promo.already', lang), spec('promo.already', {}));
    else if (out.result.error === 'exhausted') say(copyText('promo.exhausted', lang), spec('promo.exhausted', {}));
    else if (out.result.error === 'expired') say(copyText('promo.expired', lang), spec('promo.expired', {}));
    else if (out.result.error === 'needs_subscription') say(copyText('promo.needs_sub', lang), spec('promo.needs_sub', {}));
    else {
      const b = out.result.bonus;
      const parts = [];
      if (out.result.days) parts.push(str('promo.bonus_days', lang, { days: daysText(out.result.days, lang), when: mskDateTime(out.result.paidUntil, lang) }));
      if (b) {
        const deviceWord = lang === 'en' ? (b.count === 1 ? 'device' : 'devices') : b.count === 1 ? 'устройство' : 'устройства';
        const untilText = b.until ? str('promo.bonus_until', lang, { when: mskDate(b.until) }) : str('promo.bonus_forever', lang);
        parts.push(str('promo.bonus_slots', lang, { n: b.count, device: deviceWord, until: untilText }));
      }
      const head = str('promo.ok_head', lang, { bonus: parts.join('; ') });
      if (out.result.code) {
        say(head + '\n\n' + codeBlock(origin, out.result.code, undefined, lang), {
          inline: rows([codeButtonRow(origin, out.result.code, lang)]),
          parseMode: 'Markdown',
          ...spec('promo.ok', { bonus: parts.join('; '), code: '\n\n' + codeBlockHtml(origin, out.result.code, undefined, lang), promo_code: arg, days: out.result.days ? daysText(out.result.days, lang) : '', expires_at: out.result.paidUntil ? mskDateTime(out.result.paidUntil, lang) : '' }, undefined, undefined, ['code']),
        });
      } else {
        say(head + str('promo.devices_keep', lang), spec('promo.ok', { bonus: parts.join('; ') + str('promo.devices_keep_var', lang), code: '', promo_code: arg, days: out.result.days ? daysText(out.result.days, lang) : '', expires_at: out.result.paidUntil ? mskDateTime(out.result.paidUntil, lang) : '' }));
      }
    }
  } else if (action === 'price') {
    const grace = graceDays(cur.settings);
    const extraLine = prices.extra ? str('price.extra', lang, { price: rub(prices.extra) }) : '';
    const graceLine = grace > 0 ? str('price.grace', lang, { days: daysText(grace, lang) }) : '';
    const priceTextBody = str('price.body', lang, { price: rub(prices.price), days: daysText(prices.days, lang), phones: upToPhones(cur, lang), extra: extraLine, grace: graceLine, trial: trialLine(cur, lang) });
    say(priceTextBody, spec('pay.price', uv({ extra: extraLine, grace: graceLine })));
  } else if (action === 'pay') {
    const country = account.country || '';
    const yo = !!(wallet && prices.price);
    const altOn = starsOffered(cur.settings, 'new') || cryptoOffered(cur.settings, country);
    if (!yo && !altOn) say(copyText('pay.unavailable', lang, { trial: trialLine(cur, lang) }), spec('pay.unavailable', uv()));
    else if (!sub) {
      const inviteOff = referralDiscountOf(cur, account.id, prices.price, now);
      let text = str('new.head', lang, { price: rub(Math.max(0, prices.price - inviteOff)), days: daysText(prices.days, lang), phones: upToPhones(cur, lang) });
      let details = '';
      if (inviteOff > 0) {
        const offLine = str('new.discount', lang, { off: rub(inviteOff) });
        text += '\n' + offLine;
        details += offLine;
      }
      let buttons = [];
      if (yo) {
        const offers = payOffers(pay, cur, { kind: 'new', accountId: account.id, now }, lang);
        cur = offers.state;
        text += '\n' + offers.text;
        details += (details ? '\n' : '') + offers.text;
        buttons = offers.buttons;
      }
      const alt = collectAlt(cur, { kind: 'new', accountId: account.id }, now, country, undefined, lang);
      cur = alt.state;
      if (alt.lines.length) details += (details ? '\n' : '') + alt.lines.join('\n');
      const merged = appendAlt(text, buttons, alt);
      const payNew = merged.text + str('new.code_hint', lang);
      say(payNew, { inline: rows(merged.buttons), ...spec('pay.new', uv({ details, price: rub(Math.max(0, prices.price - inviteOff)) })) });
    } else {
      const subRow = cur.subscriptions.find((s) => s.id === sub.id);
      const renewal = renewalText(cur, subRow, sub, now, { lang });
      const head = sub.active ? (sub.inGrace ? subscriptionHead(sub, lang) + '\n\n' : '') : subscriptionHead(sub, lang) + '\n\n';
      let buttons = [];
      let tail = '';
      if (yo) {
        const full = payOffers(pay, cur, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, now }, lang);
        cur = full.state;
        buttons = full.buttons.slice();
        tail = '\n' + full.text;
      }
      const alt = collectAlt(cur, { kind: 'sub', accountId: account.id, subscriptionId: sub.id }, now, country, undefined, lang);
      cur = alt.state;
      const merged = appendAlt('', buttons, alt);
      buttons = merged.buttons;
      tail += merged.text ? '\n' + merged.text.trim() : '';
      if (renewal.quote.extras > 0) {
        if (yo) {
          const base = payOffers(pay, cur, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, withExtras: false, now }, lang);
          cur = base.state;
          buttons.push([urlButton(str('btn.sub_only_wallet', lang, { amount: moneyRub(base.pc.gross) }), base.pc.url)]);
          buttons.push([urlButton(str('btn.sub_only_card', lang, { amount: moneyRub(base.ac.gross) }), base.ac.url)]);
          tail += '\n' + base.text;
        }
        const baseAlt = collectAlt(cur, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, withExtras: false }, now, country, str('btn.sub_only_prefix', lang), lang);
        cur = baseAlt.state;
        buttons = buttons.concat(baseAlt.buttons);
        if (baseAlt.lines.length) tail += '\n' + baseAlt.lines.join('\n');
        const extraUntil = Number(subRow && subRow.extraUntil) || 0;
        let note = str('new.sub_only_active', lang);
        if (!sub.active) note = str('new.sub_only_ended', lang);
        else if (extraUntil > 0) {
          note = str('new.sub_only_until', lang, { when: mskDateTime(extraUntil + graceDays(cur.settings) * 86400000, lang) });
        } else if (Number(sub.paidUntil) > 0) {
          note = str('new.sub_only_until', lang, { when: mskDateTime(Number(sub.paidUntil) + graceDays(cur.settings) * 86400000, lang) });
        }
        tail += note;
      }
      // A saved renewal.quote renders HTML: keep that parse mode and escape the code-built parts.
      const renewalHtml = renewal.parseMode === 'HTML';
      say(renewalHtml ? escapeHtml(head) + renewal.text + escapeHtml(tail) : head + renewal.text + tail, {
        inline: rows(buttons),
        parseMode: renewalHtml ? 'HTML' : undefined,
        ...spec('pay.renew', uv({ head, renewal: renewal.text, tail }), undefined, undefined, renewalHtml ? ['renewal'] : []),
      });
    }
  } else if (action === 'devices') {
    const screen = devicesScreen(cur, { account, now, origin, checkout: (st, opts, targets) => pay(st, { ...opts, now }, targets), info, lang });
    cur = screen.state;
    for (const m of screen.out) say(m.text, { inline: m.inline || undefined, parseMode: m.parseMode, copy: m.copy });
  } else if (action === 'support' && !arg) {
    say(copyText('support.ask', lang), { await: { kind: 'support' }, ...spec('support.ask', {}) });
  } else if (action === 'support' && arg) {
    if (supportTooFast(cur, chatId, now)) {
      say(copyText('support.fast', lang), spec('support.fast', {}));
      return { state: cur, messages, pad: mode };
    }
    const saved = appendSupportMessage(cur, { telegramId: String(chatId), text: arg, direction: 'in', now, via: 'bot' });
    cur = saved.state;
    const admins = adminChatIds(cur.settings);
    const notify = adminNotifyEnabled(cur.settings);
    const supportReply = admins.length
      ? notify
        ? copyText('support.sent', lang)
        : copyText('support.saved_off', lang)
      : copyText('support.saved_no_admin', lang);
    const supportId = admins.length ? (notify ? 'support.sent' : 'support.saved_off') : 'support.saved_no_admin';
    say(supportReply, spec(supportId, {}, ''));
    if (notify) {
      const who = telegramDisplay(account) || chatId;
      const note = str('sup.note', lang, { who, text: arg });
      for (let i = 0; i < admins.length; i++) {
        messages.push({ chatId: admins[i], text: note, keyboard: adminKeyboard(lang), supportNotify: String(chatId), ...spec('support.note', { who, text: arg }, '') });
      }
    }
  } else if (action === 'donate') {
    const out = donateMenu(cur, account, now, lang);
    cur = out.state;
    say(out.text, { inline: out.inline, copy: out.copy });
  } else if (action === 'unknown') {
    const drafted = donateOnText(cur, account, String(text || ''), now, lang);
    if (drafted) {
      cur = drafted.state;
      say(drafted.text, { inline: drafted.inline, copy: drafted.copy });
    } else {
      const status = statusText(cur, sub, account, { lang });
      say(str('cab.unknown', lang, { status }), spec('cabinet.unknown', uv({ status })));
    }
  } else {
    const hint = admin && mode === 'user' ? str('cab.admin_hint', lang) : '';
    const status = statusText(cur, sub, account, { lang });
    say(str('cab.home', lang, { status, hint }), spec('cabinet.home', uv({ status, admin_hint: hint })));
  }
  return { state: cur, messages, pad: mode };
}

export function telegramOf(state, accountId) {
  const found = state.accounts.find((a) => a.id === accountId);
  return found && found.telegramId ? found.telegramId : '';
}

export function botDeepLink(settings, startPayload) {
  const user = String((settings && settings.botUsername) || 'OMPBILLINGBOT').replace(/^@/, '');
  return 'https://t.me/' + user + '?start=' + encodeURIComponent(startPayload);
}