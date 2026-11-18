/**
 * Automatic RUB rates for donations.
 *
 * Crypto (USDT, TON, BTC in RUB): Crypto Pay getExchangeRates on the active host
 * (live pay.crypt.bot or testnet-pay.crypt.bot, same token as invoices). A missing
 * or invalid RUB pair falls back to CoinGecko simple price. A zero or out-of-range
 * number is ignored.
 *
 * Stars: Telegram publishes no Stars-to-RUB rate. One star is starUsd (default
 * 0.013, the reward in the Telegram Bot Developer Terms, section 6.2.4, paid out
 * via Fragment) times the live USD/RUB rate. The buyer pays more, about 0.02 USD,
 * because of store fees. 0.013 is the default so a ruble donation matches what the
 * project receives, the same idea as the YooMoney gross-up. An admin can set
 * starUsd closer to 0.02 to match the purchase price.
 *
 * USD/RUB comes from the CBR daily JSON (https://www.cbr-xml-daily.ru/daily_json.js).
 * That file is the ruble reference, needs no key, and still serves the last
 * business day on a weekend. A successful read refreshes the cache time. If the
 * CBR file fails, USD/RUB falls back to the USDT/RUB rate (Crypto Pay, then
 * CoinGecko), treating 1 USDT as 1 USD.
 *
 * The book is stored on settings.rates (Postgres settings table). A refresh runs
 * about every 12 minutes and again when a donate invoice is built from a stale
 * cache. A failed refresh keeps the last good number. A number older than
 * maxAgeMin (default 24 hours) is not used, and that method stays hidden.
 * Markup percent lowers the ruble rate so the donor sends (1 + p/100) more of the asset.
 */
import { cryptoPayCredentials } from './cryptoPay.mjs';
import { cryptoDue, starList } from './payMethods.mjs';
import { grossUp } from './yoomoney.mjs';

export const STAR_USD_DEFAULT = 0.013;
export const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=tether,the-open-network,bitcoin&vs_currencies=rub';
export const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

const PAY_HOSTS = new Set(['https://pay.crypt.bot', 'https://testnet-pay.crypt.bot']);
/** After the coins are priced, wait this long for Crypto Pay and the CBR file, then use what arrived. */
const CBR_GRACE_MS = 800;
const BOUNDS = {
  usdt: [10, 10000],
  ton: [0.1, 1e6],
  btc: [1e5, 1e12],
  usd: [10, 10000],
};
const ASSET_KEYS = ['usdt', 'ton', 'btc'];
const CACHE_KEYS = ['usdt', 'ton', 'btc', 'usd'];
const SOURCES = { cryptopay: true, coingecko: true, cbr: true };

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function onFlag(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

/** A positive in-range ruble rate, or 0 when the number is missing, zero or absurd. */
export function acceptRub(key, value) {
  const bounds = BOUNDS[key];
  if (!bounds) return 0;
  const n = typeof value === 'number' ? value : Number(String(value == null ? '' : value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < bounds[0] || n > bounds[1]) return 0;
  return n;
}

function normalizeCache(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (let i = 0; i < CACHE_KEYS.length; i++) {
    const key = CACHE_KEYS[i];
    const row = src[key];
    if (!row || typeof row !== 'object') continue;
    const rub = acceptRub(key, row.rub);
    const at = Number(row.at);
    const source = SOURCES[row.source] ? row.source : '';
    if (!(rub > 0) || !(at > 0) || !source) continue;
    out[key] = { rub, source, at };
  }
  return out;
}

export function normalizeRateSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const auto = src.auto && typeof src.auto === 'object' ? src.auto : {};
  const fetchedAt = Number(src.fetchedAt);
  let starUsd = STAR_USD_DEFAULT;
  if (src.starUsd !== undefined && src.starUsd !== '') {
    const n = Number(String(src.starUsd).trim().replace(',', '.'));
    if (Number.isFinite(n) && n >= 0.001 && n <= 1) starUsd = Math.round(n * 10000) / 10000;
  }
  return {
    refreshMin: clampInt(src.refreshMin, 12, 5, 60),
    maxAgeMin: clampInt(src.maxAgeMin, 1440, 30, 10080),
    markupPercent: clampInt(src.markupPercent, 0, 0, 100),
    starUsd,
    auto: {
      usdt: onFlag(auto.usdt, true),
      ton: onFlag(auto.ton, true),
      btc: onFlag(auto.btc, true),
      star: onFlag(auto.star, true),
    },
    cache: normalizeCache(src.cache),
    pins: normalizePins(src.pins),
    fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : 0,
  };
}

/** RUB pairs from getExchangeRates. rate is how many RUB one unit of source costs. */
export function parseCryptoPayRates(data) {
  const rows = data && data.ok === true && Array.isArray(data.result) ? data.result : [];
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.is_valid === false) continue;
    const source = String(row.source || '').toUpperCase();
    const target = String(row.target || '').toUpperCase();
    const key = source === 'USDT' ? 'usdt' : source === 'TON' ? 'ton' : source === 'BTC' ? 'btc' : '';
    if (!key || target !== 'RUB' || out[key]) continue;
    const rub = acceptRub(key, row.rate);
    if (rub) out[key] = rub;
  }
  return out;
}

