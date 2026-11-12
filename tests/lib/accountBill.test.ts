import { describe, it, expect } from 'vitest';
import { billShown, formatPayAmount, paymentDate, paymentKind } from '../../src/lib/accountBill';

describe('account bill line', () => {
  it('hides a zero price and does not print a zero total', () => {
    expect(billShown(0, 0, 0).mode).toBe('hide');
    expect(billShown(200, 0, 0)).toEqual({ mode: 'price', price: 200, fee: 0, total: 200 });
    expect(billShown(200, 6, 0)).toEqual({ mode: 'full', price: 200, fee: 6, total: 206 });
    expect(billShown(200, 6, 206)).toEqual({ mode: 'full', price: 200, fee: 6, total: 206 });
  });

  it('turns a raw purchase id into a card renewal and formats kopecks', () => {
    expect(paymentKind('buy:f9b7b96aaf3c802e', 'RUB')).toBe('card');
    expect(paymentKind('buy:f9b7b96aaf3c802e', 'XTR')).toBe('stars');
    expect(paymentKind('buy:f9b7b96aaf3c802e', 'TON')).toBe('crypto');
    expect(paymentKind('buy:f9b7b96aaf3c802e', 'BTC')).toBe('crypto');
    expect(paymentKind('stars-pack')).toBe('stars');
    expect(paymentKind('sub')).toBe('named');
    expect(formatPayAmount('10.31', 'RUB')).toBe('10,31 ₽');
    expect(formatPayAmount('200', 'RUB')).toBe('200 ₽');
    expect(formatPayAmount('0.0001', 'TON')).toBe('0,0001 TON');
    expect(formatPayAmount('0.0000001', 'BTC')).toBe('0,0000001 BTC');
    expect(paymentDate(Date.UTC(2026, 9, 31))).toBe('31.10.2026');
  });
});
