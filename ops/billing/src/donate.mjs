/**
 * Donations are a separate payment. A paid row does not extend a subscription and is not a
 * payments-table row, so referral settlement (which reads payments) does not see it.
 * The flag and every method switch start off.
 */
import { randomId } from './crypto.mjs';
import { CRYPTO_ASSETS, formatAsset } from './cryptoPay.mjs';
import { logWebhook, mskDate, mskDateTime, mskDayStart } from './logic.mjs';
import { altCovers, starInvoiceBody } from './payMethods.mjs';
import { grossUp, payUrl, settledCovers } from './yoomoney.mjs';

const DAY = 24 * 60 * 60 * 1000;
const DRAFT_MS = 2 * 60 * 60 * 1000;
export const DONATE_THANKS_DEFAULT = 'Спасибо! Вы поддержали проект OMP.';

function flag(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseAmountText(value) {
  const parts = String(value == null || value === '' ? '100,300,500,1000' : value).split(/[^0-9]+/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) continue;
    if (out.indexOf(n) >= 0) continue;
    out.push(n);
    if (out.length >= 6) break;
  }
  return out;
}

export function normalizeDonateSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const minRub = clampInt(src.minRub, 50, 1, 1000000);
  let maxRub = clampInt(src.maxRub, 100000, 1, 1000000);
  if (maxRub < minRub) maxRub = minRub;
  const amounts = parseAmountText(src.amounts).filter((n) => n >= minRub && n <= maxRub);
  const rate = Number(src.rubPerStar);
  const thanks = String(src.thanksText == null ? DONATE_THANKS_DEFAULT : src.thanksText).replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    enabled: flag(src.enabled),
    amounts: amounts.join(','),
    minRub,
    maxRub,
    commentMax: clampInt(src.commentMax, 200, 20, 500),
    thanksText: thanks || DONATE_THANKS_DEFAULT,
    yoomoney: flag(src.yoomoney),
    stars: flag(src.stars),
    crypto: flag(src.crypto),
    rubPerStar: Number.isFinite(rate) && rate > 0 ? rate : 0,
    notifyAll: flag(src.notifyAll),
    notifyMin: clampInt(src.notifyMin, 0, 0, 1000000),
    showAmounts: flag(src.showAmounts),
  };
}

export function applyDonateSettings(prev, body) {
  const cur = normalizeDonateSettings(prev);
  const b = body || {};
  const next = { ...cur };
  const keys = ['enabled', 'amounts', 'minRub', 'maxRub', 'commentMax', 'thanksText', 'yoomoney', 'stars', 'crypto', 'rubPerStar', 'notifyAll', 'notifyMin', 'showAmounts'];
  for (let i = 0; i < keys.length; i++) if (b[keys[i]] !== undefined) next[keys[i]] = b[keys[i]];
  return normalizeDonateSettings(next);
}

export function donateAmountList(settings) {
  return normalizeDonateSettings(settings).amounts
    ? normalizeDonateSettings(settings).amounts.split(',').map((n) => Number(n))
    : [];
}

export function validateDonateAmount(settings, text) {
  const cfg = normalizeDonateSettings(settings);
  const raw = String(text == null ? '' : text).trim();
  if (!/^\d{1,7}$/.test(raw)) return { ok: false, error: 'Нужна сумма от ' + cfg.minRub + ' до ' + cfg.maxRub + ' ₽, целым числом.' };
  const rub = Number(raw);
  if (rub < cfg.minRub || rub > cfg.maxRub) return { ok: false, error: 'Нужна сумма от ' + cfg.minRub + ' до ' + cfg.maxRub + ' ₽, целым числом.' };
  return { ok: true, rub };
}

export function validateDonateComment(settings, text) {
  const cfg = normalizeDonateSettings(settings);
  const comment = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (comment.length > cfg.commentMax) return { ok: false, error: 'Комментарий длиннее ' + cfg.commentMax + ' символов.' };
  return { ok: true, comment };
}