export function parseCoinGeckoRub(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  const map = { tether: 'usdt', 'the-open-network': 'ton', bitcoin: 'btc' };
  const ids = Object.keys(map);
  for (let i = 0; i < ids.length; i++) {
    const row = data[ids[i]];
    const rub = acceptRub(map[ids[i]], row && row.rub);
    if (rub) out[map[ids[i]]] = rub;
  }
  return out;
}

/** CBR Valute.USD.Value per Nominal. 0 when the dollar is missing. */
export function parseCbrUsdRub(data) {
  const usd = data && data.Valute && data.Valute.USD;
  if (!usd) return 0;
  const nominal = Number(usd.Nominal);
  const value = Number(String(usd.Value == null ? '' : usd.Value).trim().replace(',', '.'));
  if (!(nominal > 0) || !(value > 0)) return 0;
  return acceptRub('usd', value / nominal);
}

/** Crypto Pay wins per asset. The dollar is the CBR rate, else the USDT ruble rate. */
export function combineRateQuotes(pay, gecko, cbr) {
  const crypto = pay || {};
  const fall = gecko || {};
  const out = {};
  for (let i = 0; i < ASSET_KEYS.length; i++) {
    const key = ASSET_KEYS[i];
    if (crypto[key]) out[key] = { rub: crypto[key], source: 'cryptopay' };
    else if (fall[key]) out[key] = { rub: fall[key], source: 'coingecko' };
  }
  const dollar = Number(cbr) || 0;
  if (dollar > 0) out.usd = { rub: dollar, source: 'cbr' };
  else if (out.usdt) out.usd = { rub: out.usdt.rub, source: out.usdt.source };
  return out;
}

/** Replace only quotes that are in range. A miss or a zero leaves the previous entry. */
export function mergeRateBook(prev, quotes, now) {
  const book = normalizeRateSettings(prev);
  const cache = { ...book.cache };
  const src = quotes && typeof quotes === 'object' ? quotes : {};
  for (let i = 0; i < CACHE_KEYS.length; i++) {
    const key = CACHE_KEYS[i];
    const quote = src[key];
    if (!quote) continue;
    const rub = acceptRub(key, quote.rub);
    const source = SOURCES[quote.source] ? quote.source : '';
    if (!(rub > 0) || !source) continue;
    cache[key] = { rub, source, at: now };
  }
  return normalizeRateSettings({ ...book, cache, fetchedAt: now });
}

