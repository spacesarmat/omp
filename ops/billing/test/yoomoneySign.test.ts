import { describe, expect, it } from 'vitest';
import {
  LABEL_MAX,
  encodeNotifyValue,
  isEmptyNotice,
  isTestNotification,
  minCreditedRub,
  notificationAuthentic,
  notificationHash,
  notificationOk,
  notificationSign,
  notificationSignString,
  payUrl,
  transferCovers,
} from '../src/yoomoney.mjs';

/** Published payment-buttons example. Secret and sign are the documentation values, not a live secret. */
const DOCUMENTED = {
  notification_type: 'p2p-incoming',
  operation_id: '441361714955017004',
  amount: '98.00',
  withdraw_amount: '100.00',
  currency: '643',
  datetime: '2013-12-26T08:28:34Z',
  sender: '41000000000',
  codepro: 'false',
  label: 'ML23045',
  unaccepted: 'false',
  sha1_hash: 'ac13833bd6ba9eff1fa9e4bed76f3d6ebb57f6c0',
  sign: 'a452af731650e2c5b39abcdc7c28dd27db7b3b654c2230ad2c386e64afb98605',
};
const DOCUMENTED_STRING =
  'amount=98.00&codepro=false&currency=643&datetime=2013-12-26T08%3A28%3A34Z&label=ML23045&notification_type=p2p-incoming&operation_id=441361714955017004&sender=41000000000&sha1_hash=ac13833bd6ba9eff1fa9e4bed76f3d6ebb57f6c0&unaccepted=false&withdraw_amount=100.00';

describe('YooMoney sign string', () => {
  it('matches the published example byte for byte, including colon encoding', () => {
    expect(notificationSignString(DOCUMENTED)).toBe(DOCUMENTED_STRING);
    expect(notificationSign(DOCUMENTED, 'secret123')).toBe(DOCUMENTED.sign);
    expect(notificationAuthentic(DOCUMENTED, 'secret123')).toBe(true);
    expect(notificationAuthentic(DOCUMENTED, 'other-secret')).toBe(false);
  });

  it('encodes UTF-8, space, plus and the RFC 3986 extras, and keeps an empty value', () => {
    expect(encodeNotifyValue('2013-12-26T08:28:34Z')).toBe('2013-12-26T08%3A28%3A34Z');
    expect(encodeNotifyValue('a b')).toBe('a%20b');
    expect(encodeNotifyValue('+7925')).toBe('%2B7925');
    expect(encodeNotifyValue('a@b.ru')).toBe('a%40b.ru');
    expect(encodeNotifyValue('Иван')).toBe('%D0%98%D0%B2%D0%B0%D0%BD');
    expect(encodeNotifyValue("a!*'()b")).toBe('a%21%2A%27%28%29b');
    const fields = { b: '', a: 'x', sign: 'ignored' };
    expect(notificationSignString(fields)).toBe('a=x&b=');
  });

  it('rejects a missing field, a swapped amount and a bad signature', () => {
    const broken = { ...DOCUMENTED };
    delete (broken as { datetime?: string }).datetime;
    expect(notificationAuthentic(broken, 'secret123')).toBe(false);
    expect(notificationAuthentic({ ...DOCUMENTED, amount: '98.01' }, 'secret123')).toBe(false);
    expect(notificationAuthentic({ ...DOCUMENTED, sign: 'ab' }, 'secret123')).toBe(false);
    expect(notificationAuthentic({ ...DOCUMENTED, sign: '' }, 'secret123')).toBe(false);
    const legacy = {
      notification_type: 'p2p-incoming',
      operation_id: '1',
      amount: '100.00',
      currency: '643',
      datetime: '2026-10-14T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label: 'sub:abc',
    };
    const sha1 = notificationHash(legacy, 'secret');
    expect(notificationOk({ ...legacy, sha1_hash: sha1 }, 'secret')).toBe(true);
    expect(notificationOk({ ...legacy, sha1_hash: sha1, amount: '1.00' }, 'secret')).toBe(false);
    const both = { ...legacy, sha1_hash: sha1 };
    both.sign = notificationSign(both, 'secret');
    expect(notificationAuthentic(both, 'secret')).toBe(true);
    // sign covers sha1_hash. A different hash is authentic only when sign is recomputed over it.
    const mixed = { ...both, sha1_hash: '00'.repeat(20) };
    mixed.sign = notificationSign(mixed, 'secret');
    expect(notificationAuthentic(mixed, 'secret')).toBe(true);
    expect(notificationAuthentic({ ...both, sign: 'ab' }, 'secret')).toBe(false);
  });

  it('does not treat a test flag or codepro as a payable notice', () => {
    const fields = { ...DOCUMENTED, test_notification: 'true' };
    fields.sign = notificationSign(fields, 'secret123');
    expect(isTestNotification(fields)).toBe(true);
    expect(notificationAuthentic(fields, 'secret123')).toBe(true);
    expect(notificationOk(fields, 'secret123')).toBe(false);
    const guarded = { ...DOCUMENTED, codepro: 'true' };
    delete (guarded as { sha1_hash?: string }).sha1_hash;
    guarded.sign = notificationSign(guarded, 'secret123');
    expect(notificationAuthentic(guarded, 'secret123')).toBe(true);
    expect(notificationOk(guarded, 'secret123')).toBe(false);
    expect(isEmptyNotice({})).toBe(true);
    expect(isEmptyNotice({ test_notification: 'true' })).toBe(false);
  });
});

