/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { ConfirmHost } from '../admin/src/components/confirm.tsx';
import { DonationsPanel } from '../admin/src/panels/DonationsPanel.tsx';
import { ReferralPanel } from '../admin/src/panels/ReferralPanel.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = createRoot(document.getElementById('app')!);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('donation form', () => {
  it('shows the subscription number from the rate book and saves the amounts', async () => {
    const run = vi.fn(async () => ({ ok: true }));
    act(() => {
      root.render(
        createElement(DonationsPanel, {
          settings: { enabled: true, amounts: '100,300', minRub: 50, maxRub: 5000, yoomoney: true },
          rates: { sub: { stars: 154, starsExtra: 40, usdt: '2.2', ton: '1', btc: '0.0001' } },
          run,
        }),
      );
    });
    await settle();
    expect(document.body.textContent).toContain('Подписка сейчас: 154');
    const amounts = document.querySelector('input[value="100,300"]') as HTMLInputElement;
    expect(amounts).toBeTruthy();
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto!.set!.call(amounts, '100,500');
      amounts.dispatchEvent(new Event('input', { bubbles: true }));
      amounts.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Сохранить');
    act(() => save!.click());
    await settle();
    expect(run).toHaveBeenCalledWith('/admin/donate', expect.objectContaining({ amounts: '100,500', minRub: '50' }));
  });
});

describe('referral form', () => {
  it('does not cancel an accrual until the yes button', async () => {
    const run = vi.fn(async () => ({ ok: true, flash: { text: 'отменено' } }));
    act(() => {
      root.render(
        createElement(
          'div',
          null,
          createElement(ConfirmHost),
          createElement(ReferralPanel, {
            csrf: 'tok',
            settings: { enabled: true },
            journal: [{ id: 'row-1', friendId: 'friend', status: 'granted', days: 7, variant: 'days' }],
            run,
          }),
        ),
      );
    });
    await settle();
    const cancel = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Отменить');
    expect(cancel).toBeTruthy();
    act(() => cancel!.click());
    await settle();
    expect(document.body.textContent).toContain('Дни и баланс');
    expect(run).not.toHaveBeenCalled();
    const yes = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Отменить начисление');
    act(() => yes!.click());
    await settle();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cancelId: 'row-1' }));
  });
});