export function applyMarkup(rub, percent) {
  const n = Number(rub);
  const p = Number(percent) || 0;
  if (!(n > 0)) return 0;
  if (!(p > 0)) return n;
  const next = n / (1 + p / 100);
  return next > 0 && Number.isFinite(next) ? next : 0;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 1e12 ? n : 0;
}

function fresh(entry, now, maxAgeMin) {
  if (!entry || !(entry.rub > 0) || !(entry.at > 0)) return false;
  const age = now - entry.at;
  if (!(age >= 0)) return false;
  return age <= maxAgeMin * 60 * 1000;
}

const PIN_KEYS = ['star', 'usdt', 'ton', 'btc'];

function pinRub(key, value) {
  if (key === 'star') {
    const n = Number(String(value == null ? '' : value).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0.01 || n > 100) return 0;
    return Math.round(n * 10000) / 10000;
  }
  return acceptRub(key, value);
}

function normalizePins(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (let i = 0; i < PIN_KEYS.length; i++) {
    const key = PIN_KEYS[i];
    const row = src[key];
    if (!row || typeof row !== 'object') continue;
    const rub = pinRub(key, row.rub);
    const until = Number(row.until);
    const at = Number(row.at);
    if (!(rub > 0) || !Number.isFinite(until) || until <= 0) continue;
    out[key] = {
      rub,
      until,
      at: Number.isFinite(at) && at > 0 ? at : until,
      reason: String(row.reason || '').trim().slice(0, 200),
    };
  }
  return out;
}

function livePin(book, key, now) {
  const pin = book.pins && book.pins[key];
  if (!pin || !(pin.rub > 0) || !(pin.until > now)) return 0;
  return pin.rub;
}

function starRaw(book, now) {
  const usd = book.cache.usd;
  if (!fresh(usd, now, book.maxAgeMin)) return 0;
  const rub = book.starUsd * usd.rub;
  if (!(rub > 0) || rub > 1000) return 0;
  return rub;
}

function effective(book, key, now) {
  const pinned = livePin(book, key, now);
  if (pinned > 0) return pinned;
  const raw = key === 'star' ? starRaw(book, now) : fresh(book.cache[key], now, book.maxAgeMin) ? book.cache[key].rub : 0;
  if (!(raw > 0)) return 0;
  return applyMarkup(raw, book.markupPercent);
}

/** Ruble per unit. 0 hides that method. A live pin wins. A stale book hides the method. */
export function paymentPricing(settings, now) {
  const s = settings || {};
  const book = normalizeRateSettings(s.rates);
  const at = Number(now) > 0 ? Number(now) : Date.now();
  return {
    rubPerStar: effective(book, 'star', at),
    cryptoRateUsdt: effective(book, 'usdt', at),
    cryptoRateTon: effective(book, 'ton', at),
    cryptoRateBtc: effective(book, 'btc', at),
  };
}

