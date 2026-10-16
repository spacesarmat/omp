import { createHash } from 'node:crypto';
import { sameHex } from './crypto.mjs';

/**
 * YooMoney HTTP notification check.
 * https://yoomoney.ru/docs/wallet/using-api/notification-p2p-incoming
 * The signed string is the fields joined by "&", secret included, label last.
 */
export function notificationHash(fields, secret) {
  const parts = [
    fields.notification_type,
    fields.operation_id,
    fields.amount,
    fields.currency,
    fields.datetime,
    fields.sender,
    fields.codepro,
    secret,
    fields.label,
  ].map((x) => (x === undefined || x === null ? '' : String(x)));
  return createHash('sha1').update(parts.join('&'), 'utf8').digest('hex');
}

export function notificationOk(fields, secret) {
  if (!secret || !fields || fields.codepro === 'true') return false;
  return sameHex(notificationHash(fields, secret), String(fields.sha1_hash || '').toLowerCase());
}

/** Card payment form. `label` comes back in the notification. */
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
