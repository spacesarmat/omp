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

export const STAR_USD_DEFAULT = 0.013;
export const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=tether,the-open-network,bitcoin&vs_currencies=rub';
export const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

const PAY_HOSTS = new Set(['https://pay.crypt.bot', 'https://testnet-pay.crypt.bot']);
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

function starRaw(book, now) {
  const usd = book.cache.usd;
  if (!fresh(usd, now, book.maxAgeMin)) return 0;
  const rub = book.starUsd * usd.rub;
  if (!(rub > 0) || rub > 1000) return 0;
  return rub;
}

function effective(book, key, manual, now) {
  if (!book.auto[key]) return manual;
  const raw = key === 'star' ? starRaw(book, now) : fresh(book.cache[key], now, book.maxAgeMin) ? book.cache[key].rub : 0;
  if (!(raw > 0)) return 0;
  return applyMarkup(raw, book.markupPercent);
}

/** Ruble rates the donate menu uses. 0 hides that method. Manual wins only while auto is off. */
export function donatePricing(settings, now) {
  const s = settings || {};
  const book = normalizeRateSettings(s.rates);
  const at = Number(now) > 0 ? Number(now) : Date.now();
  return {
    rubPerStar: effective(book, 'star', positive(s.donate && s.donate.rubPerStar), at),
    cryptoRateUsdt: effective(book, 'usdt', positive(s.cryptoRateUsdt), at),
    cryptoRateTon: effective(book, 'ton', positive(s.cryptoRateTon), at),
    cryptoRateBtc: effective(book, 'btc', positive(s.cryptoRateBtc), at),
  };
}

export function rateAdminView(settings, now) {
  const s = settings || {};
  const book = normalizeRateSettings(s.rates);
  const at = Number(now) > 0 ? Number(now) : Date.now();
  const price = donatePricing(s, at);
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
    const auto = book.auto[key];
    let last = 0;
    if (entry && entry.rub > 0) {
      const raw = key === 'star' ? book.starUsd * entry.rub : entry.rub;
      if (raw > 0 && (key !== 'star' || raw <= 1000)) last = applyMarkup(raw, book.markupPercent);
    }
    return {
      auto,
      manual: manual[key],
      value: auto ? valueOf[key] : manual[key],
      source: auto ? (entry && entry.source) || '' : 'manual',
      at: auto && entry ? entry.at : 0,
      usable: auto ? valueOf[key] > 0 : manual[key] > 0,
      last,
    };
  };
  return {
    refreshMin: book.refreshMin,
    maxAgeMin: book.maxAgeMin,
    markupPercent: book.markupPercent,
    starUsd: book.starUsd,
    rows: { star: row('star'), usdt: row('usdt'), ton: row('ton'), btc: row('btc') },
  };
}

/** Admin form. A bad number keeps the current one. The cache is not cleared. */
export function applyRateSettings(prev, body) {
  const cur = normalizeRateSettings(prev);
  const b = body || {};
  const next = {
    refreshMin: cur.refreshMin,
    maxAgeMin: cur.maxAgeMin,
    markupPercent: cur.markupPercent,
    starUsd: cur.starUsd,
    auto: { ...cur.auto },
    cache: cur.cache,
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
  return normalizeRateSettings(next);
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

/** One round of Crypto Pay, CoinGecko and the CBR. The token is a header, never part of the url. */
export async function fetchRateQuotes(fetchImpl, creds) {
  const c = creds || {};
  const host = String(c.host || '').replace(/\/+$/, '');
  const payUrl = c.ready && c.token && PAY_HOSTS.has(host) ? host + '/api/getExchangeRates' : '';
  const headers = { accept: 'application/json' };
  const [pay, gecko, cbr] = await Promise.all([
    payUrl
      ? getJson(fetchImpl, payUrl, { ...headers, 'Crypto-Pay-API-Token': String(c.token) }, 'cryptopay')
      : Promise.resolve(null),
    getJson(fetchImpl, COINGECKO_URL, headers, 'coingecko'),
    getJson(fetchImpl, CBR_URL, headers, 'cbr'),
  ]);
  return combineRateQuotes(parseCryptoPayRates(pay), parseCoinGeckoRub(gecko), parseCbrUsdRub(cbr));
}

function anyAuto(book) {
  return !!(book.auto.usdt || book.auto.ton || book.auto.btc || book.auto.star);
}

let inflight = null;

/**
 * Refresh settings.rates when the last attempt is older than refreshMin.
 * Concurrent callers share one request. A failed round still stamps fetchedAt
 * so a donate tap does not hammer the hosts, and it does not replace a good rate.
 */
export async function ensureDonateRates(store, fetchImpl, now) {
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