export function rateAdminView(settings, now) {
  const s = settings || {};
  const book = normalizeRateSettings(s.rates);
  const at = Number(now) > 0 ? Number(now) : Date.now();
  const price = paymentPricing(s, at);
  const manual = {
    star: positive(s.donate && s.donate.rubPerStar),
    usdt: positive(s.cryptoRateUsdt),
    ton: positive(s.cryptoRateTon),
    btc: positive(s.cryptoRateBtc),
  };
  const valueOf = {
    star: price.rubPerStar,
    usdt: price.cryptoRateUsdt,
    ton: price.cryptoRateTon,
    btc: price.cryptoRateBtc,
  };
  const row = (key) => {
    const entry = key === 'star' ? book.cache.usd : book.cache[key];
    const pin = book.pins[key];
    const pinned = livePin(book, key, at);
    let last = 0;
    if (entry && entry.rub > 0) {
      const raw = key === 'star' ? book.starUsd * entry.rub : entry.rub;
      if (raw > 0 && (key !== 'star' || raw <= 1000)) last = applyMarkup(raw, book.markupPercent);
    }
    return {
      auto: true,
      manual: manual[key],
      value: valueOf[key],
      source: pinned > 0 ? 'pin' : (entry && entry.source) || '',
      at: pinned > 0 && pin ? pin.at : entry ? entry.at : 0,
      usable: valueOf[key] > 0,
      last,
      pin: pin ? { rub: pin.rub, until: pin.until, reason: pin.reason, live: pinned > 0 } : null,
    };
  };
  const priceRub = positive(s.priceRub);
  const extraRub = positive(s.extraDeviceRub);
  const wallet = grossUp(priceRub, 'PC');
  const card = grossUp(priceRub, 'AC');
  return {
    refreshMin: book.refreshMin,
    maxAgeMin: book.maxAgeMin,
    markupPercent: book.markupPercent,
    starUsd: book.starUsd,
    rows: { star: row('star'), usdt: row('usdt'), ton: row('ton'), btc: row('btc') },
    yoo: { wallet: wallet ? wallet.gross : '', card: card ? card.gross : '' },
    sub: {
      stars: starList(s, 'sub', 0, priceRub, at),
      starsExtra: starList(s, 'dev', 0, extraRub, at),
      usdt: cryptoDue(s, 'USDT', 'sub', 0, priceRub, null, at),
      ton: cryptoDue(s, 'TON', 'sub', 0, priceRub, null, at),
      btc: cryptoDue(s, 'BTC', 'sub', 0, priceRub, null, at),
    },
  };
}

/** Admin form. A bad number keeps the current one. The cache is not cleared. */
export function applyRateSettings(prev, body, now) {
  const cur = normalizeRateSettings(prev);
  const b = body || {};
  const nowMs = Number(now) > 0 ? Number(now) : Date.now();
  const next = {
    refreshMin: cur.refreshMin,
    maxAgeMin: cur.maxAgeMin,
    markupPercent: cur.markupPercent,
    starUsd: cur.starUsd,
    auto: { ...cur.auto },
    cache: cur.cache,
    pins: { ...cur.pins },
    fetchedAt: cur.fetchedAt,
  };
  if (b.rateAutoStar !== undefined) next.auto.star = onFlag(b.rateAutoStar, cur.auto.star);
  if (b.rateAutoUsdt !== undefined) next.auto.usdt = onFlag(b.rateAutoUsdt, cur.auto.usdt);
  if (b.rateAutoTon !== undefined) next.auto.ton = onFlag(b.rateAutoTon, cur.auto.ton);
  if (b.rateAutoBtc !== undefined) next.auto.btc = onFlag(b.rateAutoBtc, cur.auto.btc);
  if (b.starUsd !== undefined && String(b.starUsd).trim() !== '') {
    const n = Number(String(b.starUsd).trim().replace(',', '.'));
    if (Number.isFinite(n) && n >= 0.001 && n <= 1) next.starUsd = Math.round(n * 10000) / 10000;
  }
  if (b.markupPercent !== undefined && String(b.markupPercent).trim() !== '') {
    const n = Number(String(b.markupPercent).trim());
    if (Number.isInteger(n) && n >= 0 && n <= 100) next.markupPercent = n;
  }
  if (b.maxAgeHours !== undefined && String(b.maxAgeHours).trim() !== '') {
    const n = Number(String(b.maxAgeHours).trim());
    if (Number.isInteger(n) && n >= 1 && n <= 168) next.maxAgeMin = n * 60;
  }
  if (b.refreshMin !== undefined && String(b.refreshMin).trim() !== '') {
    const n = Number(String(b.refreshMin).trim());
    if (Number.isInteger(n) && n >= 5 && n <= 60) next.refreshMin = n;
  }
  let hours = 0;
  if (b.pinHours !== undefined && String(b.pinHours).trim() !== '') {
    const n = Number(String(b.pinHours).trim());
    if (Number.isInteger(n) && n >= 1 && n <= 168) hours = n;
  }
  const reason = String(b.pinReason || '').trim().slice(0, 200);
  const creating = ['pinStar', 'pinUsdt', 'pinTon', 'pinBtc'].some((field) => {
    if (b[field] === undefined) return false;
    const text = String(b[field]).trim();
    return text !== '' && text !== '0';
  });
  const pinOk = !creating || (reason !== '' && hours >= 1);
  const setPin = (key, field) => {
    if (!pinOk || b[field] === undefined) return;
    const text = String(b[field]).trim();
    if (text === '') return;
    if (text === '0') {
      delete next.pins[key];
      return;
    }
    const rub = pinRub(key, text);
    if (!rub) return;
    next.pins[key] = { rub, until: nowMs + hours * 60 * 60 * 1000, at: nowMs, reason };
  };
  setPin('star', 'pinStar');
  setPin('usdt', 'pinUsdt');
  setPin('ton', 'pinTon');
  setPin('btc', 'pinBtc');
  return normalizeRateSettings(next);
}

