import { createHash, createHmac } from 'node:crypto';
import { sameHex } from './crypto.mjs';

/**
 * YooMoney wallet collection: quickpay form + HTTP notice.
 * https://yoomoney.ru/docs/payment-buttons/using-api/forms
 * https://yoomoney.ru/docs/payment-buttons/using-api/notifications
 * https://yoomoney.ru/docs/wallet/using-api/notification-p2p-incoming
 *
 * This is not YooKassa and not the wallet-deposition protocol
 * (https://yoomoney.ru/docs/depositions/using-api/testing, agentId, certificates).
 *
 * `sign` is HMAC-SHA256 hex of every parameter except `sign`, keys sorted A-Z,
 * values percent-encoded in UTF-8. The published example encodes ":" as %3A.
 * `sha1_hash` is the legacy check. The docs say it stops arriving on 18 May 2026.
 */

const SHA1_ORDER = ['notification_type', 'operation_id', 'amount', 'currency', 'datetime', 'sender', 'codepro'];

/** Legacy SHA-1. Secret sits between codepro and label. Missing fields are empty. */
export function notificationHash(fields, secret) {
  const src = fields || {};
  const parts = SHA1_ORDER.map((k) => (src[k] === undefined || src[k] === null ? '' : String(src[k])));
  parts.push(secret === undefined || secret === null ? '' : String(secret));
  parts.push(src.label === undefined || src.label === null ? '' : String(src.label));
  return createHash('sha1').update(parts.join('&'), 'utf8').digest('hex');
}

/** Percent-encode one notice value. Unreserved ASCII stays plain; other bytes use uppercase hex. */
export function encodeNotifyValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

/** Canonical string for `sign`. `sign` itself is left out. Empty values stay as key=. Absent keys are omitted. */
export function notificationSignString(fields) {
  const src = fields || {};
  const keys = Object.keys(src)
    .filter((k) => k !== 'sign' && src[k] !== undefined && src[k] !== null)
    .sort();
  return keys.map((k) => k + '=' + encodeNotifyValue(src[k])).join('&');
}

export function notificationSign(fields, secret) {
  const key = secret === undefined || secret === null ? '' : String(secret);
  return createHmac('sha256', key).update(notificationSignString(fields), 'utf8').digest('hex');
}

/**
 * `sign` is the check. When it is present it decides, including a leftover `sha1_hash`
 * (the published example pairs a `sign` for secret123 with a sha1 from another illustration).
 * A bad `sign` is not saved by a valid legacy hash. With no `sign`, the legacy hash is checked.
 */
export function notificationAuthentic(fields, secret) {
  if (!secret || !fields || typeof fields !== 'object') return false;
  const sign = fields.sign == null ? '' : String(fields.sign);
  const sha1 = fields.sha1_hash == null ? '' : String(fields.sha1_hash);
  if (sign) return sameHex(notificationSign(fields, secret), sign.toLowerCase());
  if (!sha1) return false;
  return sameHex(notificationHash(fields, secret), sha1.toLowerCase());
}

function flagTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** Wallet docs: test_notification means the notice is a test. Absent means a live transfer. */
export function isTestNotification(fields) {
  return !!(fields && flagTrue(fields.test_notification));
}

/**
 * The wallet button "Протестировать" sends an empty notice.
 * https://yoomoney.ru/document/http-uvedomleniya
 */
export function isEmptyNotice(fields) {
  if (!fields || typeof fields !== 'object') return true;
  const keys = Object.keys(fields);
  for (let i = 0; i < keys.length; i++) {
    const v = fields[keys[i]];
    if (v !== undefined && v !== null && String(v) !== '') return false;
  }
  return true;
}

/**
 * A notice that may move money into a subscription: authentic, not a test, not code-protected.
 * codepro is documented as always false; a protected transfer is not spendable.
 */
export function notificationOk(fields, secret) {
  if (!notificationAuthentic(fields, secret)) return false;
  if (flagTrue(fields.codepro)) return false;
  if (isTestNotification(fields)) return false;
  return true;
}

/** Incoming wallet transfer or card top-up through the collection form. Anything else is ignored. */
export function noticeTypeOk(type) {
  return type === 'p2p-incoming' || type === 'card-incoming';
}

/**
 * Documented receiver fee (payment form):
 * card AC / card-incoming: amount_due = sum * (1 - 0.03)
 * wallet PC / p2p-incoming: amount_due = sum / 1.01
 * https://yoomoney.ru/docs/payment-buttons/using-api/forms
 */
export const CARD_FEE_RATE = 0.03;
export const WALLET_FEE_A = 0.01;

export function minCreditedRub(sum, notificationType) {
  const gross = Number(sum);
  if (!(gross > 0)) return NaN;
  if (notificationType === 'p2p-incoming') return gross / (1 + WALLET_FEE_A);
  return gross * (1 - CARD_FEE_RATE);
}

const KOPECK = 0.01;

function money(amount) {
  const n = Number(String(amount == null ? '' : amount).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * `price` is the form sum (what the sender must pay, `withdraw_amount`).
 * `amount` is what landed on the wallet after the fee.
 * Currency is always 643 (RUB). One kopeck of slack covers the documented rounding
 * (1000 from a wallet is credited as 990.09).
 * Without withdraw_amount the older net check remains (3% under the price), so a
 * legacy sha1 notice can still be accepted. `requireWithdraw` closes that for `sign`.
 */
export function transferCovers(amount, currency, price, opts) {
  const expected = Number(price) || 0;
  if (!(expected > 0)) return false;
  if (String(currency || '') !== '643') return false;
  const net = money(amount);
  if (!Number.isFinite(net)) return false;
  const type = opts && opts.notificationType;
  const withdrawRaw = opts && opts.withdrawAmount;
  const hasWithdraw = withdrawRaw !== undefined && withdrawRaw !== null && String(withdrawRaw) !== '';
  if (!hasWithdraw) {
    if (opts && opts.requireWithdraw) return false;
    return net + 1e-9 >= expected * (1 - CARD_FEE_RATE) - KOPECK;
  }
  const gross = money(withdrawRaw);
  if (!Number.isFinite(gross)) return false;
  if (gross + 1e-9 < expected - KOPECK) return false;
  if (net > gross + KOPECK) return false;
  const floor = minCreditedRub(expected, type);
  return net + 1e-9 >= floor - KOPECK;
}

/** Quickpay label limit from the form docs. */
export const LABEL_MAX = 64;

/**
 * Card payment link. `label` is returned on the notice and is the order id.
 * `quickpay-form=shop` keeps `targets` (the purpose the payer sees). The current
 * form doc lists `button` and does not document `targets`.
 * successURL is not set: a browser return is not a payment.
 */
export function payUrl(wallet, { sum, label, targets }) {
  const q = new URLSearchParams();
  q.set('receiver', wallet);
  q.set('quickpay-form', 'shop');
  q.set('targets', targets);
  q.set('paymentType', 'AC');
  q.set('sum', Number(sum).toFixed(2));
  q.set('label', label);
  return 'https://yoomoney.ru/quickpay/confirm?' + q.toString();
}
