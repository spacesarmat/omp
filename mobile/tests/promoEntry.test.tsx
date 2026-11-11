import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { fakeSite, page, type FakeSite } from '../../tests/sources/fakeSite';

let site: FakeSite;
let promoSeen = false;
vi.mock('../src/searchContext', () => ({ phoneSourceContext: () => site.ctx }));

import { Account } from '../src/screens/Account';
import { saveBillingSession } from '../../src/billing/session';
import { clearBilling } from '../../src/sources/ompJackett';

let el: HTMLElement;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });

beforeEach(async () => {
  localStorage.clear();
  promoSeen = false;
  site = fakeSite((c) => {
    if (c.url.indexOf('/v1/promo') >= 0) {
      promoSeen = true;
      return page(JSON.stringify({ ok: true, days: 7 }), c.url);
    }
    const until = promoSeen ? Date.UTC(2026, 5, 1) : Date.UTC(2026, 0, 1);
    return page(JSON.stringify({ telegramId: '', paidUntil: until, active: true, deviceLimit: 2 }), c.url);
  }, {});
  saveBillingSession({ token: 'legacy-token', paidUntil: Date.UTC(2026, 0, 1) });
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
});

afterEach(() => {
  act(() => render(null, el));
  clearBilling();
});

describe('promo on the account screen', () => {
  it('refreshes the paid-until date after a code is accepted', async () => {
    await act(async () => render(<Account />, el));
    await flush();
    expect(el.querySelector('[data-paid-until]')!.getAttribute('data-paid-until')).toBe('01.01.2026');
    const input = el.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = 'GIFT';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    const button = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Активировать')!;
    await act(async () => button.click());
    await flush();
    expect(el.textContent).toContain('Промокод принят');
    expect(el.querySelector('[data-paid-until]')!.getAttribute('data-paid-until')).toBe('01.06.2026');
  });
});
