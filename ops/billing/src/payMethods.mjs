import { amountCovers, CRYPTO_ASSETS, formatAsset } from './cryptoPay.mjs';
import { str } from './botCopy.mjs';
import { paymentPricing } from './rates.mjs';

/**
 * Telegram Stars and Crypto Pay prices. Both stay off until an admin turns the switch on.
 * The ruble tariff is the base. Stars and crypto amounts come only from the rate book
 * (or a live admin pin). A stale book hides the method. Stars are a whole number.
 * No fee is added on top. Crypto rounds to the asset scale.
 */

const STAR_MAX = 1000000;

export function wholeStars(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > STAR_MAX) return 0;
  return n;
}

function assetKey(asset) {
  if (asset === 'USDT') return 'Usdt';
  if (asset === 'TON') return 'Ton';
  if (asset === 'BTC') return 'Btc';
  return '';
}

/** Stars for one order before a ruble credit is scaled off. 0 when that tariff has no star price. */
export function starList(settings, kind, extras, rubGross, now) {
  const rate = paymentPricing(settings || {}, now).rubPerStar;
  const gross = Number(rubGross) || 0;
  if (rate > 0 && gross > 0) {
    const stars = Math.ceil(gross / rate - 1e-9);
    return wholeStars(stars);
  }
  return 0;
}

/**
 * Stars the payer is charged. A ruble credit scales the star price down (floor, so nothing is added).
 * With no ruble price the full star tariff is used. 0 means this order cannot be paid in stars.
 */
export function starDue(settings, kind, extras, rubGross, rubPay, now) {
  const full = starList(settings, kind, extras, rubGross, now);
  if (!(full >= 1)) return 0;
  const gross = Number(rubGross) || 0;
  const pay = Number(rubPay) || 0;
  if (!(gross > 0) || pay >= gross - 1e-9) return full;
  if (!(pay > 0)) return 0;
  const scaled = Math.floor((full * pay) / gross);
  return scaled >= 1 ? scaled : 0;
}

export function starsOffered(settings, kind, now) {
  if (!settings || settings.starsEnabled !== true) return false;
  const tariff = kind === 'dev' ? Number(settings.extraDeviceRub) : Number(settings.priceRub);
  if (paymentPricing(settings, now).rubPerStar > 0 && tariff > 0) return true;
  return false;
}

/**
 * Crypto amount string for one order, or ''.
 * The amount is the ruble figure divided by the live rate (or a live pin).
 */
export function cryptoDue(settings, asset, kind, extras, rubGross, rubPay, now) {
  const key = assetKey(asset);
  if (!key) return '';
  const s = settings || {};
  const autoRate = Number(paymentPricing(s, now)['cryptoRate' + key]) || 0;
  const rubNow = Number(rubPay == null ? rubGross : rubPay) || 0;
  if (autoRate > 0 && rubNow > 0) return formatAsset(asset, rubNow / autoRate);
  return '';
}

/** Country is a Cloudflare CF-IPCountry code. The non-RU switch hides crypto when the code is missing or RU. */
export function cryptoOffered(settings, country) {
  if (!settings || settings.cryptoEnabled !== true) return false;
  if (settings.cryptoNonRu !== true) return true;
  const code = String(country || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'RU';
}

export function countryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return '';
  return code;
}

/**
 * True when this payment bought an extra device slot, not subscription time.
 * The kind saved at acceptance wins: an old buy: quote may already be trimmed.
 */
export function isDevicePay(state, row) {
  if (row && row.kind) return row.kind === 'dev';
  const label = String((row && row.label) || '');
  if (label.indexOf('dev:') === 0) return true;
  if (label.indexOf('buy:') === 0) {
    const quote = (state.purchases || []).find((item) => item && item.id === label.slice(4));
    return !!(quote && quote.kind === 'dev');
  }
  return false;
}

/** True when the account already has an accepted subscription payment. Device slots do not count. */
export function subscriptionPaidBefore(state, accountId, operationId) {
  const rows = state.payments || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.accountId !== accountId || row.pending || row.error) continue;
    if (operationId && row.operationId === operationId) continue;
    if (isDevicePay(state, row)) continue;
    return true;
  }
  return false;
}

/** True when this buy: order already extended a subscription. */
export function labelSettled(state, label) {
  const mark = String(label || '');
  if (mark.indexOf('buy:') !== 0) return false;
  return (state.payments || []).some((p) => p && p.label === mark && !p.error && !p.pending);
}

/**
 * Stars: the paid integer must equal the quoted stars. Currency is XTR.
 * Crypto: paid amount must reach the quoted asset amount. A smaller payment does not cover.
 */
export function altCovers(amount, currency, quote) {
  if (!quote) return false;
  const asset = String(quote.asset || '');
  if (!asset || String(currency || '') !== asset) return false;
  if (quote.method === 'stars') {
    const paid = Number(amount);
    const need = Number(quote.payAmount);
    return Number.isInteger(paid) && Number.isInteger(need) && paid >= 1 && paid === need;
  }
  if (quote.method === 'crypto') {
    if (CRYPTO_ASSETS.indexOf(asset) < 0) return false;
    return amountCovers(amount, quote.payAmount);
  }
  return false;
}