/** What changed in the rate book, for the audit row. Empty when nothing rate-related moved. */
export function rateAuditText(prev, next) {
  const a = normalizeRateSettings(prev);
  const b = normalizeRateSettings(next);
  const bits = [];
  if (a.refreshMin !== b.refreshMin) bits.push('интервал ' + a.refreshMin + ' -> ' + b.refreshMin + ' мин');
  if (a.markupPercent !== b.markupPercent) bits.push('наценка ' + a.markupPercent + ' -> ' + b.markupPercent);
  if (a.starUsd !== b.starUsd) bits.push('USD за звезду ' + a.starUsd + ' -> ' + b.starUsd);
  if (a.maxAgeMin !== b.maxAgeMin) bits.push('срок ' + a.maxAgeMin + ' -> ' + b.maxAgeMin + ' мин');
  for (let i = 0; i < PIN_KEYS.length; i++) {
    const key = PIN_KEYS[i];
    const left = a.pins[key];
    const right = b.pins[key];
    const same = !!left === !!right && (!left || (left.rub === right.rub && left.until === right.until));
    if (same) continue;
    const was = left ? String(left.rub) : 'нет';
    const now = right ? String(right.rub) : 'нет';
    bits.push('закреп ' + key + ' ' + was + ' -> ' + now + (right && right.reason ? ' (' + right.reason + ')' : ''));
  }
  return bits.join('; ');
}

const PRICE_FIELDS = [
  ['priceRub', 'Подписка, ₽'],
  ['extraDeviceRub', 'Доп. устройство, ₽'],
];

function pinSource(pin) {
  if (!pin) return 'снято';
  const reason = String(pin.reason || '').trim();
  return reason ? 'закрепление: ' + reason : 'закрепление';
}

/** Lines for the audit journal: what changed, the old number, the new number, and where it came from. */
export function priceRateDiff(prevSettings, nextSettings) {
  const prev = prevSettings || {};
  const next = nextSettings || {};
  const lines = [];
  for (let i = 0; i < PRICE_FIELDS.length; i++) {
    const key = PRICE_FIELDS[i][0];
    const was = Number(prev[key]) || 0;
    const now = Number(next[key]) || 0;
    if (was === now) continue;
    lines.push({ field: PRICE_FIELDS[i][1], was: String(was), now: String(now), source: 'настройки' });
  }
  const a = normalizeRateSettings(prev.rates);
  const b = normalizeRateSettings(next.rates);
  const knobs = [
    ['refreshMin', 'Интервал, мин'],
    ['markupPercent', 'Наценка, %'],
    ['starUsd', 'USD за звезду'],
    ['maxAgeMin', 'Срок курса, мин'],
  ];
  for (let i = 0; i < knobs.length; i++) {
    if (a[knobs[i][0]] === b[knobs[i][0]]) continue;
    lines.push({ field: knobs[i][1], was: String(a[knobs[i][0]]), now: String(b[knobs[i][0]]), source: 'настройки' });
  }
  for (let i = 0; i < PIN_KEYS.length; i++) {
    const key = PIN_KEYS[i];
    const left = a.pins[key];
    const right = b.pins[key];
    const same = !!left === !!right && (!left || (left.rub === right.rub && left.until === right.until));
    if (same) continue;
    lines.push({
      field: 'Курс ' + key,
      was: left ? String(left.rub) : 'нет',
      now: right ? String(right.rub) : 'нет',
      source: right ? pinSource(right) : 'снято',
    });
  }
  return lines;
}

