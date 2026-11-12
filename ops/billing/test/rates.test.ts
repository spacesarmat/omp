import { describe, expect, it } from 'vitest';
import { starsForRub } from '../src/donate.mjs';
import { publicAdminSettings } from '../src/services.mjs';
import {
  acceptRub,
  applyMarkup,
  applyRateSettings,
  combineRateQuotes,
  donatePricing,
  ensureDonateRates,
  fetchRateQuotes,
  mergeRateBook,
  normalizeRateSettings,
  parseCbrUsdRub,
  parseCoinGeckoRub,
  parseCryptoPayRates,
  rateAdminView,
} from '../src/rates.mjs';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const TOKEN = 'crypto-pay-token-SECRET';

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' };
}

describe('donate rate parsing', () => {
  it('reads Crypto Pay RUB pairs and skips an invalid, zero or non-RUB row', () => {
    const parsed = parseCryptoPayRates({
      ok: true,
      result: [
        { is_valid: true, source: 'USDT', target: 'RUB', rate: '92.50' },
        { is_valid: false, source: 'TON', target: 'RUB', rate: '180' },
        { is_valid: true, source: 'BTC', target: 'USD', rate: '90000' },
        { is_valid: true, source: 'BTC', target: 'RUB', rate: '0' },
        { is_valid: true, source: 'ETH', target: 'RUB', rate: '300000' },
      ],
    });
    expect(parsed).toEqual({ usdt: 92.5 });
    expect(acceptRub('btc', 1)).toBe(0);
    expect(acceptRub('btc', 7_500_000)).toBe(7_500_000);
  });

  it('reads CoinGecko RUB prices and the CBR dollar', () => {
    expect(parseCoinGeckoRub({
      tether: { rub: 93.1 },
      'the-open-network': { rub: 210.5 },
      bitcoin: { rub: 8_100_000 },
      ethereum: { rub: 300_000 },
    })).toEqual({ usdt: 93.1, ton: 210.5, btc: 8_100_000 });
    expect(parseCbrUsdRub({ Valute: { USD: { Nominal: 1, Value: 91.25 } } })).toBe(91.25);
    expect(parseCbrUsdRub({ Valute: { USD: { Nominal: 10, Value: 912.5 } } })).toBe(91.25);
    expect(parseCbrUsdRub({ Valute: { EUR: { Nominal: 1, Value: 100 } } })).toBe(0);
  });

  it('prefers a Crypto Pay RUB pair and fills the gaps from CoinGecko and the CBR dollar', () => {
    const quotes = combineRateQuotes(
      { usdt: 92.5 },
      { usdt: 90, ton: 200, btc: 8_000_000 },
      91.2,
    );
    expect(quotes.usdt).toEqual({ rub: 92.5, source: 'cryptopay' });
    expect(quotes.ton).toEqual({ rub: 200, source: 'coingecko' });
    expect(quotes.btc).toEqual({ rub: 8_000_000, source: 'coingecko' });
    expect(quotes.usd).toEqual({ rub: 91.2, source: 'cbr' });
    const noCbr = combineRateQuotes({ usdt: 92.5, ton: 200 }, {}, 0);
    expect(noCbr.usd).toEqual({ rub: 92.5, source: 'cryptopay' });
  });
});

