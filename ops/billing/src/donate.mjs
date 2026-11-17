/**
 * Donations are a separate payment. A paid row does not extend a subscription and is not a
 * payments-table row, so referral settlement (which reads payments) does not see it.
 * The flag and every method switch start off.
 */
import { randomId } from './crypto.mjs';
import { CRYPTO_ASSETS, formatAsset } from './cryptoPay.mjs';
import { copyText, str } from './botCopy.mjs';
import { logWebhook, mskDate, mskDateTime, mskDayStart } from './logic.mjs';
import { altCovers, starInvoiceBody } from './payMethods.mjs';
import { paymentPricing } from './rates.mjs';
import { grossUp, payUrl, settledCovers } from './yoomoney.mjs';

const DAY = 24 * 60 * 60 * 1000;
const CRYPTO_INVOICE_MS = 24 * 60 * 60 * 1000;
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

export function validateDonateAmount(settings, text, lang) {
  const cfg = normalizeDonateSettings(settings);
  const raw = String(text == null ? '' : text).trim();
  const error = str('don.amount_bad', lang, { min: cfg.minRub, max: cfg.maxRub });
  if (!/^\d{1,7}$/.test(raw)) return { ok: false, error };
  const rub = Number(raw);
  if (rub < cfg.minRub || rub > cfg.maxRub) return { ok: false, error };
  return { ok: true, rub };
}