export function starsForRub(rub, rubPerStar) {
  const rate = Number(rubPerStar);
  const base = Math.round(Number(rub));
  if (!(rate > 0) || !(base > 0)) return 0;
  const stars = Math.ceil(base / rate - 1e-9);
  if (!Number.isInteger(stars) || stars < 1 || stars > 1000000) return 0;
  return stars;
}

function rateOf(settings, asset) {
  if (asset === 'USDT') return Number(settings.cryptoRateUsdt) || 0;
  if (asset === 'TON') return Number(settings.cryptoRateTon) || 0;
  if (asset === 'BTC') return Number(settings.cryptoRateBtc) || 0;
  return 0;
}

export function donateCryptoAmount(settings, asset, rub) {
  const rate = rateOf(settings || {}, asset);
  const base = Number(rub) || 0;
  if (!(rate > 0) || !(base > 0)) return '';
  return formatAsset(asset, base / rate);
}

function rubText(n) {
  const kop = Math.round(Number(n) * 100);
  if (!Number.isFinite(kop)) return '0 ₽';
  const whole = Math.floor(Math.abs(kop) / 100);
  const frac = Math.abs(kop) % 100;
  return (kop < 0 ? '-' : '') + whole + (frac ? ',' + String(frac).padStart(2, '0') : '') + ' ₽';
}

export function donateFeeText(rub) {
  const pc = grossUp(rub, 'PC');
  const ac = grossUp(rub, 'AC');
  const text =
    'Комиссия ЮMoney удерживается с получателя и уже включена в сумму, чтобы после неё осталась сумма доната.\n' +
    'Кошелёк: ' + rubText(rub) + ' + ' + rubText(pc && pc.fee) + ' = ' + rubText(pc && pc.gross) + '\n' +
    'Карта: ' + rubText(rub) + ' + ' + rubText(ac && ac.fee) + ' = ' + rubText(ac && ac.gross);
  return { pc, ac, text };
}

function cfgOf(state) {
  return normalizeDonateSettings(state && state.settings && state.settings.donate);
}

function nameOf(account) {
  return String((account && (account.telegramName || account.telegramUsername)) || '').trim().slice(0, 80);
}

function freshDraft(account, now) {
  return {
    id: randomId(),
    accountId: account.id,
    telegramId: String(account.telegramId || ''),
    displayName: nameOf(account),
    showName: false,
    nameHidden: false,
    comment: '',
    commentHidden: false,
    amountRub: 0,
    method: '',
    asset: '',
    payAmount: '',
    gross: '',
    fee: '',
    status: 'draft',
    step: 'amount',
    operationId: '',
    invoiceId: '',
    createdAt: now || Date.now(),
    paidAt: 0,
    refundedAt: 0,
  };
}

function openDraft(state, accountId, now) {
  const rows = state.donations || [];
  let found = null;
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    if (!d || d.accountId !== accountId || d.status !== 'draft') continue;
    if (now - (Number(d.createdAt) || 0) > DRAFT_MS) continue;
    if (!found || (d.createdAt || 0) >= (found.createdAt || 0)) found = d;
  }
  return found;
}

function putDonation(state, row) {
  return { ...state, donations: (state.donations || []).map((d) => (d && d.id === row.id ? row : d)) };
}

function addDraft(state, row) {
  const donations = (state.donations || []).map((d) =>
    d && d.accountId === row.accountId && d.status === 'draft' ? { ...d, status: 'cancelled', step: '' } : d,
  );
  return { ...state, donations: donations.concat([row]) };
}

function amountKeyboard(settings) {
  const nums = donateAmountList(settings);
  const rows = [];
  for (let i = 0; i < nums.length; i += 2) {
    const row = [{ text: nums[i] + ' ₽', callback_data: 'dn:a:' + nums[i] }];
    if (nums[i + 1]) row.push({ text: nums[i + 1] + ' ₽', callback_data: 'dn:a:' + nums[i + 1] });
    rows.push(row);
  }
  rows.push([{ text: 'Своя сумма', callback_data: 'dn:c' }]);
  return { inline_keyboard: rows };
}