describe('donate rate cache', () => {
  it('keeps the last good rate when a source returns nothing and never stores zero', () => {
    const prev = mergeRateBook({}, {
      usdt: { rub: 92.5, source: 'cryptopay' },
      ton: { rub: 200, source: 'coingecko' },
      usd: { rub: 91, source: 'cbr' },
    }, NOW);
    const next = mergeRateBook(prev, { usdt: { rub: 0, source: 'cryptopay' }, btc: { rub: 8_000_000, source: 'coingecko' } }, NOW + 1000);
    expect(next.cache.usdt).toEqual({ rub: 92.5, source: 'cryptopay', at: NOW });
    expect(next.cache.ton).toEqual({ rub: 200, source: 'coingecko', at: NOW });
    expect(next.cache.btc).toEqual({ rub: 8_000_000, source: 'coingecko', at: NOW + 1000 });
    expect(next.cache.usd.rub).toBe(91);
    expect(next.fetchedAt).toBe(NOW + 1000);
  });

  it('uses a rate inside the max age and hides one that is older', () => {
    const settings = {
      cryptoRateUsdt: 1,
      donate: { rubPerStar: 9 },
      rates: mergeRateBook({}, {
        usdt: { rub: 100, source: 'cryptopay' },
        usd: { rub: 100, source: 'cbr' },
      }, NOW),
    };
    expect(donatePricing(settings, NOW).cryptoRateUsdt).toBe(100);
    expect(donatePricing(settings, NOW).rubPerStar).toBeCloseTo(1.3, 5);
    const day = 24 * 60 * 60 * 1000;
    expect(donatePricing(settings, NOW + day).cryptoRateUsdt).toBe(100);
    expect(donatePricing(settings, NOW + day + 1).cryptoRateUsdt).toBe(0);
    expect(donatePricing(settings, NOW + day + 1).rubPerStar).toBe(0);
  });

  it('applies markup on top of the auto rate and leaves a manual rate untouched', () => {
    const rates = mergeRateBook({ markupPercent: 10, starUsd: 0.013 }, {
      usdt: { rub: 110, source: 'cryptopay' },
      usd: { rub: 100, source: 'cbr' },
    }, NOW);
    const auto = donatePricing({ cryptoRateUsdt: 50, donate: { rubPerStar: 2 }, rates }, NOW);
    expect(auto.cryptoRateUsdt).toBeCloseTo(100, 5);
    expect(auto.rubPerStar).toBeCloseTo(1.3 / 1.1, 5);
    expect(starsForRub(100, auto.rubPerStar)).toBe(85);
    expect(applyMarkup(110, 10)).toBeCloseTo(100, 5);
    const manual = donatePricing({
      cryptoRateUsdt: 50,
      donate: { rubPerStar: 2 },
      rates: { ...rates, auto: { usdt: false, ton: false, btc: false, star: false } },
    }, NOW);
    expect(manual.cryptoRateUsdt).toBe(50);
    expect(manual.rubPerStar).toBe(2);
    expect(starsForRub(100, manual.rubPerStar)).toBe(50);
  });
});

describe('donate rate fetch', () => {
  it('calls Crypto Pay on the active host, then CoinGecko and the CBR, without putting the token in the url', async () => {
    const calls: { url: string; token: string; redirect: string }[] = [];
    const lines: string[] = [];
    const write = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
      calls.push({
        url: String(url),
        token: init && init.headers ? String(init.headers['Crypto-Pay-API-Token'] || '') : '',
        redirect: init && init.redirect ? String(init.redirect) : '',
      });
      if (String(url).indexOf('/api/getExchangeRates') >= 0) return json(503, { ok: false });
      if (String(url).indexOf('coingecko') >= 0) {
        return json(200, { tether: { rub: 93 }, 'the-open-network': { rub: 200 }, bitcoin: { rub: 8_000_000 } });
      }
      return json(200, { Valute: { USD: { Nominal: 1, Value: 91 } } });
    };
    try {
      const quotes = await fetchRateQuotes(fetchImpl, {
        ready: true,
        token: TOKEN,
        host: 'https://testnet-pay.crypt.bot',
        testnet: true,
      });
      expect(quotes.usdt).toEqual({ rub: 93, source: 'coingecko' });
      expect(quotes.usd).toEqual({ rub: 91, source: 'cbr' });
      const pay = calls.find((c) => c.url.indexOf('getExchangeRates') >= 0);
      expect(pay && pay.url).toBe('https://testnet-pay.crypt.bot/api/getExchangeRates');
      expect(pay && pay.token).toBe(TOKEN);
      expect(pay && pay.redirect).toBe('error');
      expect(calls.map((c) => c.url).join('\n')).not.toContain(TOKEN);
      expect(lines.join('')).not.toContain(TOKEN);
    } finally {
      process.stderr.write = write;
    }
  });

  it('refreshes a stale book into the store and does not fetch again until the interval passes', async () => {
    let fetches = 0;
    const fetchImpl = async (url: string) => {
      fetches += 1;
      if (String(url).indexOf('getExchangeRates') >= 0) {
        return json(200, { ok: true, result: [{ is_valid: true, source: 'USDT', target: 'RUB', rate: '95' }] });
      }
      if (String(url).indexOf('coingecko') >= 0) return json(500, {});
      return json(200, { Valute: { USD: { Nominal: 1, Value: 95 } } });
    };
    let state = {
      settings: {
        cryptoPayToken: TOKEN,
        cryptoTestnet: false,
        rates: { fetchedAt: NOW - 13 * 60 * 1000, cache: { usdt: { rub: 90, source: 'cryptopay', at: NOW - 13 * 60 * 1000 } } },
      },
    };
    const store = {
      async read() {
        return JSON.parse(JSON.stringify(state));
      },
      async update(fn: (cur: typeof state) => { state: typeof state }) {
        const out = await fn(JSON.parse(JSON.stringify(state)));
        state = out.state;
        return out;
      },
    };
    const first = await ensureDonateRates(store, fetchImpl, NOW);
    expect(first.cache.usdt).toEqual({ rub: 95, source: 'cryptopay', at: NOW });
    expect(first.cache.usd).toEqual({ rub: 95, source: 'cbr', at: NOW });
    expect(state.settings.rates.cache.usdt.rub).toBe(95);
    const after = fetches;
    await ensureDonateRates(store, fetchImpl, NOW + 60 * 1000);
    expect(fetches).toBe(after);
    const failed = async () => json(500, {});
    await ensureDonateRates(store, failed, NOW + 13 * 60 * 1000);
    expect(state.settings.rates.cache.usdt.rub).toBe(95);
    expect(state.settings.rates.fetchedAt).toBe(NOW + 13 * 60 * 1000);
  });
});