/** Why a pin was not saved. Empty when the form is not creating a pin, or the pin is valid. */
export function ratePinError(body) {
  const b = body || {};
  const creating = ['pinStar', 'pinUsdt', 'pinTon', 'pinBtc'].some((field) => {
    if (b[field] === undefined) return false;
    const text = String(b[field]).trim();
    return text !== '' && text !== '0';
  });
  if (!creating) return '';
  if (!String(b.pinReason || '').trim()) return 'Закрепление курса: нужна причина';
  const n = Number(String(b.pinHours == null ? '' : b.pinHours).trim());
  if (!Number.isInteger(n) || n < 1 || n > 168) return 'Закрепление курса: срок от 1 до 168 часов';
  return '';
}

async function getJson(fetchImpl, url, headers, label) {
  const net = fetchImpl || fetch;
  let res;
  try {
    res = await net(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    process.stderr.write('rate ' + label + ' failed\n');
    return null;
  }
  if (!res || !res.ok) {
    process.stderr.write('rate ' + label + ' http ' + Number(res && res.status) + '\n');
    return null;
  }
  const len = res.headers && res.headers.get ? Number(res.headers.get('content-length')) : 0;
  if (len > 1000000) {
    process.stderr.write('rate ' + label + ' too large\n');
    return null;
  }
  try {
    return await res.json();
  } catch (e) {
    process.stderr.write('rate ' + label + ' bad json\n');
    return null;
  }
}

function quotesFromPartial(got) {
  return combineRateQuotes(
    got.pay === undefined ? {} : parseCryptoPayRates(got.pay),
    got.gecko === undefined ? {} : parseCoinGeckoRub(got.gecko),
    got.cbr === undefined ? 0 : parseCbrUsdRub(got.cbr),
  );
}

function assetsPriced(quotes) {
  return !!(quotes && quotes.usdt && quotes.ton && quotes.btc);
}

/** True when USDT, TON, BTC and a dollar rate are already known. */
function quotesComplete(quotes) {
  return assetsPriced(quotes) && !!quotes.usd;
}

function within(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).then((value) => {
    clearTimeout(timer);
    return value;
  });
}

/**
 * One round of Crypto Pay, CoinGecko and the CBR. The token is a header, never part of the url.
 * A finished CoinGecko quote still waits the short CBR window for Crypto Pay, so the
 * primary source wins when it is only slightly slower. A host that misses that window is dropped.
 */
