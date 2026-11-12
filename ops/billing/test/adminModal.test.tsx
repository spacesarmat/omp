/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Modal } from '../admin/src/components/modal.tsx';
import { LogDialog } from '../admin/src/components/logDialog.tsx';
import { NucDesk } from '../admin/src/panels/DeskViews.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let app: HTMLElement;

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
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  app = document.getElementById('app')!;
  root = createRoot(app);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('admin modal', () => {
  it('names the window, closes on Esc and keeps Tab inside', () => {
    const onClose = vi.fn();
    render(
      createElement(Modal, { title: 'Лог omp-billing', onClose }, createElement('button', { type: 'button' }, 'Раз'), createElement('button', { type: 'button' }, 'Два')),
    );
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') || '')?.textContent).toBe('Лог omp-billing');
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    buttons[buttons.length - 1].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('filters, refreshes and copies the log', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const onRefresh = vi.fn();
    render(createElement(LogDialog, { title: 'Лог omp-caddy', text: 'one\nERROR two\nthree', onClose: () => {}, onRefresh }));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const pre = dialog.querySelector('pre')!;
    expect(pre.textContent).toContain('ERROR two');
    const filter = dialog.querySelector('input') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(filter, 'error');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(pre.textContent).toBe('ERROR two');
    (dialog.querySelector('button') as HTMLButtonElement).click();
    expect(onRefresh).not.toHaveBeenCalled();
    const refresh = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Обновить')!;
    refresh.click();
    expect(onRefresh).toHaveBeenCalledOnce();
    const copy = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Копировать')!;
    await act(async () => {
      copy.click();
      await Promise.resolve();
    });
    expect(write).toHaveBeenCalledWith('ERROR two');
    expect(document.getElementById('toast')?.textContent).toBe('Скопировано');
  });

  it('opens NUC logs over the page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (path.indexOf('/admin/api/nuc/logs') >= 0) {
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, lines: 'boot\nready' }) };
      }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          containers: [{ id: 'abc', name: 'omp-billing', state: 'running', status: 'Up', cpu: 1, mem: 1048576, restart: false }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(NucDesk, { csrf: 'tok' })));
    await settle();
    expect(app.textContent).toContain('omp-billing');
    const logButton = Array.from(app.querySelectorAll('button')).find((b) => b.textContent === 'Лог')!;
    await act(async () => {
      logButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Лог omp-billing');
    expect(dialog.querySelector('pre')?.textContent).toContain('boot');
    expect(Array.from(document.querySelectorAll('pre')).every((node) => dialog.contains(node))).toBe(true);
  });
});
