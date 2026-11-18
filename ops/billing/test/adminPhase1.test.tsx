/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmHost, askConfirm } from '../admin/src/components/confirm.tsx';
import { NucDesk } from '../admin/src/panels/DeskViews.tsx';
import { CrashesDesk } from '../admin/src/panels/OpsExtra.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

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
  vi.unstubAllGlobals();
});

describe('confirm dialog', () => {
  it('does not resolve until the person presses the yes button', async () => {
    render(createElement(ConfirmHost));
    await settle();
    let result: boolean | undefined;
    void askConfirm({ title: 'Промокод', body: 'Создать промокод на 1 день?', yes: 'Создать' }).then((ok) => {
      result = ok;
    });
    await settle();
    expect(document.body.textContent).toContain('Создать промокод на 1 день?');
    expect(result).toBeUndefined();
    const yes = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Создать')!;
    await act(async () => {
      yes.click();
    });
    expect(result).toBe(true);
  });

  it('resolves false on cancel', async () => {
    render(createElement(ConfirmHost));
    await settle();
    const pending = askConfirm({ title: 'Скрыть комментарий', body: 'Комментарий скроется.', yes: 'Скрыть' });
    await settle();
    const cancel = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Отмена')!;
    await act(async () => {
      cancel.click();
    });
    await expect(pending).resolves.toBe(false);
  });
});

describe('empty operational screens', () => {
  it('explains a missing NUC without the env variable name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ error: 'нет BILLING_DOCKER_PROXY_URL', containers: [] }) })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(NucDesk, { csrf: 'tok' })));
    await settle();
    expect(document.body.textContent).toContain('не видны');
    expect(document.body.textContent).not.toContain('BILLING_DOCKER');
  });

  it('gives crashes an empty card with a title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ groups: [] }) })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(CrashesDesk, { csrf: 'tok' })));
    await settle();
    expect(document.body.textContent).toContain('Сбои');
    expect(document.body.textContent).toContain('Сбоев нет');
  });
});