function commentScreen(settings, id) {
  const cfg = normalizeDonateSettings(settings);
  return {
    text: 'Комментарий к донату, по желанию. До ' + cfg.commentMax + ' символов.',
    inline: { inline_keyboard: [[{ text: 'Без комментария', callback_data: 'dn:s:' + id }]] },
  };
}

function nameScreen(id) {
  return {
    text: 'Показать моё имя в списке благодарностей? Сейчас имя скрыто.',
    inline: {
      inline_keyboard: [[
        { text: 'Показать имя', callback_data: 'dn:n:' + id + ':1' },
        { text: 'Не показывать', callback_data: 'dn:n:' + id + ':0' },
      ]],
    },
  };
}

function cryptoAllowed(settings, account, asset) {
  const cfg = normalizeDonateSettings(settings && settings.donate);
  if (!cfg.crypto) return false;
  if (settings && settings.cryptoNonRu === true) {
    const code = String((account && account.country) || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === 'RU') return false;
  }
  return rateOf(settings || {}, asset) > 0;
}

function methodScreen(state, account, row) {
  const cfg = cfgOf(state);
  const lines = ['Как оплатить ' + row.amountRub + ' ₽?'];
  const buttons = [];
  if (cfg.yoomoney && state.settings.yoomoneyWallet) {
    lines.push(donateFeeText(row.amountRub).text);
    const pc = grossUp(row.amountRub, 'PC');
    const ac = grossUp(row.amountRub, 'AC');
    if (pc) buttons.push([{ text: 'Кошелёк - ' + rubText(pc.gross), callback_data: 'dn:p:' + row.id + ':PC' }]);
    if (ac) buttons.push([{ text: 'Карта - ' + rubText(ac.gross), callback_data: 'dn:p:' + row.id + ':AC' }]);
  }
  const stars = cfg.stars ? starsForRub(row.amountRub, cfg.rubPerStar) : 0;
  if (stars >= 1) buttons.push([{ text: 'Звёзды - ' + stars, callback_data: 'dn:p:' + row.id + ':XTR' }]);
  if (cfg.crypto) {
    for (let i = 0; i < CRYPTO_ASSETS.length; i++) {
      const asset = CRYPTO_ASSETS[i];
      if (!cryptoAllowed(state.settings, account, asset)) continue;
      const amount = donateCryptoAmount(state.settings, asset, row.amountRub);
      if (!amount) continue;
      buttons.push([{ text: asset + ' - ' + amount, callback_data: 'dn:p:' + row.id + ':' + asset }]);
    }
  }
  if (!buttons.length) return { text: 'Способы оплаты доната не включены.', inline: undefined };
  return { text: lines.join('\n'), inline: { inline_keyboard: buttons } };
}