/**
 * A Crypto Pay notice must name an invoice of the mode that is on.
 * When that mode has its own stored link, only that id matches: the last requested
 * link can belong to the other mode. A quote that never recorded a mode still matches
 * its single invoice id. An order with no id yet still matches.
 * `testnet` is settings.cryptoTestnet. Omitted means the live mode.
 */
export function cryptoInvoiceMatches(quote, operationId, testnet) {
  if (!quote || quote.method !== 'crypto') return true;
  const mode = testnet === true;
  const bag = quote.cryptoLinks;
  const saved = bag && bag[mode ? 'testnet' : 'live'];
  const op = String(operationId || '');
  if (saved && saved.invoiceId != null && String(saved.invoiceId) !== '') {
    return op === 'crypto:' + String(saved.invoiceId);
  }
  if (quote.cryptoTestnet != null && quote.cryptoTestnet !== mode) return false;
  if (!quote.invoiceId) return true;
  return op === 'crypto:' + String(quote.invoiceId);
}

/**
 * sendInvoice for Telegram Stars. provider_token is an empty string:
 * XTR has no payment provider and no provider token.
 */
export function starInvoiceBody(chatId, { title, description, payload, stars }) {
  const label = String(title || 'Подписка OMP').slice(0, 32);
  const n = wholeStars(stars);
  return {
    chat_id: String(chatId),
    title: label,
    description: String(description || label).slice(0, 255),
    payload: String(payload || '').slice(0, 128),
    provider_token: '',
    currency: 'XTR',
    prices: [{ label, amount: n }],
  };
}

/**
 * pre_checkout_query. ok false does not extend anything.
 * The payer must own the order, the amount must be the quoted stars, and the switch must still be on.
 */
export function starCheckoutDecision(state, query, lang) {
  const q = query || {};
  if (!state || !state.settings || state.settings.starsEnabled !== true) {
    return { ok: false, error: str('pm.err_stars_off', lang) };
  }
  const payload = String(q.invoice_payload || '');
  if (payload.indexOf('buy:') !== 0) return { ok: false, error: str('pm.err_no_invoice', lang) };
  const quote = ((state && state.purchases) || []).find((p) => p && p.id === payload.slice(4));
  if (!quote || quote.method !== 'stars') return { ok: false, error: str('pm.err_no_invoice', lang) };
  const owner = ((state && state.accounts) || []).find((a) => a && a.id === quote.accountId);
  const fromId = q.from && q.from.id != null ? String(q.from.id) : '';
  if (!owner || !owner.telegramId || String(owner.telegramId) !== fromId) {
    return { ok: false, error: str('pm.err_other_account', lang) };
  }
  if (labelSettled(state, payload)) return { ok: false, error: str('pm.err_already', lang) };
  // The one-time referral discount must still be open before Telegram takes the Stars:
  // a charge that arrives after the first payment is rejected and has to be refunded.
  if (Number(quote.referralOff) > 0) {
    const payer =
      quote.accountId || (((state && state.subscriptions) || []).find((s) => s && s.id === quote.subscriptionId) || {}).accountId;
    if (payer && subscriptionPaidBefore(state, payer, '')) return { ok: false, error: str('pm.err_discount_used', lang) };
  }
  if (String(q.currency || '') !== 'XTR') return { ok: false, error: str('pm.err_currency', lang) };
  if (!altCovers(q.total_amount, 'XTR', quote)) return { ok: false, error: str('pm.err_amount', lang) };
  return { ok: true };
}

export function starBlurb(quote, days, lang) {
  if (quote && quote.kind === 'dev') return str('pm.blurb_dev', lang);
  const n = Math.max(1, Math.floor(Number(days) || 30));
  return str('pm.blurb_sub', lang, { n });
}

/** Rubles this payment adds to the revenue split. Stars and crypto use the ruble figure frozen on the order. */
export function rubOfPayment(p) {
  if (!p) return 0;
  if (p.provider === 'stars' || p.provider === 'crypto') {
    const n = Number(p.rub);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const raw = Number(String(p.amount == null ? '' : p.amount).replace(',', '.'));
  return Number.isFinite(raw) ? raw : 0;
}

export function methodOfPayment(p) {
  if (p && (p.provider === 'stars' || p.provider === 'crypto')) return p.provider;
  return 'yoomoney';
}

export function emptyMethodSplit() {
  return {
    yoomoney: { count: 0, rub: 0, stars: 0, usdt: 0, ton: 0, btc: 0 },
    stars: { count: 0, rub: 0, stars: 0, usdt: 0, ton: 0, btc: 0 },
    crypto: { count: 0, rub: 0, stars: 0, usdt: 0, ton: 0, btc: 0 },
  };
}

export function addMethodSplit(split, p) {
  const kind = methodOfPayment(p);
  const row = split[kind];
  row.count += 1;
  row.rub += rubOfPayment(p);
  if (kind === 'stars') row.stars += Number(p.amount) || 0;
  if (kind === 'crypto') {
    const asset = String(p.asset || '');
    if (asset === 'USDT') row.usdt += Number(p.amount) || 0;
    else if (asset === 'TON') row.ton += Number(p.amount) || 0;
    else if (asset === 'BTC') row.btc += Number(p.amount) || 0;
  }
}
