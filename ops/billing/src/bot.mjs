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
  priceText,
  quotePurchase,
  redeemPromo,
  subscriptionView,
  supportReplyTarget,
} from './logic.mjs';

/** «до 2 телефонов» */
function upToPhones(state) {
  const n = baseDevices(state && state.settings);
  return 'до ' + n + (n === 1 ? ' телефона' : ' телефонов');
}

/** «+30 дней» / «+1 устройство навсегда» / both. */
function promoText(p) {
  const parts = [];
  if (p.days) parts.push('+' + daysText(p.days));
  if (p.bonusSlots) parts.push('+' + p.bonusSlots + ' устр. ' + (p.bonusDays ? 'на ' + daysText(p.bonusDays) : 'навсегда'));
  return parts.join(', ');
}

function rub(n) {
  return (Number(n) || 0).toFixed(0) + ' ₽';
}

/** Reply keyboard — personal cabinet (same for users and for admins in user mode). */
export const BTN = {
  cabinet: 'Кабинет',
  /** Buy when there is no subscription, renew otherwise. */
  pay: 'Оплатить',
  /** Code for a free slot, the device list, unbind and one more device. */
  devices: 'Устройства',
  promo: 'Промокод',
  price: 'Цены',
  support: 'Поддержка',
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

/** User pad — no admin entry so admins can test the subscriber flow as-is. */
export function mainKeyboard() {
  return {
    keyboard: [
      [{ text: BTN.cabinet }, { text: BTN.pay }],
      [{ text: BTN.devices }, { text: BTN.promo }],
      [{ text: BTN.price }, { text: BTN.support }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: ADMIN_BTN.summary }, { text: ADMIN_BTN.find }],
      [{ text: ADMIN_BTN.grant }, { text: ADMIN_BTN.promo }],
      [{ text: ADMIN_BTN.user }],
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

export function daysText(n) {
  return n + ' ' + plural(n, 'день', 'дня', 'дней');
}

function urlButton(text, url) {
  return url && String(url).indexOf('http') === 0 ? { text, url } : null;
}

function rows(list) {
  const out = list.filter((r) => r && r.length).map((r) => r.filter(Boolean)).filter((r) => r.length);
  return out.length ? { inline_keyboard: out } : null;
}

function codeButtonRow(origin, code) {
  return [urlButton('Открыть в OMP', openAppUrl(origin, code))];
}

/**
 * Code for a new device, as shown in the bot and in payment messages (Markdown, code with a hyphen).
 * Without a public https origin the omp:// link is the only way to open the app, so it is shown.
 */
export function codeBlock(origin, code, head) {
  const dashed = formatCode(code);
  const https = openAppUrl(origin, dashed).indexOf('http') === 0;
  return (
    (head || 'Код для нового устройства') +
    ': `' +
    dashed +
    '`\nНажмите на код, чтобы скопировать, и введите его в OMP на телефоне' +
    (https ? ' - или кнопка «Открыть в OMP».' : ':\n' + appSchemeUrl(dashed))
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

function trialLine(state) {
  const code = trialPromo(state);
  return code ? '\nПробный день - промокод ' + code + ' в «Промокод».' : '';
}

/** Maps a button label or /command to an internal action. */
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
  if (is(BTN.cabinet, '/status', '/start', '/menu', '/cabinet')) return { action: 'cabinet', arg: '' };
  if (is(BTN.pay, OLD_BTN.buy, OLD_BTN.renew, '/pay', '/buy', '/renew')) return { action: 'pay', arg: '' };
  if (is(BTN.devices, OLD_BTN.code, OLD_BTN.unlink, '/code', '/device', '/devices', '/unlink')) return { action: 'devices', arg: '' };
  if (is(BTN.promo, '/promo')) return { action: 'promo', arg: '' };
  if (is(BTN.price, '/price', '/prices')) return { action: 'price', arg: '' };
  if (is(BTN.support, '/support')) return { action: 'support', arg: '' };
  if (is('/admin', 'Админ')) return { action: 'admin', arg: '' };
  if (is(ADMIN_BTN.user, '/user', 'В кабинет')) return { action: 'user_mode', arg: '' };
  if (is(ADMIN_BTN.summary, '/summary')) return { action: 'admin_summary', arg: '' };
  if (is(ADMIN_BTN.find, '/find')) return { action: 'admin_find', arg: '' };
  if (is(ADMIN_BTN.grant, '/grant')) return { action: 'admin_grant', arg: '' };
  if (raw === ADMIN_BTN.promo) return { action: 'admin_promo', arg: '' };

  if (head === '/promo' && rest) return { action: 'promo', arg: rest.replace(/\s+/g, '') };
  if (head === '/support' && rest) return { action: 'support', arg: rest };
  if (head === '/find' && rest) return { action: 'admin_find', arg: rest };
  if (head === '/grant' && rest) return { action: 'admin_grant', arg: rest };
  if (head === '/admin_promo' && rest) return { action: 'admin_promo', arg: rest };
  return { action: 'unknown', arg: raw };
}

/** «Устройства: 3 из 4 (2 базовых + 1 бонусный (навсегда) + 1 купленный до 18.11.2026)»; a plain base: «1 из 2». */
function devicesLine(sub) {
  const used = sub.devices.filter((d) => d.bound).length;
  let line = 'Устройства: ' + used + ' из ' + sub.deviceLimit;
  const limit = sub.limit;
  if (limit && !limit.plain) line += ' (' + limit.text + (limit.extra > 0 ? ' до ' + mskDate(limit.extraUntil) : '') + ')';
  return line;
}

function creditLine(sub) {
  return sub && sub.credit > 0 ? '\nЗачёт: ' + rub(sub.credit) + ' - вычтем из следующего продления.' : '';
}

/** Subscription head line(s): paid, grace period, or ended. Times are Moscow time. */
export function subscriptionHead(sub) {
  if (sub.inGrace) {
    return (
      '⚠️ Подписка закончилась ' +
      mskDateTime(sub.paidUntil) +
      '.\nЛьготный период: поиск работает до ' +
      mskDateTime(sub.accessUntil) +
      '. Продлите - «Оплатить».'
    );
  }
  if (sub.active) return 'Подписка до ' + mskDateTime(sub.paidUntil);
  return 'Подписка закончилась ' + mskDateTime(sub.paidUntil) + ' - поиск отключён на всех устройствах.';
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
  const prices = priceText(state.settings);
  const tg = account && account.telegramId ? 'Telegram: ' + (telegramDisplay(account) || account.telegramId) + '\n' : '';
  if (!sub) {
    return (
      tg +
      'Подписки нет.' +
      (admin
        ? ''
        : '\n«Оплатить» - ' +
          rub(prices.price) +
          ' за ' +
          daysText(prices.days) +
          ', ' +
          upToPhones(state) +
          '. На ТВ подписка не нужна.' +
          trialLine(state))
    );
  }
  const bound = sub.devices.filter((d) => d.bound);
  const list = admin && bound.length ? '\nПривязаны: ' + bound.map((d) => (d.deviceId || '').slice(0, 8) + '…').join(', ') : '';
  if (!sub.active) {
    return (
      tg +
      subscriptionHead(sub) +
      (bound.length ? '\nПривязано устройств: ' + bound.length + '. После оплаты они заработают сами, код вводить не нужно.' : '') +
      creditLine(sub) +
      list +
      (admin ? '' : '\nНажмите «Оплатить».')
    );
  }
  let next = '';
  if (!admin) {
    if (sub.inGrace) next = '\n«Устройства» - список и коды.';
    else if (freeSlots(sub) > 0) next = '\n«Устройства» - код для нового устройства и список. «Оплатить» - продлить.';
    else next = '\nВсе места заняты. «Устройства» - список, отвязка' + (prices.extra ? ' и ещё одно устройство за ' + rub(prices.extra) : '') + '.';
  }
  return tg + subscriptionHead(sub) + '\n' + devicesLine(sub) + creditLine(sub) + list + next;
}

/**
 * Renewal breakdown for the bot: base + extra slots that still count − credit.
 * «Продление на 30 дней, до 18.11.2026 12:00 МСК:\n• подписка — 150 ₽\n• доп. устройство × 1 — 50 ₽\nИтого: 200 ₽»
 */
export function renewalText(state, subRow, sub, now, opts) {
  const quote = renewalPrice(state, subRow, now, opts);
  const from = sub.active ? sub.paidUntil : now;
  const lines = ['Продление на ' + daysText(quote.days) + ', до ' + mskDateTime(from + quote.days * 86400000) + ':'];
  lines.push('• подписка - ' + rub(quote.base));
  if (quote.extras > 0) lines.push('• доп. устройство × ' + quote.extras + ' - ' + rub(quote.extraSum));
  if (quote.credit > 0) lines.push('• зачёт - −' + rub(quote.credit));
  if (quote.extras > 0 || quote.credit > 0) lines.push('Итого: ' + rub(quote.total));
  return { text: lines.join('\n'), quote };
}

function renewalPriceLine(quote) {
  const bits = [];
  if (quote.extras > 0) bits.push('подписка ' + rub(quote.base) + ' + доп. устройство ' + rub(quote.extraRub) + ' × ' + quote.extras);
  if (quote.credit > 0) bits.push('зачёт −' + rub(quote.credit));
  return 'Продление на ' + daysText(quote.days) + ': ' + rub(quote.total) + (bits.length ? ' (' + bits.join(', ') + ')' : '') + '.';
}

function payInline(settings) {
  return { inline_keyboard: [[{ text: 'Оплатить', url: botDeepLink(settings, 'pay') }]] };
}

/**
 * One-time notice when access is over (the grace period ended, or the subscription with graceDays 0).
 * The renewal brings back the extra slots that lapsed with the subscription (same price as before).
 */
function graceEndMessage(state, row, subRow, grace, now) {
  const lines = [
    grace > 0 ? '⚠️ Льготный период закончился - поиск в OMP отключён.' : '⚠️ Подписка OMP закончилась - поиск отключён.',
  ];
  const quote = subRow ? renewalPrice(state, subRow, now) : null;
  if (quote && quote.base > 0) {
    lines.push(renewalPriceLine(quote));
    lines.push('Привязанные устройства заработают сами, код вводить не нужно.');
    if (quote.extras > 0) lines.push('Без доп. устройств - ' + rub(renewalPrice(state, subRow, now, { withExtras: false }).total) + '.');
  } else {
    lines.push('Продлите подписку, чтобы продолжить.');
  }
  lines.push('Нажмите «Оплатить» - ссылка на оплату придёт в этот чат.');
  return { chatId: String(row.telegramId), text: lines.join('\n'), keyboard: mainKeyboard(), inline: payInline(state.settings) };
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
  let head = '';
  if (row.kind === 'd3') head = '⚠️ Подписка OMP заканчивается через 3 дня - ' + mskDate(until) + ' в ' + mskTime(until) + ' МСК.';
  else if (row.kind === 'd1') head = '⚠️ Подписка OMP заканчивается завтра - ' + mskDate(until) + ' в ' + mskTime(until) + ' МСК.';
  else if (until > now) {
    head = '⚠️ Подписка OMP заканчивается сегодня в ' + mskTime(until) + ' МСК.';
    if (grace > 0) head += '\nПосле этого ещё ' + daysText(grace) + ' льготного периода: поиск будет работать до ' + mskDateTime(accessEnd) + '.';
  } else {
    head = '⚠️ Подписка OMP закончилась сегодня в ' + mskTime(until) + ' МСК.';
    if (grace > 0) head += '\nЛьготный период: поиск работает до ' + mskDateTime(accessEnd) + '.';
  }
  const lines = [head];
  const quote = subRow ? renewalPrice(state, subRow, now) : null;
  if (quote && quote.base > 0) lines.push(renewalPriceLine(quote));
  lines.push('Нажмите «Оплатить» - ссылка на оплату придёт в этот чат.');
  return { chatId: String(row.telegramId), text: lines.join('\n'), keyboard: mainKeyboard(), inline: payInline(state.settings) };
}

/** Shown instead of a code when every device slot of the subscription is taken. */
export const DEVICE_LIMIT_TEXT = 'Все места заняты - новый код не выдан. Привязанные устройства продолжают работать.';

/** «Смен устройства осталось: 1 из 2 за 30 дней.» */
export function swapLeftLine(status) {
  return 'Смен устройства осталось: ' + status.left + ' из ' + status.limit + ' за 30 дней.';
}

/** Refusal when the self-service changes of the last 30 days are used up. */
export function swapLimitText(status) {
  const when = Number.isFinite(status.nextAt) && status.nextAt > 0 ? mskDateTime(status.nextAt) : '';
  return (
    'Сменить устройство сейчас нельзя: самостоятельно - не больше ' +
    status.limit +
    ' раз за 30 дней.' +
    (when ? '\nСледующая смена - с ' + when + '.' : '') +
    '\nУже привязанные устройства работают. Если нужно срочно - напишите в «Поддержку».'
  );
}

/* ---------- payment messages (server.mjs sends them) ---------- */

/** User message after a payment was applied. `result` comes from applyPayment / confirmPendingPayment. */
export function paymentUserMessage(state, result) {
  const origin = (state.settings && state.settings.publicOrigin) || '';
  const sub = (state.subscriptions || []).find((s) => s.id === result.subscriptionId) || null;
  let text = '';
  let inline = null;
  if (result.kind === 'new' && result.code) {
    text =
      '✅ Оплата получена. Подписка до ' +
      mskDateTime(result.paidUntil) +
      ', ' +
      upToPhones(state) +
      '.\n' +
      codeBlock(origin, result.code, 'Код подписки') +
      '\nНа ТВ подписка не нужна.';
    inline = rows([codeButtonRow(origin, result.code)]);
  } else if (result.kind === 'renew') {
    text = '✅ Оплата получена. Подписка продлена до ' + mskDateTime(result.paidUntil) + '.';
    if (result.extras > 0) text += '\nДоп. устройств: ' + result.extras + ', тоже до ' + mskDate(result.paidUntil) + '.';
    if (result.credit > 0) text += '\nЗачтено: ' + rub(result.credit) + '.';
    text += '\nПривязанные устройства продолжают работать - ничего вводить не нужно.';
    if (result.code) {
      text += '\n\n' + codeBlock(origin, result.code);
      inline = rows([codeButtonRow(origin, result.code)]);
    }
  } else if (result.kind === 'device') {
    text = '✅ Оплата получена: доп. устройство до ' + mskDate(result.extraUntil) + ', дальше продлевается вместе с подпиской.';
    if (result.code) {
      text += '\n' + codeBlock(origin, result.code, 'Код для него');
      inline = rows([codeButtonRow(origin, result.code)]);
    } else text += '\nКод для него - в «Устройства».';
  } else if (result.kind === 'credit') {
    text =
      '✅ Оплата ' +
      rub(result.credit) +
      ' получена, но ' +
      (result.grace ? 'подписка сейчас в льготном периоде' : 'подписка уже закончилась') +
      '.\nДоп. устройство можно купить только вместе с активной подпиской.\nМы зачли ' +
      rub(result.credit) +
      (result.creditTotal > result.credit ? ' (всего зачёт ' + rub(result.creditTotal) + ')' : '') +
      ': сумма вычтется из следующего продления. Нажмите «Оплатить».';
  }
  if (!text || !sub) return null;
  return { text, inline, parseMode: 'Markdown', keyboard: mainKeyboard() };
}

/** YooMoney holds the transfer (`unaccepted`): tell the payer it arrived. */
export function pendingUserText(amount) {
  const sum = String(amount || '').trim();
  return (
    '⏳ Платёж' +
    (sum ? ' ' + sum + ' ₽' : '') +
    ' получен и ждёт подтверждения. Подписка продлится сама - платить ещё раз не нужно.\nЕсли что-то не так - «Поддержка».'
  );
}

/** The admin rejected a held payment. */
export function rejectUserText(amount) {
  const sum = String(amount || '').trim();
  return (
    'Платёж' +
    (sum ? ' ' + sum + ' ₽' : '') +
    ' не подтверждён - подписка не продлена.\nЕсли деньги списались, напишите в «Поддержку».'
  );
}

/** Telegram text to a user who got days from an admin (bot /grant and the panel). */
export function grantUserMessage(origin, result) {
  let text = 'Вам добавлено ' + daysText(result.days) + '. Подписка до ' + mskDateTime(result.paidUntil) + '.';
  let inline = null;
  if (result.code) {
    text += '\n' + codeBlock(origin, result.code);
    inline = rows([codeButtonRow(origin, result.code)]);
  }
  return { text, inline, parseMode: 'Markdown', keyboard: mainKeyboard() };
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

function deviceLabel(d, n, info) {
  const meta = info ? info(d.id) : null;
  const name = meta && meta.name ? String(meta.name).slice(0, 32) + ' ' : '';
  let line = n + ') ' + name + (d.deviceId || '').slice(0, 8) + '…';
  if (d.overLimit) line += d.overReason === 'extra_expired' ? ' · не работает: доп. устройство не продлено' : ' · не работает: сверх лимита устройств';
  else if (meta && meta.lastSeenAt > 0) line += ' · в сети ' + mskDateTime(meta.lastSeenAt);
  else if (d.boundAt > 0) line += ' · привязано ' + mskDate(d.boundAt);
  return line;
}

/**
 * «Устройства»: list with unbind buttons, a code for a free slot, and an offer for one more device.
 * Returns the messages to send and the next state (a code or a quote may be created).
 */
function devicesScreen(cur, { account, now, origin, checkout, info }) {
  const prices = priceText(cur.settings);
  const wallet = cur.settings.yoomoneyWallet;
  let state = cur;
  const out = [];
  let sub = subscriptionView(state, account.id, now);
  if (!sub) {
    out.push({
      text:
        'Подписки нет.\n«Оплатить» - ' + rub(prices.price) + ' за ' + daysText(prices.days) + ', ' + upToPhones(state) + '. На ТВ подписка не нужна.' + trialLine(state),
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
    sub = subscriptionView(state, account.id, now);
  }
  const bound = boundList(sub);
  if (!sub.active) lines.push(subscriptionHead(sub));
  else if (sub.inGrace) lines.push(subscriptionHead(sub));
  lines.push(devicesLine(sub) + (bound.length ? ':' : '.'));
  for (let i = 0; i < bound.length; i++) lines.push(deviceLabel(bound[i], i + 1, info));
  if (bound.length) {
    lines.push(
      swap.left > 0
        ? swapLeftLine(swap) + ' Отвязанное устройство сразу перестаёт работать.'
        : 'Смены устройства на 30 дней исчерпаны: следующая - с ' + mskDateTime(swap.nextAt) + '.',
    );
  }
  if (!sub.active) lines.push('Нажмите «Оплатить» - устройства заработают сами.');
  else if (code) lines.push('', codeBlock(origin, code));
  else lines.push(DEVICE_LIMIT_TEXT);

  const buttons = [];
  if (code) buttons.push(codeButtonRow(origin, code));
  if (bound.length && swap.left > 0) {
    const row = [];
    for (let i = 0; i < bound.length; i++) {
      row.push({ text: 'Отвязать ' + (i + 1), callback_data: 'u1:' + bound[i].id });
      if (row.length === 3) {
        buttons.push(row.splice(0));
      }
    }
    if (row.length) buttons.push(row);
    if (bound.length > 1) buttons.push([{ text: 'Отвязать все', callback_data: 'ua' }]);
  }
  out.push({ text: lines.join('\n'), inline: rows(buttons), parseMode: code ? 'Markdown' : undefined });

  // One more device: only when no slot is free. Sold alone only while the subscription is paid.
  if (sub.active && !code && wallet && prices.extra && prices.price) {
    const subRow = state.subscriptions.find((s) => s.id === sub.id);
    if (sub.paid) {
      const lapsing = lapsingExtras(state, subRow, now);
      const pay = checkout(state, { kind: 'dev', accountId: account.id, subscriptionId: sub.id }, 'OMP, устройство');
      state = pay.state;
      const nextRenewal = prices.price + (sub.extraSlots + 1) * prices.extra;
      const text =
        lapsing > 0
          ? 'Ещё одно устройство - ' +
            rub(pay.price) +
            ': ' +
            rub(prices.extra) +
            ' за новое и ' +
            rub(prices.extra) +
            ' × ' +
            lapsing +
            ' за доп. устройство, не продлённое вместе с подпиской. Все доп. устройства будут работать до ' +
            mskDate(sub.paidUntil) +
            ', дальше продлеваются вместе с подпиской: продление станет ' +
            rub(nextRenewal) +
            '.'
          : 'Ещё одно устройство - ' +
            rub(prices.extra) +
            ' до ' +
            mskDate(sub.paidUntil) +
            ' (конец оплаченного периода), дальше продлевается вместе с подпиской: продление станет ' +
            rub(nextRenewal) +
            '.';
      out.push({ text, inline: rows([[urlButton('Оплатить ' + rub(pay.price), pay.url)]]) });
    } else {
      // Grace: a standalone slot would die with the grace period. Renewal + one more device, one purchase.
      const r = renewalText(state, subRow, sub, now, { addExtra: 1 });
      const pay = checkout(state, { kind: 'sub', accountId: account.id, subscriptionId: sub.id, addExtra: 1 }, 'OMP, продление');
      state = pay.state;
      out.push({
        text: 'Сейчас льготный период - отдельно устройство не купить. Продлите подписку вместе с ним одной оплатой:\n' + r.text,
        inline: rows([[urlButton('Продлить + устройство - ' + rub(pay.price), pay.url)]]),
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
export function botCallback(state, { chatId, data, now, info }) {
  const raw = String(data || '');
  const account = accountByTelegram(state, chatId);
  const messages = [];
  const say = (text, extra) => messages.push({ chatId: String(chatId), text, keyboard: mainKeyboard(), ...(extra || {}) });
  const stale = 'Кнопка устарела - откройте «Устройства» ещё раз.';
  let cur = state;
  const origin = cur.settings.publicOrigin || '';
  const pay = makeCheckout(cur.settings);
  const checkout = (st, opts, targets) => pay(st, { ...opts, now }, targets);
  const showDevices = () => {
    const screen = devicesScreen(cur, { account, now, origin, checkout, info });
    cur = screen.state;
    for (const m of screen.out) say(m.text, { inline: m.inline || undefined, parseMode: m.parseMode });
  };
  if (!account) return { state, messages, answer: stale, clearMarkup: true };
  const sub = subscriptionView(cur, account.id, now);
  const bound = boundList(sub);
  const swapSub = mainSubscription(cur, account.id);

  if (raw === 'ux') return { state, messages, answer: 'Отменено', clearMarkup: true };

  if (raw.indexOf('u1:') === 0 || raw.indexOf('y1:') === 0) {
    const confirm = raw.indexOf('y1:') === 0;
    const bits = raw.slice(3).split(':');
    const idx = bound.findIndex((d) => d.id === bits[0]);
    const dev = idx >= 0 ? bound[idx] : null;
    if (!dev || (confirm && (dev.deviceId || '').slice(0, 8) !== bits[1])) {
      showDevices();
      return { state: cur, messages, answer: 'Устройство уже отвязано или сменилось.', clearMarkup: confirm };
    }
    const label = 'Устройство ' + (idx + 1) + ' (' + (dev.deviceId || '').slice(0, 8) + '…)';
    if (!confirm) {
      const swap = swapStatus(swapSub, now, 1);
      if (swap.left < 1) {
        say(swapLimitText(swap));
        return { state: cur, messages, answer: '', clearMarkup: false };
      }
      say(
        'Отвязать ' + label.charAt(0).toLowerCase() + label.slice(1) + '? Оно сразу перестанет работать.\nЭто 1 смена из ' + swap.limit + ' за 30 дней (останется ' + (swap.left - 1) + ').',
        {
          inline: {
            inline_keyboard: [[{ text: 'Да, отвязать', callback_data: 'y1:' + dev.id + ':' + (dev.deviceId || '').slice(0, 8) }, { text: 'Отмена', callback_data: 'ux' }]],
          },
        },
      );
      return { state: cur, messages, answer: '', clearMarkup: false };
    }
    const out = selfUnbind(cur, { accountId: account.id, deviceIds: [dev.deviceId], now });
    if (out.result.error === 'swap_limit') {
      say(swapLimitText(out.result));
      return { state: cur, messages, answer: '', clearMarkup: true };
    }
    if (out.result.error) {
      showDevices();
      return { state: cur, messages, answer: stale, clearMarkup: true };
    }
    cur = out.state;
    say(
      label + ' отвязано и больше не работает.\n' +
        (out.result.left > 0 ? swapLeftLine(out.result) : 'Это была последняя смена на 30 дней: следующая - с ' + mskDateTime(out.result.nextAt) + '.'),
    );
    showDevices();
    return { state: cur, messages, answer: 'Отвязано', clearMarkup: true };
  }

  if (raw === 'ua' || raw.indexOf('ya:') === 0) {
    const confirm = raw.indexOf('ya:') === 0;
    if (bound.length < 2 || (confirm && raw.slice(3) !== boundSig(bound))) {
      showDevices();
      return { state: cur, messages, answer: 'Список устройств изменился.', clearMarkup: confirm };
    }
    const swap = swapStatus(swapSub, now, bound.length);
    if (!confirm) {
      if (swap.left < bound.length) {
        say(
          'Отвязать все устройства (' + bound.length + ') сейчас нельзя: ' + swapLeftLine(swap).toLowerCase() +
            (swap.left > 0 ? '\nОтвяжите по одному кнопками «Отвязать N».' : (Number.isFinite(swap.nextAt) && swap.nextAt > 0 ? '\nСледующая смена - с ' + mskDateTime(swap.nextAt) + '.' : '')),
        );
        return { state: cur, messages, answer: '', clearMarkup: false };
      }
      say(
        'Отвязать все устройства (' + bound.length + ')? Они сразу перестанут работать.\nЭто ' + bound.length + ' ' + plural(bound.length, 'смена', 'смены', 'смен') + ' из ' + swap.limit + ' за 30 дней (останется ' + (swap.left - bound.length) + ').',
        { inline: { inline_keyboard: [[{ text: 'Да, отвязать все', callback_data: 'ya:' + boundSig(bound) }, { text: 'Отмена', callback_data: 'ux' }]] } },
      );
      return { state: cur, messages, answer: '', clearMarkup: false };
    }
    const out = selfUnbind(cur, { accountId: account.id, deviceIds: bound.map((d) => d.deviceId), now });
    if (out.result.error === 'swap_limit') {
      say(swapLimitText(out.result));
      return { state: cur, messages, answer: '', clearMarkup: true };
    }
    if (out.result.error) {
      showDevices();
      return { state: cur, messages, answer: stale, clearMarkup: true };
    }
    cur = out.state;
    say(
      'Все устройства отвязаны (' + out.result.unbound + ') и больше не работают.\n' +
        (out.result.left > 0 ? swapLeftLine(out.result) : 'Это была последняя смена на 30 дней: следующая - с ' + mskDateTime(out.result.nextAt) + '.'),
    );
    showDevices();
    return { state: cur, messages, answer: 'Отвязано', clearMarkup: true };
  }
  return { state, messages, answer: stale, clearMarkup: true };
}

/** Quote + YooMoney link. `{ state, url, price }`; url is '' when the quote failed. */
function makeCheckout(settings) {
  return (state, opts, targets) => {
    const quoted = quotePurchase(state, { ...opts, now: opts.now });
    if (quoted.result.error) return { state, url: '', price: 0 };
    return {
      state: quoted.state,
      url: payUrl(settings.yoomoneyWallet, { sum: quoted.result.price, label: quoted.result.label, targets }),
      price: quoted.result.price,
    };
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
        },
        now,
      )
    : ensureTelegramAccount(state, chatId, now);
  let cur = ensured.state;
  const account = ensured.account;
  const admin = isAdminChat(cur.settings, chatId);
  const prices = priceText(cur.settings);
  const sub = subscriptionView(cur, account.id, now);
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

  const say = (body, extra) => {
    const forceAdmin = extra && extra.adminPad === true;
    const forceUser = extra && extra.adminPad === false;
    const adminPad = forceUser ? false : forceAdmin || mode === 'admin';
    const rest = { ...(extra || {}) };
    delete rest.adminPad;
    if (!rest.inline) delete rest.inline;
    if (!rest.parseMode) delete rest.parseMode;
    messages.push({
      chatId: String(chatId),
      text: body,
      keyboard: admin && adminPad ? adminKeyboard() : mainKeyboard(),
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
      messages.push({
        chatId: String(target),
        text: 'Поддержка OMP:\n' + body,
        keyboard: mainKeyboard(),
      });
      say('Ответ отправлен пользователю ' + target + '.');
      return { state: cur, messages, pad: mode };
    }
  }

  if (action === 'link') {
    const out = confirmDeviceLink(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) say('Ссылка устарела или уже использована. В OMP нажмите «Привязать Telegram» ещё раз.');
    else say('Телефон привязан к этому Telegram.\n' + statusText(cur, subscriptionView(cur, account.id, now), account));
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin_login') {
    const out = confirmAdminPanelLogin(cur, { token: arg, telegramId: chatId, now });
    cur = out.state;
    if (out.result.error) {
      process.stderr.write(adminLoginFailureLine(out.result.error));
      if (out.result.error === 'wrong_user') {
        say('Нет доступа к панели. Добавьте свой Telegram id в настройках администраторов.');
      } else {
        say('Ссылка для входа устарела. Откройте панель снова и нажмите «Войти через Telegram».');
      }
    } else {
      say('Вход в админ-панель подтверждён. Вернитесь в браузер - страница откроется сама.');
    }
    return { state: cur, messages, pad: mode };
  }

  if (action === 'admin' || action === 'admin_summary' || action === 'admin_find' || action === 'admin_grant' || action === 'admin_promo') {
    if (!admin) {
      say('Нет доступа. Добавьте свой Telegram id в настройках панели.');
      return { state: cur, messages, pad: 'user' };
    }
  }

  if (action === 'user_mode') {
    say(
      (admin ? 'Режим пользователя - те же кнопки, что у подписчика. /admin - снова админ-кабинет.\n\n' : '') +
        'Личный кабинет\n\n' +
        statusText(cur, sub, account),
      { adminPad: false },
    );
  } else if (action === 'admin') {
    say('Админ-кабинет. Сводка, поиск, выдача дней и промокоды.\n«Как пользователь» - проверить кабинет подписчика.', { adminPad: true });
  } else if (action === 'admin_summary') {
    const s = adminSummary(cur, now);
    say(
      'Сводка:\nАккаунтов: ' + s.accounts + '\nАктивных подписок: ' + s.active + '\nПромокодов: ' + s.promos + '\nПривязанных устройств: ' + s.bound + '\nОтказов за сутки: ' + s.fails,
      { adminPad: true },
    );
  } else if (action === 'admin_find' && !arg) {
    say('Пришлите Telegram id, @ник, код XXXX-XXXX или начало device id.', { adminPad: true, await: { kind: 'admin_find' } });
  } else if (action === 'admin_find' && arg) {
    const found = adminFind(cur, arg, now);
    if (!found) say('Не найдено: ' + arg, { adminPad: true });
    else {
      const who = found.account.telegramId || found.account.id;
      let body = 'Аккаунт ' + who + '\n' + statusText(cur, found.sub, found.account, { admin: true });
      if (found.reveal) body += '\nСвободный код: ' + formatCode(found.reveal.code);
      say(body, { adminPad: true });
    }
  } else if (action === 'admin_grant' && !arg) {
    say('Пришлите Telegram id или @ник и число дней.\nПример: 123456789 30 или @nick 30', { adminPad: true, await: { kind: 'admin_grant' } });
  } else if (action === 'admin_grant' && arg) {
    const bits = arg.split(/\s+/);
    const days = Number(bits[1]);
    const target = grantTarget(cur, bits[0]);
    if (!target) {
      say(
        'Не найден пользователь «' + String(bits[0] || '').slice(0, 64) + '». Проверьте id или @ник - пользователь должен хотя бы раз написать боту. Новый аккаунт не создан.',
        { adminPad: true },
      );
    } else if (!Number.isInteger(days) || days < 1 || days > 3650) {
      say('Нужно целое число дней от 1 до 3650.\nПример: ' + (bits[0] || '123456789') + ' 30', { adminPad: true });
    } else {
      const out = grantDays(cur, { accountId: target.id, days, now });
      cur = out.state;
      if (out.result.error) say('Не вышло выдать дни.', { adminPad: true });
      else {
        const who = telegramDisplay(target) || target.telegramId;
        const note = grantUserMessage(origin, out.result);
        messages.push({ chatId: String(target.telegramId), ...note });
        say(
          'Выдано +' + daysText(out.result.days) + ' - ' + who + ', подписка до ' + mskDateTime(out.result.paidUntil) + '.\n' +
            (out.result.code ? 'Пользователю отправлены сообщение и код для свободного места.' : 'Пользователю отправлено сообщение. Свободных мест нет, новый код не выдан.'),
          { adminPad: true },
        );
      }
    }
  } else if (action === 'admin_promo' && !arg) {
    say('Формат: КОД дни лимит\nПример: DEMO1 1 50', { adminPad: true, await: { kind: 'admin_promo' } });
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
    if (out.result.error === 'exists') say('Такой промокод уже есть.', { adminPad: true });
    else if (out.result.error) say('Некорректный промокод.', { adminPad: true });
    else say('Промокод ' + out.result.promo.code + ' (' + promoText(out.result.promo) + ', до ' + out.result.promo.maxUses + ' исп.).', { adminPad: true });
  } else if (action === 'promo' && !arg) {
    say('Отправьте промокод одним сообщением.\nПример: DEMO1', { await: { kind: 'promo' } });
  } else if (action === 'promo' && arg) {
    const out = redeemPromo(cur, { code: arg, accountId: account.id, now });
    cur = out.state;
    if (out.result.error === 'bad_promo') say('Промокод не найден или уже не действует.');
    else if (out.result.error === 'already') say('Вы уже активировали этот промокод.');
    else if (out.result.error === 'exhausted') say('Этот промокод уже использовали все, кому можно.');
    else if (out.result.error === 'needs_subscription') say('Этот промокод добавляет устройство к подписке. Сначала оформите подписку - «Оплатить».');
    else {
      const b = out.result.bonus;
      const parts = [];
      if (out.result.days) parts.push('+' + daysText(out.result.days) + ', подписка до ' + mskDateTime(out.result.paidUntil));
      if (b) parts.push('+' + b.count + ' ' + (b.count === 1 ? 'устройство' : 'устройства') + ' бесплатно ' + (b.until ? 'до ' + mskDate(b.until) : 'навсегда'));
      const head = 'Промокод принят: ' + parts.join('; ') + '.';
      if (out.result.code) {
        say(head + '\n\n' + codeBlock(origin, out.result.code), { inline: rows([codeButtonRow(origin, out.result.code)]), parseMode: 'Markdown' });
      } else {
        say(head + '\nПривязанные устройства продолжают работать.');
      }
    }
  } else if (action === 'price') {
    const grace = graceDays(cur.settings);
    say(
      'Подписка OMP - ' + rub(prices.price) + ' за ' + daysText(prices.days) + ', ' + upToPhones(cur) + ': поиск в Jackett и JacRed.' +
        '\nПодписка нужна только на телефоне - на ТВ она не нужна.' +
        (prices.extra ? '\nДоп. устройство - ' + rub(prices.extra) + ' в месяц, продлевается вместе с подпиской.' : '') +
        (grace > 0 ? '\nПосле окончания ещё ' + daysText(grace) + ' поиск работает - можно спокойно продлить.' : '') +
        trialLine(cur),
    );
  } else if (action === 'pay') {
    if (!wallet || !prices.price) say('Оплата ещё не настроена.' + trialLine(cur));
    else if (!sub) {
      const p = checkout({ kind: 'new', accountId: account.id }, 'OMP Jackett и JacRed');
      say(
        'Подписка OMP - ' + rub(prices.price) + ' за ' + daysText(prices.days) + ', ' + upToPhones(cur) + '. На ТВ подписка не нужна.\nПосле оплаты в этот чат придёт код - введите его в OMP на телефоне.',
        { inline: rows([[urlButton('Оплатить ' + rub(p.price), p.url)]]) },
      );
    } else {
      const subRow = cur.subscriptions.find((s) => s.id === sub.id);
      const renewal = renewalText(cur, subRow, sub, now);
      const head = sub.active ? (sub.inGrace ? subscriptionHead(sub) + '\n\n' : '') : subscriptionHead(sub) + '\n\n';
      const full = checkout({ kind: 'sub', accountId: account.id, subscriptionId: sub.id }, 'OMP, продление');
      const buttons = [[urlButton('Оплатить ' + rub(full.price), full.url)]];
      let tail = '';
      if (renewal.quote.extras > 0) {
        const base = checkout({ kind: 'sub', accountId: account.id, subscriptionId: sub.id, withExtras: false }, 'OMP, продление');
        buttons.push([urlButton('Только подписка - ' + rub(base.price), base.url)]);
        const extraUntil = Number(subRow && subRow.extraUntil) || 0;
        if (!sub.active) {
          tail = '\nТолько подписка: доп. устройство останется отключённым (привязка сохранится).';
        } else if (extraUntil > 0) {
          tail =
            '\nТолько подписка: доп. устройство перестанет работать после ' +
            mskDateTime(extraUntil + graceDays(cur.settings) * 86400000) +
            ' (привязка сохранится).';
        } else {
          // extras counted but no end date stored - still say when, using the paid period
          const paidUntil = Number(sub.paidUntil) || 0;
          tail =
            paidUntil > 0
              ? '\nТолько подписка: доп. устройство перестанет работать после ' +
                mskDateTime(paidUntil + graceDays(cur.settings) * 86400000) +
                ' (привязка сохранится).'
              : '\nТолько подписка: доп. устройство перестанет работать после окончания текущего периода (привязка сохранится).';
        }
      }
      say(head + renewal.text + tail, { inline: rows(buttons) });
    }
  } else if (action === 'devices') {
    const screen = devicesScreen(cur, { account, now, origin, checkout: (st, opts, targets) => pay(st, { ...opts, now }, targets), info });
    cur = screen.state;
    for (const m of screen.out) say(m.text, { inline: m.inline || undefined, parseMode: m.parseMode });
  } else if (action === 'support' && !arg) {
    say('Напишите сообщение для администратора одним текстом.', { await: { kind: 'support' } });
  } else if (action === 'support' && arg) {
    if (supportTooFast(cur, chatId, now)) {
      say('Слишком много сообщений подряд - подождите 10 минут. Предыдущие сообщения администратор уже получил.');
      return { state: cur, messages, pad: mode };
    }
    const saved = appendSupportMessage(cur, { telegramId: String(chatId), text: arg, direction: 'in', now, via: 'bot' });
    cur = saved.state;
    const admins = adminChatIds(cur.settings);
    const notify = adminNotifyEnabled(cur.settings);
    say(
      admins.length
        ? notify
          ? 'Сообщение передано администратору. Ответ придёт в этот чат.'
          : 'Сообщение сохранено. Уведомления администраторам выключены.'
        : 'Сообщение сохранено. Администраторы в панели ещё не указаны.',
    );
    if (notify) {
      const note = 'Поддержка · ' + (telegramDisplay(account) || chatId) + '\n' + arg + '\n\nОтветьте на это сообщение - текст уйдёт пользователю.';
      for (let i = 0; i < admins.length; i++) {
        messages.push({ chatId: admins[i], text: note, keyboard: adminKeyboard(), supportNotify: String(chatId) });
      }
    }
  } else if (action === 'unknown') {
    say('Не понял. Выберите кнопку ниже или «Поддержка».\n\n' + statusText(cur, sub, account));
  } else {
    const hint = admin && mode === 'user' ? '\n\nВы админ. /admin - админ-кабинет.' : '';
    say('Личный кабинет\n\n' + statusText(cur, sub, account) + hint);
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