function lockMethod(state, account, row, method) {
  const cfg = cfgOf(state);
  const named = { ...row, displayName: nameOf(account) || row.displayName };
  if (method === 'PC' || method === 'AC') {
    if (!cfg.yoomoney || !state.settings.yoomoneyWallet) return { error: 'ЮMoney для доната выключена' };
    const up = grossUp(named.amountRub, method);
    if (!up) return { error: 'Сумма не подходит' };
    const title = method === 'PC' ? 'Кошелёк' : 'Карта';
    const url = payUrl(state.settings.yoomoneyWallet, { sum: up.gross, label: 'don:' + named.id, paymentType: method });
    return {
      row: { ...named, method, asset: '', payAmount: up.gross, gross: up.gross, fee: up.fee, status: 'pending', step: '' },
      text: title + ' - ' + rubText(up.gross) + '. Комиссия уже в сумме.',
      inline: { inline_keyboard: [[{ text: title + ' - ' + rubText(up.gross), url }]] },
    };
  }
  if (method === 'XTR') {
    const stars = starsForRub(named.amountRub, cfg.rubPerStar);
    if (!cfg.stars || stars < 1) return { error: 'Звёзды для доната выключены' };
    return {
      row: { ...named, method: 'stars', asset: 'XTR', payAmount: String(stars), gross: '', fee: '', status: 'pending', step: '' },
      text: 'Счёт на ' + stars + ' звёзд. Комиссия сверху не добавляется.',
      invoice: starInvoiceBody(named.telegramId, {
        title: 'Донат OMP',
        description: 'Донат OMP, ' + named.amountRub + ' ₽',
        payload: 'don:' + named.id,
        stars,
      }),
    };
  }
  if (CRYPTO_ASSETS.indexOf(method) >= 0) {
    const amount = donateCryptoAmount(state.settings, method, named.amountRub);
    if (!cfg.crypto || !amount || !cryptoAllowed(state.settings, account, method)) return { error: 'Крипта для доната выключена' };
    return {
      row: { ...named, method: 'crypto', asset: method, payAmount: amount, gross: '', fee: '', status: 'pending', step: '' },
      text: method + ' ' + amount + '. Ссылка на оплату:',
      cryptoIssue: { donationId: named.id },
    };
  }
  return { error: 'Кнопка устарела' };
}

export function donateMenu(state, account, now) {
  const cfg = cfgOf(state);
  if (!cfg.enabled) return { state, text: 'Поддержка проекта сейчас выключена.' };
  return {
    state,
    text: 'Поддержать проект OMP. Выберите сумму.',
    inline: amountKeyboard(cfg),
    now,
  };
}

export function donateOnText(state, account, text, now) {
  if (!account) return null;
  const draft = openDraft(state, account.id, now || Date.now());
  if (!draft || (draft.step !== 'amount' && draft.step !== 'comment')) return null;
  const cfg = cfgOf(state);
  if (draft.step === 'amount') {
    const check = validateDonateAmount(cfg, text);
    if (!check.ok) return { state, text: check.error };
    const row = { ...draft, amountRub: check.rub, step: 'comment', displayName: nameOf(account) || draft.displayName };
    const screen = commentScreen(cfg, row.id);
    return { state: putDonation(state, row), text: screen.text, inline: screen.inline };
  }
  const check = validateDonateComment(cfg, text);
  if (!check.ok) return { state, text: check.error };
  const row = { ...draft, comment: check.comment, step: 'name' };
  const screen = nameScreen(row.id);
  return { state: putDonation(state, row), text: screen.text, inline: screen.inline };
}

function draftById(state, account, id, now) {
  const row = (state.donations || []).find((d) => d && d.id === id && d.accountId === account.id && d.status === 'draft');
  if (!row) return null;
  if ((now || Date.now()) - (Number(row.createdAt) || 0) > DRAFT_MS) return null;
  return row;
}

function pendingById(state, account, id) {
  return (
    (state.donations || []).find((d) => d && d.id === id && d.accountId === account.id && d.status === 'pending' && d.held !== true) ||
    null
  );
}

/** The same frozen checkout, so a lost Telegram message can be asked for again. */
function resendCheckout(state, row) {
  if (row.method === 'PC' || row.method === 'AC') {
    if (!state.settings.yoomoneyWallet || !row.gross) return { error: 'Счёт не найден' };
    const title = row.method === 'PC' ? 'Кошелёк' : 'Карта';
    const url = payUrl(state.settings.yoomoneyWallet, { sum: row.gross, label: 'don:' + row.id, paymentType: row.method });
    return {
      text: title + ' - ' + rubText(row.gross) + '. Комиссия уже в сумме.',
      inline: { inline_keyboard: [[{ text: title + ' - ' + rubText(row.gross), url }]] },
    };
  }
  if (row.method === 'stars') {
    const stars = Number(row.payAmount);
    if (!Number.isInteger(stars) || stars < 1) return { error: 'Счёт не найден' };
    return {
      text: 'Счёт на ' + stars + ' звёзд. Комиссия сверху не добавляется.',
      invoice: starInvoiceBody(row.telegramId, {
        title: 'Донат OMP',
        description: 'Донат OMP, ' + row.amountRub + ' ₽',
        payload: 'don:' + row.id,
        stars,
      }),
    };
  }
  if (row.method === 'crypto' && row.asset && row.payAmount) {
    return {
      text: row.asset + ' ' + row.payAmount + '. Ссылка на оплату:',
      cryptoIssue: { donationId: row.id },
    };
  }
  return { error: 'Счёт не найден' };
}

