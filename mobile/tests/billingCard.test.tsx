// «Подписка OMP» card: a binding the server dropped shows «Устройство отключено - введите новый код» above the code
// field; a new code clears it and keeps the token pair.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { fakeSite, page, type FakeSite } from '../../tests/sources/fakeSite';

let site: FakeSite;
vi.mock('../src/searchContext', () => ({ phoneSourceContext: () => site.ctx }));

import { OmpJackettCard } from '../src/screens/OmpJackettCard';
import { billingNotice, billingSession, setBillingNotice } from '../../src/billing/session';
import { REFRESH_SECRET } from '../../src/billing/tokens';
import { clearBilling } from '../../src/sources/ompJackett';

let el: HTMLElement;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

beforeEach(async () => {
  localStorage.clear();
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
    return page(JSON.stringify({ telegramId: '', paidUntil: 2e12, active: true }), c.url);
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
});