export async function fetchRateQuotes(fetchImpl, creds) {
  const c = creds || {};
  const host = String(c.host || '').replace(/\/+$/, '');
  const payUrl = c.ready && c.token && PAY_HOSTS.has(host) ? host + '/api/getExchangeRates' : '';
  const headers = { accept: 'application/json' };
  const jobs = [
    {
      key: 'pay',
      run: payUrl
        ? getJson(fetchImpl, payUrl, { ...headers, 'Crypto-Pay-API-Token': String(c.token) }, 'cryptopay')
        : Promise.resolve(null),
    },
    { key: 'gecko', run: getJson(fetchImpl, COINGECKO_URL, headers, 'coingecko') },
    { key: 'cbr', run: getJson(fetchImpl, CBR_URL, headers, 'cbr') },
  ];
  const got = {};
  const pending = new Set(jobs);
  while (pending.size) {
    const winner = await Promise.race(
      [...pending].map((job) => job.run.then((data) => ({ job, data }))),
    );
    pending.delete(winner.job);
    got[winner.job.key] = winner.data;
    const ready = quotesFromPartial(got);
    if (quotesComplete(ready) && got.cbr !== undefined && got.pay !== undefined) return ready;
    if (assetsPriced(ready) && (got.cbr === undefined || got.pay === undefined)) {
      const late = [];
      if (got.cbr === undefined) late.push(jobs.find((job) => job.key === 'cbr'));
      if (got.pay === undefined) late.push(jobs.find((job) => job.key === 'pay'));
      const rows = await Promise.all(
        late.map((job) => within(job.run, CBR_GRACE_MS).then((data) => ({ key: job.key, data }))),
      );
      for (let i = 0; i < rows.length; i++) if (rows[i].data !== undefined) got[rows[i].key] = rows[i].data;
      return quotesFromPartial(got);
    }
  }
  return quotesFromPartial(got);
}

function bookCovers(book, now) {
  const covered = (key) => {
    if (livePin(book, key, now)) return true;
    if (key === 'star') return fresh(book.cache.usd, now, book.maxAgeMin);
    return fresh(book.cache[key], now, book.maxAgeMin);
  };
  return covered('usdt') && covered('ton') && covered('btc') && covered('star');
}

/**
 * Whether this donate tap may call the rate hosts.
 * 'skip': amount, comment, a stale button, a repeat of a frozen invoice, manual rates, or a fresh cache.
 * 'background': the cache can still price the quote, but a refresh is due. Answer first.
 * 'block': the quote has no usable rate, so the invoice has to wait for one fetch.
 */
export function donateRateWait(data, state, now) {
  const raw = String(data || '');
  const naming = raw.indexOf('dn:n:') === 0;
  const paying = raw.indexOf('dn:p:') === 0;
  if (!naming && !paying) return 'skip';
  const rows = (state && state.donations) || [];
  const id = raw.split(':')[2] || '';
  const row = rows.find((d) => d && d.id === id);
  // Only a live draft on the step that renders prices may wait; a stale button is answered at once.
  if (!row || row.status !== 'draft' || row.step !== (naming ? 'name' : 'method')) return 'skip';
  const book = normalizeRateSettings(state && state.settings && state.settings.rates);
  if (!anyAuto(book)) return 'skip';
  const at = Number(now) > 0 ? Number(now) : Date.now();
  if (!bookCovers(book, at)) return 'block';
  const refreshMs = book.refreshMin * 60 * 1000;
  if (book.fetchedAt && at >= book.fetchedAt && at - book.fetchedAt < refreshMs) return 'skip';
  return 'background';
}

function anyAuto() {
  return true;
}

let inflight = null;

/**
 * Refresh settings.rates when the last attempt is older than refreshMin.
 * Concurrent callers share one request. A failed round still stamps fetchedAt
 * so a donate tap does not hammer the hosts, and it does not replace a good rate.
 */
export async function ensureRates(store, fetchImpl, now) {
  const nowMs = Number(now) > 0 ? Number(now) : Date.now();
  if (inflight) return inflight;
  const run = (async () => {
    const state = await store.read();
    const settings = (state && state.settings) || {};
    const book = normalizeRateSettings(settings.rates);
    if (!anyAuto(book)) return book;
    const refreshMs = book.refreshMin * 60 * 1000;
    if (book.fetchedAt && nowMs >= book.fetchedAt && nowMs - book.fetchedAt < refreshMs) return book;
    const quotes = await fetchRateQuotes(fetchImpl, cryptoPayCredentials(settings));
    let saved = book;
    await store.update((cur) => {
      saved = mergeRateBook(cur.settings && cur.settings.rates, quotes, nowMs);
      return { state: { ...cur, settings: { ...cur.settings, rates: saved } }, result: saved };
    });
    return saved;
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}
