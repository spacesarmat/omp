import { createHash, createHmac } from 'node:crypto';
import { sameHex } from './crypto.mjs';

/**
 * Crypto Pay API (@CryptoBot).
 * https://help.crypt.bot/crypto-pay-api
 *
 * The token is CRYPTO_PAY_TOKEN. It is never written here and never logged.
 * The webhook signature is HMAC-SHA256 of the raw body. The key is SHA256(token), the raw digest.
 */

export const CRYPTO_ASSETS = ['USDT', 'TON', 'BTC'];

/** Minor units Crypto Pay invoices use for each asset. */
export const ASSET_SCALE = { USDT: 2, TON: 4, BTC: 8 };

const MAINNET = 'https://pay.crypt.bot';
const TESTNET = 'https://testnet-pay.crypt.bot';

export function cryptoPayHost(testnet) {
  return testnet ? TESTNET : MAINNET;
}

/** SHA256(token) as the HMAC key (32 raw bytes, not the hex text). */
export function cryptoPayKey(token) {
  return createHash('sha256').update(String(token == null ? '' : token), 'utf8').digest();
}

/** Hex HMAC-SHA256 of the exact request body. */
export function cryptoPaySign(rawBody, token) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? '' : rawBody), 'utf8');
  return createHmac('sha256', cryptoPayKey(token)).update(body).digest('hex');
}

/** True only when the header matches the raw body. A missing token or header is false. */
export function cryptoPayAuthentic(rawBody, header, token) {
  const tokenText = String(token == null ? '' : token);
  const got = String(header == null ? '' : header).trim().toLowerCase();
  if (!tokenText || !got) return false;
  return sameHex(cryptoPaySign(rawBody, tokenText), got);
}

/** Integer minor units at `scale`, or null when the text is not a non-negative decimal. */
export function minorUnits(value, scale) {
  const s = String(value == null ? '' : value).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.min(12, Math.max(0, scale | 0));
  const parts = s.split('.');
  const whole = parts[0];
  const frac = parts[1] || '';
  if (whole.length > 18) return null;
  const padded = (frac + '000000000000').slice(0, n);
  const unit = BigInt(whole) * 10n ** BigInt(n) + BigInt(padded || '0');
  return unit;
}

/**
 * Paid amount covers the invoice. Equal is enough. Less is a short payment.
 * Compared in minor units so 1.50 and 1.5 are the same.
 */
export function amountCovers(paid, expected) {
  const need = minorUnits(expected, 8);
  const got = minorUnits(paid, 8);
  if (need == null || got == null || need <= 0n) return false;
  return got >= need;
}

/** Fixed-scale decimal string. Half away from zero on the last kept digit. Empty when the amount is not positive. */
export function formatAsset(asset, value) {
  const scale = ASSET_SCALE[asset];
  if (!scale) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || !(n > 0)) return '';
  const factor = 10 ** scale;
  const units = Math.round(n * factor + (n < 0 ? -1e-9 : 1e-9));
  if (!(units > 0) || !Number.isSafeInteger(units)) return '';
  const whole = Math.floor(units / factor);
  const frac = String(units % factor).padStart(scale, '0');
  return whole + '.' + frac;
}

/** Body of createInvoice. payload is the order id (buy:id). amount is the exact string we will check later. */
export function createInvoiceBody({ asset, amount, payload, description }) {
  return {
    asset,
    amount: String(amount),
    description: String(description || 'Подписка OMP').slice(0, 1024),
    payload: String(payload || '').slice(0, 4000),
    expires_in: 24 * 60 * 60,
  };
}

/** Invoice urls from a successful createInvoice answer, or null. */
export function invoiceFromApi(data) {
  const result = data && data.ok === true ? data.result : null;
  if (!result || result.invoice_id == null) return null;
  const botUrl = String(result.bot_invoice_url || result.pay_url || '');
  const webUrl = String(result.web_app_invoice_url || result.mini_app_invoice_url || botUrl || '');
  if (!botUrl && !webUrl) return null;
  return {
    invoiceId: String(result.invoice_id),
    botUrl,
    webUrl: webUrl || botUrl,
    asset: String(result.asset || ''),
    amount: String(result.amount || ''),
  };
}

/**
 * invoice_paid update. Returns null for any other event.
 * paidAmount is what arrived; amount is what the invoice asked for.
 */
export function paidInvoice(body) {
  if (!body || body.update_type !== 'invoice_paid') return null;
  const row = body.payload;
  if (!row || row.status !== 'paid' || row.invoice_id == null) return null;
  const asset = String(row.paid_asset || row.asset || '');
  const paidAmount = row.paid_amount != null && String(row.paid_amount) !== '' ? String(row.paid_amount) : String(row.amount || '');
  return {
    invoiceId: String(row.invoice_id),
    payload: String(row.payload || ''),
    asset,
    amount: String(row.amount || ''),
    paidAmount,
  };
}

/**
 * POST createInvoice. Returns the invoice or null. The token is sent as a header and not logged.
 * Redirects are refused. A non-200 or a bad body is null.
 */
export async function createCryptoInvoice(fetchImpl, { testnet, token, asset, amount, payload, description }) {
  const host = cryptoPayHost(!!testnet);
  const url = host + '/api/createInvoice';
  const net = fetchImpl || fetch;
  let res;
  try {
    res = await net(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'Crypto-Pay-API-Token': String(token || ''),
      },
      body: JSON.stringify(createInvoiceBody({ asset, amount, payload, description })),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    process.stderr.write('crypto pay create failed\n');
    return null;
  }
  if (!res || !res.ok) {
    process.stderr.write('crypto pay create status=' + Number(res && res.status) + '\n');
    return null;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    process.stderr.write('crypto pay create bad json\n');
    return null;
  }
  const invoice = invoiceFromApi(data);
  if (!invoice) process.stderr.write('crypto pay create no invoice\n');
  return invoice;
}
