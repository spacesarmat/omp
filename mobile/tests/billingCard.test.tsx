// «Подписка OMP» card: a binding the server dropped shows «Устройство отключено - введите новый код» above the code
// field; a new code clears it and keeps the token pair.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { fakeSite, page, type FakeSite } from '../../tests/sources/fakeSite';

let site: FakeSite;
const me: {
  telegramId: string;
  paidUntil: number;
  active: boolean;
  overLimit?: boolean;
  bill?: { priceRub: number; feeRub: number; totalRub: number; autoRenew: boolean; payments: { at: number; amount: string; currency: string; title: string }[] };
} = {
  telegramId: '',
  paidUntil: 2e12,
  active: true,
};
vi.mock('../src/searchContext', () => ({ phoneSourceContext: () => site.ctx }));

import { OmpJackettCard } from '../src/screens/OmpJackettCard';
import { billingNotice, billingSession, saveBillingSession, setBillingNotice } from '../../src/billing/session';
import { BILLING_BOT_URL } from '../../src/billing/config';
import { REFRESH_SECRET } from '../../src/billing/tokens';
import { clearBilling } from '../../src/sources/ompJackett';

let el: HTMLElement;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

beforeEach(async () => {
  localStorage.clear();
  me.telegramId = '';
  me.paidUntil = 2e12;
  me.active = true;
  me.overLimit = false;
  delete me.bill;
  site = fakeSite((c) => {
    if (c.url.indexOf('/v1/activate') > 0) {
      return page(
        JSON.stringify({
          refreshToken: 'r1.x',
          accessToken: 'a1.x',
          accessExpiresAt: Date.now() + 864e5,
          refreshExpiresAt: 3e12,
          paidUntil: 2e12,
        }),
        c.url,
      );
    }
    return page(JSON.stringify(me), c.url);
  }, {});
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
});

afterEach(() => {
  act(() => render(null, el));
  clearBilling();
});

describe('OMP subscription card', () => {
  it('shows the disconnected notice until a new code works', async () => {
    setBillingNotice('revoked');
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    const notice = el.querySelector('[data-notice="revoked"]');
    expect(notice && notice.textContent).toBe('Устройство отключено - введите новый код');

    const input = el.querySelector('#omp-code') as HTMLInputElement;
    act(() => {
      input.value = 'ABCD-EFGH';
      input.dispatchEvent(new Event('input'));
    });
    const button = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Подключить')!;
    act(() => button.click());
    await flush();
    expect(billingSession()!.access).toBe('a1.x');
    expect(site.secrets[REFRESH_SECRET]).toBe('r1.x');
    expect(billingNotice()).toBe('');
    expect(el.querySelector('[data-notice="revoked"]')).toBeNull();
    expect(el.querySelector('#omp-code')).toBeNull();
  });

  it('says the key was not saved when the Keystore copy is missing after a restart', async () => {
    setBillingNotice('keystore');
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    const notice = el.querySelector('[data-notice="keystore"]');
    expect(notice && notice.textContent).toBe('Ключ подписки не сохранился на телефоне - введите код заново');
  });

  it('Продлить opens card, stars and crypto, with no standalone crypto button', async () => {
    saveBillingSession({ token: 'legacy-token', paidUntil: 2e12 });
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    expect(el.querySelector('[data-action="crypto"]')).toBeNull();
    expect(el.querySelector('[data-pay-methods]')).toBeNull();
    const renew = el.querySelector('[data-action="renew"]') as HTMLButtonElement;
    expect(renew.textContent).toBe('Продлить');
    act(() => renew.click());
    expect(Array.from(el.querySelectorAll('[data-pay-methods] button')).map((b) => b.textContent)).toEqual(['Карта', 'Звёзды', 'Крипта']);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => (el.querySelector('[data-pay="card"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('[data-pay="stars"]') as HTMLButtonElement).click());
    expect(open.mock.calls).toEqual([
      [BILLING_BOT_URL + '?start=renew', '_system'],
      [BILLING_BOT_URL + '?start=renew', '_system'],
    ]);
    open.mockRestore();
  });

  it('shows days, hides the id and the bot line, and keeps Telegram in a menu', async () => {
    me.telegramId = '424242';
    me.paidUntil = Date.now() + 10 * 86400000;
    me.active = true;
    saveBillingSession({ token: 'legacy-token', paidUntil: me.paidUntil });
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    expect(el.textContent).not.toContain('Подписка OMP');
    expect(el.textContent).not.toContain('424242');
    expect(el.textContent).not.toContain('@OMPBILLINGBOT');
    expect(el.querySelector('[data-bill-dot]')).toBeTruthy();
    expect(el.querySelector('[data-bill-days]')!.textContent).toContain('10');
    expect(el.querySelector('[data-bill-about]')).toBeNull();
    act(() => (el.querySelector('[data-bill-info]') as HTMLButtonElement).click());
    expect(el.querySelector('[data-bill-about]')!.textContent).toContain('Действует до');
    act(() => (el.querySelector('[data-tg-menu]') as HTMLButtonElement).click());
    const actions = Array.from(el.querySelectorAll('[data-tg-actions] button')).map((b) => b.textContent);
    expect(actions).toEqual(['Открыть бота', 'Отвязать']);
  });

  it('keeps the remaining days when only the extra device slot has ended', async () => {
    me.paidUntil = Date.now() + 5 * 86400000;
    me.active = false;
    me.overLimit = true;
    saveBillingSession({ token: 'legacy-token', paidUntil: me.paidUntil });
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    expect(el.querySelector('[data-bill-dot]')).toBeNull();
    expect(el.querySelector('[data-bill-days]')!.textContent).toContain('5');
    expect(el.textContent).not.toContain('Подписка закончилась');
    expect(el.textContent).toContain('Доп. устройство не продлено');
  });

  it('shows the price, the fee and the payments, and cancels auto-renew', async () => {
    me.bill = {
      priceRub: 200,
      feeRub: 6,
      totalRub: 206,
      autoRenew: true,
      payments: [{ at: 5, amount: '200', currency: 'RUB', title: 'sub' }],
    };
    saveBillingSession({ token: 'legacy-token', paidUntil: me.paidUntil });
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    expect(el.querySelector('[data-bill-price]')!.textContent).toBe('200 ₽ + комиссия 6 ₽ = 206 ₽');
    expect(el.querySelector('[data-bill-payments]')!.textContent).toContain('sub');
    expect(el.querySelector('[data-bill-payments]')!.textContent).toContain('200 ₽');
    expect(el.querySelector('[data-bill-payments]')!.textContent).not.toContain('RUB');
    expect(el.querySelector('[data-bill-cancel]')).toBeTruthy();
  });

  it('hides a zero total and does not show a raw purchase id', async () => {
    me.bill = {
      priceRub: 200,
      feeRub: 0,
      totalRub: 0,
      autoRenew: false,
      payments: [{ at: Date.UTC(2026, 9, 31), amount: '10.31', currency: 'RUB', title: 'buy:f9b7b96aaf3c802e' }],
    };
    saveBillingSession({ token: 'legacy-token', paidUntil: me.paidUntil });
    await act(async () => render(<OmpJackettCard />, el));
    await flush();
    expect(el.querySelector('[data-bill-price]')!.textContent).toBe('200 ₽');
    const row = el.querySelector('[data-payment]')!.textContent || '';
    expect(row).toContain('Продление · карта');
    expect(row).toContain('10,31 ₽');
    expect(row).toContain('31.10.2026');
    expect(row).not.toContain('buy:');
  });
});
