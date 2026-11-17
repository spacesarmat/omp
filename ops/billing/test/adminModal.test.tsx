/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Modal } from '../admin/src/components/modal.tsx';
import { LogDialog } from '../admin/src/components/logDialog.tsx';
import { NucDesk, SourcesDesk } from '../admin/src/panels/DeskViews.tsx';
import { CrashesDesk } from '../admin/src/panels/OpsExtra.tsx';

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

function pathOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function jsonResponse(body: unknown) {
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => body };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function closeButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Закрыть') as HTMLButtonElement;
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

  it('keeps Shift+Tab inside when the window itself holds focus', () => {
    render(
      createElement(Modal, { title: 'Лог', onClose: () => {} }, createElement('button', { type: 'button' }, 'Раз'), createElement('button', { type: 'button' }, 'Два')),
    );
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    const buttons = Array.from(dialog.querySelectorAll('button'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('does not reopen a NUC log closed while its request runs', async () => {
    const gate = deferred<{ ok: boolean; lines: string }>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (pathOf(input).indexOf('/admin/api/nuc/logs') >= 0) {
        return gate.promise.then((body) => jsonResponse(body));
      }
      return Promise.resolve(
        jsonResponse({ containers: [{ id: 'abc', name: 'omp-billing', state: 'running', status: 'Up', cpu: 1, mem: 1048576, restart: false }] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(NucDesk, { csrf: 'tok' })));
    await settle();
    const logButton = Array.from(app.querySelectorAll('button')).find((b) => b.textContent === 'Лог')!;
    await act(async () => {
      logButton.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => {
      closeButton().click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      gate.resolve({ ok: true, lines: 'boot\nready' });
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('lets a newer NUC log win over a late reply', async () => {
    const pending: { name: string; resolve: (body: { ok: boolean; lines: string }) => void }[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.indexOf('/admin/api/nuc/logs') >= 0) {
        const name = decodeURIComponent(path.split('name=')[1]);
        const gate = deferred<{ ok: boolean; lines: string }>();
        pending.push({ name, resolve: gate.resolve });
        return gate.promise.then((body) => jsonResponse(body));
      }
      return Promise.resolve(
        jsonResponse({
          containers: [
            { id: 'a', name: 'omp-a', state: 'running', status: 'Up', cpu: 1, mem: 1048576, restart: false },
            { id: 'b', name: 'omp-b', state: 'running', status: 'Up', cpu: 1, mem: 1048576, restart: false },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(NucDesk, { csrf: 'tok' })));
    await settle();
    const logButtons = Array.from(app.querySelectorAll('button')).filter((b) => b.textContent === 'Лог');
    await act(async () => {
      logButtons[0].click();
    });
    await act(async () => {
      closeButton().click();
    });
    await act(async () => {
      logButtons[1].click();
    });
    expect(pending.map((p) => p.name)).toEqual(['omp-a', 'omp-b']);
    await act(async () => {
      pending[1].resolve({ ok: true, lines: 'beta' });
    });
    await settle();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Лог omp-b');
    expect(dialog.querySelector('pre')?.textContent).toContain('beta');
    await act(async () => {
      pending[0].resolve({ ok: true, lines: 'alpha' });
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Лог omp-b');
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe('beta');
  });

  it('does not reopen a crash log closed while its request runs', async () => {
    const gate = deferred<string>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (pathOf(input).indexOf('/admin/api/crashes/log') >= 0) {
        return gate.promise.then((text) => ({ ok: true, text: async () => text }));
      }
      return Promise.resolve(
        jsonResponse({
          groups: [{ id: 'g1', status: 'progress', count: 2, devices: 1, versions: ['0.30.0'], firstAt: 1, lastAt: 2, title: 'Падение при старте', regression: false }],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(CrashesDesk, { csrf: 'tok' })));
    await settle();
    const logButton = Array.from(app.querySelectorAll('button')).find((b) => b.textContent === 'Лог')!;
    await act(async () => {
      logButton.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Сбой: Падение при старте');
    await act(async () => {
      closeButton().click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      gate.resolve('stack trace');
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not reopen the source check after close when a second reply lands', async () => {
    const pending: ((body: unknown) => void)[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (pathOf(input).indexOf('/admin/api/sources/check') >= 0) {
        const gate = deferred<unknown>();
        pending.push(gate.resolve);
        return gate.promise.then((body) => jsonResponse(body));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(createElement(SourcesDesk, { csrf: 'tok' }));
    const check = Array.from(app.querySelectorAll('button')).find((b) => b.textContent === 'Проверить сейчас')!;
    await act(async () => {
      check.click();
    });
    await act(async () => {
      check.click();
    });
    expect(pending.length).toBe(2);
    const health = [{ name: 'jackett', ok: true, latencyMs: 5 }];
    await act(async () => {
      pending[1]({ ok: true, health });
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Проверка источников');
    await act(async () => {
      closeButton().click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      pending[0]({ ok: true, health });
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('reports a failed copy when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(createElement(LogDialog, { title: 'Лог', text: 'строка', onClose: () => {} }));
    const copy = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Копировать')!;
    await act(async () => {
      copy.click();
    });
    expect(document.getElementById('toast')?.textContent).toBe('Не скопировалось');
  });
});