export function donateOnCallback(state, account, data, now) {
  const raw = String(data || '');
  if (raw.indexOf('dn:') !== 0) return null;
  if (!account) return { state, answer: 'Кнопка устарела' };
  const at = now || Date.now();
  const cfg = cfgOf(state);
  if (!cfg.enabled) return { state, text: 'Поддержка проекта сейчас выключена.', answer: 'Выключено' };
  if (raw.indexOf('dn:a:') === 0) {
    const check = validateDonateAmount(cfg, raw.slice(5));
    if (!check.ok) return { state, text: check.error, answer: 'Сумма не подходит' };
    const row = freshDraft(account, at);
    row.amountRub = check.rub;
    row.step = 'comment';
    const screen = commentScreen(cfg, row.id);
    return { state: addDraft(state, row), text: screen.text, inline: screen.inline, answer: '' };
  }
  if (raw === 'dn:c') {
    const row = freshDraft(account, at);
    return {
      state: addDraft(state, row),
      text: 'Напишите сумму от ' + cfg.minRub + ' до ' + cfg.maxRub + ' ₽, целым числом.',
      answer: '',
    };
  }
  const bits = raw.split(':');
  const id = bits[2] || '';
  const row = draftById(state, account, id, at);
  if (bits[1] === 'p') {
    const pending = pendingById(state, account, id);
    if (pending) {
      const again = resendCheckout(state, pending);
      if (again.error) return { state, answer: again.error };
      return { state, text: again.text, inline: again.inline, invoice: again.invoice, cryptoIssue: again.cryptoIssue, answer: '' };
    }
    const heldRow = (state.donations || []).find((d) => d && d.id === id && d.accountId === account.id && d.status === 'pending' && d.held === true);
    if (heldRow) return { state, answer: 'Платёж уже у ЮMoney и ждёт подтверждения' };
    if (!row || row.step !== 'method') return { state, answer: 'Кнопка устарела' };
    const locked = lockMethod(state, account, row, bits[3] || '');
    if (locked.error) return { state, text: locked.error, answer: locked.error };
    return {
      state: putDonation(state, locked.row),
      text: locked.text,
      inline: locked.inline,
      invoice: locked.invoice,
      cryptoIssue: locked.cryptoIssue,
      answer: '',
    };
  }
  if (!row) return { state, answer: 'Кнопка устарела' };
  if (bits[1] === 's') {
    if (row.step !== 'comment') return { state, answer: 'Кнопка устарела' };
    const next = { ...row, comment: '', step: 'name' };
    const screen = nameScreen(next.id);
    return { state: putDonation(state, next), text: screen.text, inline: screen.inline, answer: '' };
  }
  if (bits[1] === 'n') {
    if (row.step !== 'name') return { state, answer: 'Кнопка устарела' };
    const next = { ...row, showName: bits[3] === '1', step: 'method', displayName: nameOf(account) || row.displayName };
    const screen = methodScreen(state, account, next);
    return { state: putDonation(state, next), text: screen.text, inline: screen.inline, answer: '' };
  }
  return { state, answer: 'Кнопка устарела' };
}

function methodLabel(row) {
  if (!row) return '';
  if (row.method === 'PC') return 'ЮMoney, кошелёк';
  if (row.method === 'AC') return 'ЮMoney, карта';
  if (row.method === 'stars') return 'Telegram Stars';
  if (row.method === 'crypto') return 'Crypto Pay ' + (row.asset || '');
  return row.method || '';
}

