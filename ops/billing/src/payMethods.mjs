import { amountCovers, CRYPTO_ASSETS, formatAsset } from './cryptoPay.mjs';

/**
 * Telegram Stars and Crypto Pay prices. Both stay off until an admin turns the switch on.
 * Stars are a whole number per tariff. No fee is added on top.
 * Crypto uses the asset price from the admin screen, or the ruble tariff divided by the admin rate.
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
export function starList(settings, kind, extras) {
  const s = settings || {};
  const base = wholeStars(s.starsPrice);
  const extra = wholeStars(s.starsExtra);
  const n = Math.max(0, Math.floor(Number(extras) || 0));
  if (kind === 'dev') return extra > 0 ? extra * Math.max(1, n || 1) : 0;
  if (!(base > 0)) return 0;
  if (n > 0 && !(extra > 0)) return 0;
  return base + extra * n;
}

/**
 * Stars the payer is charged. A ruble credit scales the star price down (floor, so nothing is added).
 * With no ruble price the full star tariff is used. 0 means this order cannot be paid in stars.
 */
export function starDue(settings, kind, extras, rubGross, rubPay) {
  const full = starList(settings, kind, extras);
  if (!(full >= 1)) return 0;
  const gross = Number(rubGross) || 0;
  const pay = Number(rubPay) || 0;
  if (!(gross > 0) || pay >= gross - 1e-9) return full;
  if (!(pay > 0)) return 0;
  const scaled = Math.floor((full * pay) / gross);
  return scaled >= 1 ? scaled : 0;
}

export function starsOffered(settings, kind) {
  if (!settings || settings.starsEnabled !== true) return false;
  if (kind === 'dev') return wholeStars(settings.starsExtra) >= 1;
  return wholeStars(settings.starsPrice) >= 1;
}

/**
 * Crypto amount string for one order, or ''.
 * An explicit asset price wins. Otherwise rubPay / rate, rounded to the asset scale (half up).
 */
export function cryptoDue(settings, asset, kind, extras, rubPay) {
  const key = assetKey(asset);
  if (!key) return '';
  const s = settings || {};
  const base = Number(s['crypto' + key]) || 0;
  const extra = Number(s['cryptoExtra' + key]) || 0;
  const n = Math.max(0, Math.floor(Number(extras) || 0));
  let explicit = 0;
  if (kind === 'dev') {
    if (extra > 0) explicit = extra * Math.max(1, n || 1);
  } else if (base > 0 && (n <= 0 || extra > 0)) {
    explicit = base + extra * n;
  }
  if (explicit > 0) return formatAsset(asset, explicit);
  const rate = Number(s['cryptoRate' + key]) || 0;
  const rub = Number(rubPay) || 0;
  if (!(rate > 0) || !(rub > 0)) return '';
  return formatAsset(asset, rub / rate);
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

/** A stored Crypto Pay invoice id must be the one that was paid. An order with no id yet still matches. */
export function cryptoInvoiceMatches(quote, operationId) {
  if (!quote || quote.method !== 'crypto' || !quote.invoiceId) return true;
  return String(operationId || '') === 'crypto:' + String(quote.invoiceId);
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
export function starCheckoutDecision(state, query) {
  const q = query || {};
  if (!starsOffered(state && state.settings, 'new') && !starsOffered(state && state.settings, 'dev')) {
    return { ok: false, error: 'Оплата звёздами выключена' };
  }
  const payload = String(q.invoice_payload || '');
  if (payload.indexOf('buy:') !== 0) return { ok: false, error: 'Счёт не найден' };
  const quote = ((state && state.purchases) || []).find((p) => p && p.id === payload.slice(4));
  if (!quote || quote.method !== 'stars') return { ok: false, error: 'Счёт не найден' };
  if (!starsOffered(state.settings, quote.kind === 'dev' ? 'dev' : 'new')) {
    return { ok: false, error: 'Оплата звёздами выключена' };
  }
  const owner = ((state && state.accounts) || []).find((a) => a && a.id === quote.accountId);
  const fromId = q.from && q.from.id != null ? String(q.from.id) : '';
  if (!owner || !owner.telegramId || String(owner.telegramId) !== fromId) {
    return { ok: false, error: 'Счёт выставлен другому аккаунту' };
  }
  if (labelSettled(state, payload)) return { ok: false, error: 'Этот счёт уже оплачен' };
  if (String(q.currency || '') !== 'XTR') return { ok: false, error: 'Неверная валюта' };
  if (!altCovers(q.total_amount, 'XTR', quote)) return { ok: false, error: 'Сумма не сходится' };
  return { ok: true };
}

export function starBlurb(quote, days) {
  if (quote && quote.kind === 'dev') return 'Доп. устройство OMP';
  const n = Math.max(1, Math.floor(Number(days) || 30));
  return 'Подписка OMP, ' + n + ' дн.';
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