describe('donate rate admin', () => {
  it('defaults every rate to auto and shows the usable value, source and time', () => {
    const fresh = normalizeRateSettings(undefined);
    expect(fresh.auto).toEqual({ usdt: true, ton: true, btc: true, star: true });
    expect(fresh.starUsd).toBe(0.013);
    expect(fresh.markupPercent).toBe(0);
    expect(fresh.refreshMin).toBe(12);
    expect(fresh.maxAgeMin).toBe(1440);
    const settings = {
      donate: { rubPerStar: 2 },
      cryptoRateUsdt: 40,
      rates: mergeRateBook({}, { usdt: { rub: 92, source: 'cryptopay' }, usd: { rub: 90, source: 'cbr' } }, NOW),
    };
    const view = rateAdminView(settings, NOW);
    expect(view.rows.star.auto).toBe(true);
    expect(view.rows.star.source).toBe('cbr');
    expect(view.rows.star.at).toBe(NOW);
    expect(view.rows.star.usable).toBe(true);
    expect(view.rows.star.value).toBeCloseTo(0.013 * 90, 5);
    expect(view.rows.star.manual).toBe(2);
    expect(view.rows.usdt.value).toBe(92);
    expect(view.rows.usdt.manual).toBe(40);
    expect(publicAdminSettings(settings).rates.rows.usdt.source).toBe('cryptopay');
  });

  it('saves an auto switch, the star price and the markup without wiping the cache', () => {
    const prev = mergeRateBook({ starUsd: 0.013 }, { usdt: { rub: 92, source: 'cryptopay' } }, NOW);
    const next = applyRateSettings(prev, {
      rateAutoStar: 'false',
      rateAutoUsdt: 'true',
      starUsd: '0,020',
      markupPercent: '10',
      maxAgeHours: '6',
    });
    expect(next.auto.star).toBe(false);
    expect(next.auto.usdt).toBe(true);
    expect(next.auto.ton).toBe(true);
    expect(next.starUsd).toBe(0.02);
    expect(next.markupPercent).toBe(10);
    expect(next.maxAgeMin).toBe(360);
    expect(next.cache.usdt.rub).toBe(92);
    const kept = applyRateSettings(next, { starUsd: 'nope', markupPercent: '200', maxAgeHours: '0' });
    expect(kept.starUsd).toBe(0.02);
    expect(kept.markupPercent).toBe(10);
    expect(kept.maxAgeMin).toBe(360);
  });
});