function coversDonation(row, notice) {
  if (row.method === 'PC' || row.method === 'AC') {
    return settledCovers(notice.amount, notice.currency, { method: row.method, price: row.amountRub, gross: row.gross }, {
      notificationType: notice.notificationType,
      withdrawAmount: notice.withdrawAmount,
      requireWithdraw: notice.requireWithdraw,
    });
  }
  if (row.method === 'stars') {
    return altCovers(notice.amount, notice.currency, { method: 'stars', asset: 'XTR', payAmount: row.payAmount });
  }
  if (row.method === 'crypto') {
    if (row.invoiceId && String(notice.operationId || '') !== 'crypto:' + row.invoiceId) return false;
    return altCovers(notice.amount, notice.currency, { method: 'crypto', asset: row.asset, payAmount: row.payAmount });
  }
  return false;
}

function isUnaccepted(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function applyDonation(state, notice) {
  const src = notice || {};
  const now = src.now || Date.now();
  const label = String(src.label || '');
  const operationId = String(src.operationId || '');
  const noted = (kind) => logWebhook(state, { kind, operationId, label, amount: String(src.amount || ''), at: now });
  if (!operationId || label.indexOf('don:') !== 0) {
    return { state: noted('bad_label'), result: { error: 'bad_label', kind: 'donate' } };
  }
  const held = (state.donations || []).find((d) => d && d.operationId === operationId && (d.status === 'paid' || d.status === 'refunded'));
  if (held) {
    return { state: noted('duplicate'), result: { duplicate: true, kind: 'donate', accountId: held.accountId } };
  }
  const id = label.slice(4);
  const row = (state.donations || []).find((d) => d && d.id === id);
  if (!row || row.status === 'cancelled' || row.status === 'draft') {
    return { state: noted('bad_label'), result: { error: 'bad_label', kind: 'donate' } };
  }
  if (row.status === 'paid' || row.status === 'refunded') {
    return { state: noted('duplicate'), result: { duplicate: true, kind: 'donate', accountId: row.accountId } };
  }
  if (row.status !== 'pending') {
    return { state: noted('bad_label'), result: { error: 'bad_label', kind: 'donate' } };
  }
  if (isUnaccepted(src.unaccepted)) {
    if (row.held && row.operationId) {
      return {
        state: noted('duplicate'),
        result: { duplicate: true, pending: true, kind: 'donate', accountId: row.accountId, amountRub: row.amountRub },
      };
    }
    const saved = {
      ...row,
      held: true,
      operationId,
      heldAmount: String(src.amount || ''),
      heldCurrency: String(src.currency || ''),
      withdrawAmount: src.withdrawAmount == null ? '' : String(src.withdrawAmount),
      notificationType: String(src.notificationType || ''),
      requireWithdraw: src.requireWithdraw === true || src.requireWithdraw === 'true',
      heldAt: now,
    };
    return {
      state: putDonation(state, saved),
      result: { pending: true, kind: 'donate', accountId: row.accountId, amountRub: row.amountRub, donation: saved },
    };
  }
  if (!coversDonation(row, src)) {
    return { state: noted('amount'), result: { error: 'amount', kind: 'donate', accountId: row.accountId } };
  }
  const saved = { ...row, status: 'paid', held: false, operationId, paidAt: now, step: '' };
  return {
    state: putDonation(state, saved),
    result: { kind: 'donate', accountId: row.accountId, amountRub: row.amountRub, donation: saved },
  };
}

/** Admin confirms a held YooMoney donation. It does not go through subscription payments. */
export function confirmDonateHold(state, { id, now }) {
  const row = (state.donations || []).find((d) => d && d.id === id && d.status === 'pending' && d.held === true);
  if (!row || !row.operationId) return { state, result: { error: 'not_found' } };
  return applyDonation(state, {
    operationId: row.operationId,
    label: 'don:' + row.id,
    amount: row.heldAmount,
    currency: row.heldCurrency || '643',
    unaccepted: false,
    withdrawAmount: row.withdrawAmount,
    notificationType: row.notificationType,
    requireWithdraw: row.requireWithdraw === true,
    now: now || Date.now(),
  });
}

export function donateStarCheckout(state, query) {
  const q = query || {};
  const cfg = cfgOf(state);
  if (!cfg.enabled || !cfg.stars) return { ok: false, error: 'Донат звёздами выключен' };
  const payload = String(q.invoice_payload || '');
  if (payload.indexOf('don:') !== 0) return { ok: false, error: 'Счёт не найден' };
  const row = (state.donations || []).find((d) => d && d.id === payload.slice(4));
  if (!row || row.method !== 'stars' || row.status !== 'pending') return { ok: false, error: 'Счёт не найден' };
  const fromId = q.from && q.from.id != null ? String(q.from.id) : '';
  if (!row.telegramId || row.telegramId !== fromId) return { ok: false, error: 'Счёт выставлен другому аккаунту' };
  if (String(q.currency || '') !== 'XTR') return { ok: false, error: 'Неверная валюта' };
  if (!altCovers(q.total_amount, 'XTR', { method: 'stars', asset: 'XTR', payAmount: row.payAmount })) {
    return { ok: false, error: 'Сумма не сходится' };
  }
  return { ok: true };
}

export function donateThanksText(settings) {
  return normalizeDonateSettings(settings && settings.donate).thanksText;
}

export function donateNoticeText(settings, row) {
  if (!row || row.status !== 'paid') return '';
  const cfg = normalizeDonateSettings(settings && settings.donate);
  const amount = Number(row.amountRub) || 0;
  if (!(cfg.notifyAll || (cfg.notifyMin > 0 && amount >= cfg.notifyMin))) return '';
  const who = row.displayName || row.telegramId || 'без имени';
  let text = 'Донат ' + amount + ' ₽, ' + methodLabel(row) + ', от ' + who;
  if (row.comment && !row.commentHidden) text += '\n' + row.comment;
  return text;
}

export function accountSupported(state, accountId) {
  return (state.donations || []).some((d) => d && d.accountId === accountId && d.status === 'paid');
}

export function publicThanks(state) {
  const cfg = cfgOf(state);
  const rows = (state.donations || []).filter((d) => d && d.status === 'paid' && d.showName && !d.nameHidden);
  rows.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));
  const names = [];
  for (let i = 0; i < rows.length && names.length < 100; i++) {
    const item = { name: String(rows[i].displayName || '').trim() || 'Участник' };
    if (cfg.showAmounts) item.amount = rows[i].amountRub;
    names.push(item);
  }
  return { showAmounts: cfg.showAmounts === true, names };
}