export function validateDonateComment(settings, text, lang) {
  const cfg = normalizeDonateSettings(settings);
  const comment = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (comment.length > cfg.commentMax) return { ok: false, error: str('don.comment_bad', lang, { max: cfg.commentMax }) };
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

function rateOf(price, asset) {
  if (asset === 'USDT') return Number(price.cryptoRateUsdt) || 0;
  if (asset === 'TON') return Number(price.cryptoRateTon) || 0;
  if (asset === 'BTC') return Number(price.cryptoRateBtc) || 0;
  return 0;
}

export function donateCryptoAmount(settings, asset, rub, now) {
  const rate = rateOf(paymentPricing(settings, now), asset);
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

export function donateFeeText(rub, lang) {
  const pc = grossUp(rub, 'PC');
  const ac = grossUp(rub, 'AC');
  const text =
    str('offer.donate_fee_note', lang) +
    str('offer.wallet_line', lang, { base: rubText(rub), fee: rubText(pc && pc.fee), gross: rubText(pc && pc.gross) }) + '\n' +
    str('offer.card_line', lang, { base: rubText(rub), fee: rubText(ac && ac.fee), gross: rubText(ac && ac.gross) });
  return { pc, ac, text };
}

function cfgOf(state) {
  return normalizeDonateSettings(state && state.settings && state.settings.donate);
}

function nameOf(account) {
  return String((account && (account.telegramName || account.telegramUsername)) || '').trim().slice(0, 80);
}

export { nameOf as donateDisplayName };

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

function amountKeyboard(settings, lang) {
  const nums = donateAmountList(settings);
  const rows = [];
  for (let i = 0; i < nums.length; i += 2) {
    const row = [{ text: nums[i] + ' ₽', callback_data: 'dn:a:' + nums[i] }];
    if (nums[i + 1]) row.push({ text: nums[i + 1] + ' ₽', callback_data: 'dn:a:' + nums[i + 1] });
    rows.push(row);
  }
  rows.push([{ text: str('btn.custom_amount', lang), callback_data: 'dn:c' }]);
  return { inline_keyboard: rows };
}

function commentScreen(settings, id, lang) {
  const cfg = normalizeDonateSettings(settings);
  return {
    text: str('don.comment', lang, { max: cfg.commentMax }),
    inline: { inline_keyboard: [[{ text: str('btn.no_comment', lang), callback_data: 'dn:s:' + id }]] },
    copy: { id: 'donate.comment', vars: { comment_max: String(cfg.commentMax) } },
  };
}

function nameScreen(id, account, lang) {
  return {
    text: str('don.name', lang),
    copy: { id: 'donate.name', vars: { name: nameOf(account) } },
    inline: {
      inline_keyboard: [[
        { text: str('btn.show_name', lang), callback_data: 'dn:n:' + id + ':1' },
        { text: str('btn.hide_name', lang), callback_data: 'dn:n:' + id + ':0' },
      ]],
    },
  };
}

/** Crypto donate switch and the non-RU country rule. Does not look at the rate. */
export function cryptoDonateOpen(settings, account) {
  const cfg = normalizeDonateSettings(settings && settings.donate);
  if (!cfg.crypto) return false;
  if (settings && settings.cryptoNonRu === true) {
    const code = String((account && account.country) || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === 'RU') return false;
  }
  return true;
}

export function cryptoAllowed(settings, account, asset, now) {
  if (!cryptoDonateOpen(settings, account)) return false;
  return rateOf(paymentPricing(settings, now), asset) > 0;
}

function methodScreen(state, account, row, now, lang) {
  const cfg = cfgOf(state);
  const price = paymentPricing(state.settings, now);
  const lines = [str('don.methods', lang, { amount: row.amountRub })];
  const buttons = [];
  if (cfg.yoomoney && state.settings.yoomoneyWallet) {
    lines.push(donateFeeText(row.amountRub, lang).text);
    const pc = grossUp(row.amountRub, 'PC');
    const ac = grossUp(row.amountRub, 'AC');
    if (pc) buttons.push([{ text: str('btn.wallet', lang, { amount: rubText(pc.gross) }), callback_data: 'dn:p:' + row.id + ':PC' }]);
    if (ac) buttons.push([{ text: str('btn.card', lang, { amount: rubText(ac.gross) }), callback_data: 'dn:p:' + row.id + ':AC' }]);
  }
  const stars = cfg.stars ? starsForRub(row.amountRub, price.rubPerStar) : 0;
  if (stars >= 1) buttons.push([{ text: str('btn.stars', lang, { amount: stars }), callback_data: 'dn:p:' + row.id + ':XTR' }]);
  if (cfg.crypto) {
    for (let i = 0; i < CRYPTO_ASSETS.length; i++) {
      const asset = CRYPTO_ASSETS[i];
      if (!cryptoAllowed(state.settings, account, asset, now)) continue;
      const amount = donateCryptoAmount(state.settings, asset, row.amountRub, now);
      if (!amount) continue;
      buttons.push([{ text: asset + ' - ' + amount, callback_data: 'dn:p:' + row.id + ':' + asset }]);
    }
  }
  if (!buttons.length) return { text: str('don.methods_off', lang), inline: undefined, copy: { id: 'donate.methods_off', vars: {} } };
  return { text: lines.join('\n'), inline: { inline_keyboard: buttons }, copy: { id: 'donate.methods', vars: { amount: row.amountRub + ' ₽', fee: lines.slice(1).join('\n') } } };
}

function lockMethod(state, account, row, method, now, lang) {
  const cfg = cfgOf(state);
  const price = paymentPricing(state.settings, now);
  const named = { ...row, displayName: nameOf(account) || row.displayName };
  if (method === 'PC' || method === 'AC') {
    if (!cfg.yoomoney || !state.settings.yoomoneyWallet) return { error: str('don.err_yoomoney_off', lang) };
    const up = grossUp(named.amountRub, method);
    if (!up) return { error: str('don.err_amount', lang) };
    const title = method === 'PC' ? str('don.wallet', lang) : str('don.card', lang);
    const url = payUrl(state.settings.yoomoneyWallet, { sum: up.gross, label: 'don:' + named.id, paymentType: method });
    return {
      row: { ...named, method, asset: '', payAmount: up.gross, gross: up.gross, fee: up.fee, status: 'pending', step: '' },
      text: str('don.pay', lang, { method: title, amount: rubText(up.gross) }),
      inline: { inline_keyboard: [[{ text: str(method === 'PC' ? 'btn.wallet' : 'btn.card', lang, { amount: rubText(up.gross) }), url }]] },
      copy: { id: 'donate.pay', vars: { method: title, amount: rubText(up.gross) } },
    };
  }
  if (method === 'XTR') {
    const stars = starsForRub(named.amountRub, price.rubPerStar);
    if (!cfg.stars || stars < 1) return { error: str('don.err_stars_off', lang) };
    return {
      row: { ...named, method: 'stars', asset: 'XTR', payAmount: String(stars), gross: '', fee: '', status: 'pending', step: '' },
      text: str('don.stars', lang, { stars }),
      copy: { id: 'donate.stars', vars: { stars: String(stars), amount: named.amountRub + ' ₽' } },
      invoice: starInvoiceBody(named.telegramId, {
        title: str('don.invoice_title', lang),
        description: str('don.invoice_desc', lang, { amount: named.amountRub }),
        payload: 'don:' + named.id,
        stars,
      }),
    };
  }
  if (CRYPTO_ASSETS.indexOf(method) >= 0) {
    const amount = donateCryptoAmount(state.settings, method, named.amountRub, now);
    if (!cfg.crypto || !amount || !cryptoAllowed(state.settings, account, method, now)) return { error: str('don.err_crypto_off', lang) };
    return {
      row: { ...named, method: 'crypto', asset: method, payAmount: amount, gross: '', fee: '', status: 'pending', step: '' },
      text: str('don.crypto', lang, { asset: method, amount }),
      copy: { id: 'donate.crypto', vars: { asset: method, pay_amount: amount } },
      cryptoIssue: { donationId: named.id },
    };
  }
  return { error: str('don.err_stale', lang) };
}

export function donateMenu(state, account, now, lang) {
  const cfg = cfgOf(state);
  if (!cfg.enabled) return { state, text: str('don.off', lang), copy: { id: 'donate.off', vars: {} } };
  return {
    state,
    text: str('don.menu', lang),
    inline: amountKeyboard(cfg, lang),
    copy: { id: 'donate.menu', vars: { name: nameOf(account) } },
    now,
  };
}

export function donateOnText(state, account, text, now, lang) {
  if (!account) return null;
  const draft = openDraft(state, account.id, now || Date.now());
  if (!draft || (draft.step !== 'amount' && draft.step !== 'comment')) return null;
  const cfg = cfgOf(state);
  if (draft.step === 'amount') {
    const check = validateDonateAmount(cfg, text, lang);
    if (!check.ok) return { state, text: check.error, copy: { id: 'donate.amount_bad', vars: { min_rub: String(cfg.minRub), max_rub: String(cfg.maxRub), text: check.error } } };
    const row = { ...draft, amountRub: check.rub, step: 'comment', displayName: nameOf(account) || draft.displayName };
    const screen = commentScreen(cfg, row.id, lang);
    return { state: putDonation(state, row), text: screen.text, inline: screen.inline, copy: screen.copy };
  }
  const check = validateDonateComment(cfg, text, lang);
  if (!check.ok) return { state, text: check.error, copy: { id: 'donate.comment_bad', vars: { comment_max: String(cfg.commentMax), text: check.error } } };
  const row = { ...draft, comment: check.comment, step: 'name' };
  const screen = nameScreen(row.id, account, lang);
  return { state: putDonation(state, row), text: screen.text, inline: screen.inline, copy: screen.copy };
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
function resendCheckout(state, row, lang) {
  if (row.method === 'PC' || row.method === 'AC') {
    if (!state.settings.yoomoneyWallet || !row.gross) return { error: str('don.err_no_invoice', lang) };
    const title = row.method === 'PC' ? str('don.wallet', lang) : str('don.card', lang);
    const url = payUrl(state.settings.yoomoneyWallet, { sum: row.gross, label: 'don:' + row.id, paymentType: row.method });
    return {
      text: str('don.pay', lang, { method: title, amount: rubText(row.gross) }),
      inline: { inline_keyboard: [[{ text: str(row.method === 'PC' ? 'btn.wallet' : 'btn.card', lang, { amount: rubText(row.gross) }), url }]] },
      copy: { id: 'donate.pay', vars: { method: title, amount: rubText(row.gross) } },
    };
  }
  if (row.method === 'stars') {
    const stars = Number(row.payAmount);
    if (!Number.isInteger(stars) || stars < 1) return { error: str('don.err_no_invoice', lang) };
    return {
      text: str('don.stars', lang, { stars }),
      copy: { id: 'donate.stars', vars: { stars: String(stars), amount: row.amountRub + ' ₽' } },
      invoice: starInvoiceBody(row.telegramId, {
        title: str('don.invoice_title', lang),
        description: str('don.invoice_desc', lang, { amount: row.amountRub }),
        payload: 'don:' + row.id,
        stars,
      }),
    };
  }
  if (row.method === 'crypto' && row.asset && row.payAmount) {
    return {
      text: str('don.crypto', lang, { asset: row.asset, amount: row.payAmount }),
      copy: { id: 'donate.crypto', vars: { asset: row.asset, pay_amount: row.payAmount } },
      cryptoIssue: { donationId: row.id },
    };
  }
  return { error: str('don.err_no_invoice', lang) };
}

export function donateOnCallback(state, account, data, now, lang) {
  const raw = String(data || '');
  if (raw.indexOf('dn:') !== 0) return null;
  if (!account) return { state, answer: str('don.err_stale', lang) };
  const at = now || Date.now();
  const cfg = cfgOf(state);
  if (!cfg.enabled) return { state, text: str('don.off', lang), answer: str('toast.donate_off', lang), copy: { id: 'donate.off', vars: {} } };
  if (raw.indexOf('dn:a:') === 0) {
    const check = validateDonateAmount(cfg, raw.slice(5), lang);
    if (!check.ok) return { state, text: check.error, answer: str('toast.amount_bad', lang), copy: { id: 'donate.amount_bad', vars: { min_rub: String(cfg.minRub), max_rub: String(cfg.maxRub), text: check.error } } };
    const row = freshDraft(account, at);
    row.amountRub = check.rub;
    row.step = 'comment';
    const screen = commentScreen(cfg, row.id, lang);
    return { state: addDraft(state, row), text: screen.text, inline: screen.inline, answer: '', copy: screen.copy };
  }
  if (raw === 'dn:c') {
    const row = freshDraft(account, at);
    return {
      state: addDraft(state, row),
      text: str('don.amount', lang, { min: cfg.minRub, max: cfg.maxRub }),
      copy: { id: 'donate.amount', vars: { min_rub: String(cfg.minRub), max_rub: String(cfg.maxRub) } },
      answer: '',
    };
  }
  const bits = raw.split(':');
  const id = bits[2] || '';
  const row = draftById(state, account, id, at);
  if (bits[1] === 'p') {
    const pending = pendingById(state, account, id);
    if (pending) {
      if (pending.method === 'crypto' && !cryptoDonateOpen(state.settings, account)) {
        return { state, answer: str('toast.crypto_off', lang) };
      }
      const again = resendCheckout(state, pending, lang);
      if (again.error) return { state, answer: again.error };
      return { state, text: again.text, inline: again.inline, invoice: again.invoice, cryptoIssue: again.cryptoIssue, copy: again.copy, answer: '' };
    }
    const heldRow = (state.donations || []).find((d) => d && d.id === id && d.accountId === account.id && d.status === 'pending' && d.held === true);
    if (heldRow) return { state, answer: str('toast.held', lang) };
    if (!row || row.step !== 'method') return { state, answer: str('don.err_stale', lang) };
    const locked = lockMethod(state, account, row, bits[3] || '', at, lang);
    if (locked.error) return { state, text: locked.error, answer: locked.error, copy: { id: 'donate.error', vars: { text: locked.error } } };
    return {
      state: putDonation(state, locked.row),
      text: locked.text,
      inline: locked.inline,
      invoice: locked.invoice,
      cryptoIssue: locked.cryptoIssue,
      copy: locked.copy,
      answer: '',
    };
  }
  if (!row) return { state, answer: str('don.err_stale', lang) };
  if (bits[1] === 's') {
    if (row.step !== 'comment') return { state, answer: str('don.err_stale', lang) };
    const next = { ...row, comment: '', step: 'name' };
    const screen = nameScreen(next.id, account, lang);
    return { state: putDonation(state, next), text: screen.text, inline: screen.inline, answer: '', copy: screen.copy };
  }
  if (bits[1] === 'n') {
    if (row.step !== 'name') return { state, answer: str('don.err_stale', lang) };
    const next = { ...row, showName: bits[3] === '1', step: 'method', displayName: nameOf(account) || row.displayName };
    const screen = methodScreen(state, account, next, at, lang);
    return { state: putDonation(state, next), text: screen.text, inline: screen.inline, answer: '', copy: screen.copy };
  }
  return { state, answer: str('don.err_stale', lang) };
}

function methodLabel(row, lang) {
  if (!row) return '';
  if (row.method === 'PC') return str('don.method_wallet', lang);
  if (row.method === 'AC') return str('don.method_card', lang);
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
    const known = [];
    const prior = Array.isArray(row.invoiceIds) ? row.invoiceIds : [];
    for (let i = 0; i < prior.length; i++) if (prior[i]) known.push('crypto:' + prior[i]);
    if (row.invoiceId) known.push('crypto:' + row.invoiceId);
    if (known.length && known.indexOf(String(notice.operationId || '')) < 0) return false;
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

export function donateStarCheckout(state, query, lang) {
  const q = query || {};
  const cfg = cfgOf(state);
  if (!cfg.enabled || !cfg.stars) return { ok: false, error: str('pm.err_donate_stars_off', lang) };
  const payload = String(q.invoice_payload || '');
  if (payload.indexOf('don:') !== 0) return { ok: false, error: str('pm.err_no_invoice', lang) };
  const row = (state.donations || []).find((d) => d && d.id === payload.slice(4));
  if (!row || row.method !== 'stars' || row.status !== 'pending') return { ok: false, error: str('pm.err_no_invoice', lang) };
  const fromId = q.from && q.from.id != null ? String(q.from.id) : '';
  if (!row.telegramId || row.telegramId !== fromId) return { ok: false, error: str('pm.err_other_account', lang) };
  if (String(q.currency || '') !== 'XTR') return { ok: false, error: str('pm.err_currency', lang) };
  if (!altCovers(q.total_amount, 'XTR', { method: 'stars', asset: 'XTR', payAmount: row.payAmount })) {
    return { ok: false, error: str('pm.err_amount', lang) };
  }
  return { ok: true };
}

export function donateThanksText(settings) {
  return normalizeDonateSettings(settings && settings.donate).thanksText;
}

export function donateNoticeText(settings, row, lang) {
  if (!row || row.status !== 'paid') return '';
  const cfg = normalizeDonateSettings(settings && settings.donate);
  const amount = Number(row.amountRub) || 0;
  if (!(cfg.notifyAll || (cfg.notifyMin > 0 && amount >= cfg.notifyMin))) return '';
  const who = row.displayName || row.telegramId || str('don.no_name', lang);
  let text = str('don.notice', lang, { amount, method: methodLabel(row, lang), who });
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

/**
 * A saved Crypto Pay link is usable only until the 24 hour invoice expiry.
 * A link with no expiry is not reused.
 * When testnet is passed, a link from the other mode is not reused.
 * A link saved before modes counts as the live mode.
 */
export function donateCryptoLinkLive(row, now, testnet) {
  if (!row || !(row.payUrl || row.webUrl)) return false;
  const exp = Number(row.invoiceExpiresAt) || 0;
  if (!(exp > (now || Date.now()))) return false;
  if (typeof testnet !== 'boolean') return true;
  if (row.cryptoTestnet == null) return testnet === false;
  return row.cryptoTestnet === testnet;
}

export function rememberDonateInvoice(state, id, invoice, now, testnet) {
  const row = (state.donations || []).find((d) => d && d.id === id);
  if (!row || !invoice) return state;
  const at = now || Date.now();
  const mode = typeof testnet === 'boolean' ? testnet : undefined;
  if (donateCryptoLinkLive(row, at, mode)) return state;
  const invoiceIds = [];
  const prior = Array.isArray(row.invoiceIds) ? row.invoiceIds : [];
  for (let i = 0; i < prior.length; i++) if (prior[i] && invoiceIds.indexOf(String(prior[i])) < 0) invoiceIds.push(String(prior[i]));
  if (row.invoiceId && invoiceIds.indexOf(String(row.invoiceId)) < 0) invoiceIds.push(String(row.invoiceId));
  const nextId = String(invoice.invoiceId || '');
  if (nextId && invoiceIds.indexOf(nextId) < 0) invoiceIds.push(nextId);
  const saved = {
    ...row,
    invoiceId: nextId,
    invoiceIds,
    payUrl: invoice.botUrl || '',
    webUrl: invoice.webUrl || '',
    invoiceExpiresAt: at + CRYPTO_INVOICE_MS,
  };
  if (typeof testnet === 'boolean') saved.cryptoTestnet = testnet;
  return putDonation(state, saved);
}
