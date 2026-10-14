import { describe, it, expect } from 'vitest';
import { botReply } from '../src/bot.mjs';
import { restoreJackett, stripJackett } from '../src/jackett.mjs';
import { activate, applyPayment, createSubscription, openAccount } from '../src/logic.mjs';
import { emptyState } from '../src/store.mjs';
import { notificationHash, notificationOk } from '../src/yoomoney.mjs';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function paid() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now: NOW });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state, code: created.result.code, sub: created.result.subscriptionId, account: opened.account.id };
}

describe('subscription codes', () => {
  it('binds the first device and refuses the second', () => {
    const start = paid();
    const first = activate(start.state, { code: start.code, deviceId: 'a'.repeat(32), now: NOW });
    expect(first.result.token).toBeTruthy();
    const again = activate(first.state, { code: start.code, deviceId: 'a'.repeat(32), now: NOW });
    expect(again.result.token).toBeTruthy();
    const other = activate(first.state, { code: start.code, deviceId: 'b'.repeat(32), now: NOW });
    expect(other.result.error).toBe('other_device');
    expect(other.state.attempts.some((a: { reason: string }) => a.reason === 'other_device')).toBe(true);
  });

  it('a second payment for the same account extends the subscription', () => {
    const start = paid();
    const applied = applyPayment(start.state, { operationId: 'op1', label: 'new:' + start.account, amount: '100.00', now: NOW + 1000 });
    expect(applied.result.kind).toBe('renew');
    expect(applied.result.paidUntil).toBeGreaterThan(NOW + 30 * 24 * 60 * 60 * 1000);
  });

  it('an extra-device payment issues a new code', () => {
    const start = paid();
    const applied = applyPayment(start.state, { operationId: 'op2', label: 'dev:' + start.sub, amount: '50.00', now: NOW });
    expect(applied.result.kind).toBe('device');
    expect(applied.result.code).not.toBe(start.code);
    const bound = activate(applied.state, { code: applied.result.code, deviceId: 'c'.repeat(32), now: NOW });
    expect(bound.result.error).toBeUndefined();
  });
});

describe('YooMoney', () => {
  it('checks the notification signature', () => {
    const fields = {
      notification_type: 'p2p-incoming',
      operation_id: '1',
      amount: '100.00',
      currency: '643',
      datetime: '2026-10-14T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label: 'sub:abc',
      sha1_hash: '',
    };
    fields.sha1_hash = notificationHash(fields, 'secret');
    expect(notificationOk(fields, 'secret')).toBe(true);
    expect(notificationOk({ ...fields, amount: '1.00' }, 'secret')).toBe(false);
    expect(notificationOk({ ...fields, codepro: 'true' }, 'secret')).toBe(false);
  });
});

describe('Jackett proxy', () => {
  it('strips the key and the origin, then restores the download', () => {
    const xml = '<enclosure url="http://127.0.0.1:9117/dl/a?apikey=SECRET" /> SECRET';
    const clean = stripJackett(xml, 'http://127.0.0.1:9117', 'SECRET');
    expect(clean).not.toContain('SECRET');
    expect(clean).not.toContain('127.0.0.1:9117');
    expect(clean).toContain('omp-fetch:/dl/a?');
    const back = restoreJackett('omp-fetch:/dl/a', 'http://127.0.0.1:9117', 'SECRET');
    expect(back).toBe('http://127.0.0.1:9117/dl/a?apikey=SECRET');
  });
});

describe('bot', () => {
  it('shows the pay link when there is no subscription', () => {
    const state = emptyState();
    state.settings.yoomoneyWallet = '41001';
    state.settings.priceRub = 100;
    const out = botReply(state, { chatId: 7, text: '/start', now: NOW });
    expect(out.messages[0].text).toContain('https://yoomoney.ru/quickpay/confirm?');
    expect(out.messages[0].text).toContain('label=new%3A');
  });
});