function filterRows(state, filter) {
  const f = filter || {};
  let rows = (state.donations || []).filter((d) => d && d.status !== 'draft' && d.status !== 'cancelled');
  if (f.status && f.status !== 'all') rows = rows.filter((d) => d.status === f.status);
  if (f.method === 'yoomoney') rows = rows.filter((d) => d.method === 'PC' || d.method === 'AC');
  else if (f.method === 'stars') rows = rows.filter((d) => d.method === 'stars');
  else if (f.method === 'crypto') rows = rows.filter((d) => d.method === 'crypto');
  if (f.from) rows = rows.filter((d) => (d.paidAt || d.createdAt || 0) >= Number(f.from));
  if (f.to) rows = rows.filter((d) => (d.paidAt || d.createdAt || 0) <= Number(f.to));
  rows.sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0));
  return rows;
}

function feedRow(d) {
  const at = d.paidAt || d.createdAt || 0;
  return {
    id: d.id,
    at,
    atText: at ? mskDateTime(at) : '',
    who: d.displayName || d.telegramId || '',
    telegramId: d.telegramId || '',
    amountRub: d.amountRub || 0,
    method: methodLabel(d),
    methodCode: d.method || '',
    comment: d.comment || '',
    commentHidden: d.commentHidden === true,
    nameHidden: d.nameHidden === true,
    showName: d.showName === true,
    status: d.status || '',
    held: d.held === true && d.status === 'pending',
    operationId: d.operationId || '',
  };
}