describe('YooMoney amount, fee and form', () => {
  it('uses the documented wallet and card nets', () => {
    expect(minCreditedRub(1000, 'p2p-incoming')).toBeCloseTo(990.099, 3);
    expect(minCreditedRub(1000, 'card-incoming')).toBe(970);
    const wallet = { withdrawAmount: '1000.00', notificationType: 'p2p-incoming', requireWithdraw: true };
    expect(transferCovers('990.09', '643', 1000, wallet)).toBe(true);
    expect(transferCovers('969.98', '643', 1000, wallet)).toBe(false);
    const card = { withdrawAmount: '1000.00', notificationType: 'card-incoming', requireWithdraw: true };
    expect(transferCovers('970.00', '643', 1000, card)).toBe(true);
    expect(transferCovers('969.98', '643', 1000, card)).toBe(false);
    expect(transferCovers('1000.00', '643', 1000, card)).toBe(true);
    expect(transferCovers('50.00', '643', 1000, { ...card, withdrawAmount: '50.00' })).toBe(false);
    expect(transferCovers('1000.00', '643', 1000, { ...card, withdrawAmount: '999.00' })).toBe(false);
    expect(transferCovers('1001.00', '643', 1000, card)).toBe(false);
    expect(transferCovers('970.00', '840', 1000, card)).toBe(false);
    expect(transferCovers('970.00', '643', 1000, { notificationType: 'card-incoming', requireWithdraw: true })).toBe(false);
    expect(transferCovers('97.00', '643', 100)).toBe(true);
    expect(transferCovers('96.00', '643', 100)).toBe(false);
  });

  it('builds a quickpay link for the wallet, the order and the sum, with no return URL', () => {
    const label = 'buy:' + 'ab'.repeat(8);
    const url = payUrl('410011111111111', { sum: 150, label, targets: 'OMP 30' });
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://yoomoney.ru/quickpay/confirm?')).toBe(true);
    expect(q.get('receiver')).toBe('410011111111111');
    expect(q.get('sum')).toBe('150.00');
    expect(q.get('label')).toBe(label);
    expect(label.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(q.get('quickpay-form')).toBe('shop');
    expect(q.get('paymentType')).toBe('AC');
    expect(q.get('targets')).toBe('OMP 30');
    expect(q.get('successURL')).toBeNull();
  });
});