function pack(paid, from) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < paid.length; i++) {
    if ((paid[i].paidAt || 0) < from) continue;
    sum += Number(paid[i].amountRub) || 0;
    count += 1;
  }
  return { sum, count, average: count ? Math.round((sum / count) * 100) / 100 : 0 };
}

export function donateReport(state, now, filter) {
  const at = now || Date.now();
  const paid = (state.donations || []).filter((d) => d && d.status === 'paid');
  const day = mskDayStart(at);
  const start = day - 29 * DAY;
  const chart = [];
  for (let i = 0; i < 30; i++) {
    const from = start + i * DAY;
    const to = from + DAY;
    let rub = 0;
    for (let j = 0; j < paid.length; j++) {
      const t = paid[j].paidAt || 0;
      if (t >= from && t < to) rub += Number(paid[j].amountRub) || 0;
    }
    chart.push({ day: mskDate(from + 12 * 60 * 60 * 1000).slice(0, 5), rub });
  }
  const by = new Map();
  for (let i = 0; i < paid.length; i++) {
    const d = paid[i];
    const key = d.accountId || d.telegramId || d.id;
    const cur = by.get(key) || { who: d.displayName || d.telegramId || 'без имени', sum: 0, count: 0 };
    cur.sum += Number(d.amountRub) || 0;
    cur.count += 1;
    if (d.displayName) cur.who = d.displayName;
    by.set(key, cur);
  }
  const top = Array.from(by.values())
    .sort((a, b) => b.sum - a.sum || b.count - a.count)
    .slice(0, 10);
  return {
    rows: filterRows(state, filter).slice(0, 200).map(feedRow),
    summary: { day: pack(paid, day), week: pack(paid, day - 6 * DAY), month: pack(paid, day - 29 * DAY) },
    chart,
    top,
  };
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function donateCsv(state, filter) {
  const lines = ['time,who,telegram,amount_rub,method,comment,comment_hidden,status,operation'];
  const rows = filterRows(state, filter);
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    const at = d.paidAt || d.createdAt || 0;
    lines.push(
      [
        csvCell(at ? mskDateTime(at) : ''),
        csvCell(d.displayName || ''),
        csvCell(d.telegramId || ''),
        csvCell(d.amountRub || 0),
        csvCell(methodLabel(d)),
        csvCell(d.comment || ''),
        csvCell(d.commentHidden ? '1' : '0'),
        csvCell(d.status || ''),
        csvCell(d.operationId || ''),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function markDonateRefund(state, { id, now }) {
  const row = (state.donations || []).find((d) => d && d.id === id && d.status === 'paid');
  if (!row) return state;
  return putDonation(state, { ...row, status: 'refunded', refundedAt: now || Date.now() });
}

export function hideDonateField(state, { id, field }) {
  const row = (state.donations || []).find((d) => d && d.id === id);
  if (!row) return state;
  if (field === 'name') return putDonation(state, { ...row, nameHidden: !row.nameHidden });
  if (field === 'comment') return putDonation(state, { ...row, commentHidden: !row.commentHidden });
  return state;
}

export function rememberDonateInvoice(state, id, invoice) {
  const row = (state.donations || []).find((d) => d && d.id === id);
  if (!row || !invoice) return state;
  if (row.invoiceId && (row.payUrl || row.webUrl)) return state;
  return putDonation(state, {
    ...row,
    invoiceId: String(invoice.invoiceId || row.invoiceId || ''),
    payUrl: invoice.botUrl || row.payUrl || '',
    webUrl: invoice.webUrl || row.webUrl || '',
  });
}
