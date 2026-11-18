/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveProvider } from '../admin/src/lib/live.tsx';
import { createMemoryAdmin } from '../admin/src/router.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

class FakeEventSource {
  close() {}
  addEventListener() {}
}

function renderAt(entry: string) {
  const { history, element } = createMemoryAdmin(entry);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(createElement(QueryClientProvider, { client, children: createElement(LiveProvider, { children: element }) }));
  });
  return { history };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = createRoot(document.getElementById('app')!);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : '') },
      json: async () => ({ auth: true, role: 'full' }),
    })),
  );
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('admin router', () => {
  it('moves a legacy tab query onto the section path and keeps the other query', async () => {
    const { history } = renderAt('/admin/?tab=finance&tg=9');
    await settle();
    expect(history.location.href).toContain('/admin/finance');
    expect(history.location.href).toContain('tg=9');
    expect(history.location.href).not.toContain('tab=');
  });

  it('opens a section from the menu without doubling the /admin prefix', async () => {
    const { history } = renderAt('/admin/finance');
    await settle();
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Донаты');
    expect(button).toBeTruthy();
    act(() => button!.click());
    await settle();
    expect(history.location.href).toContain('/admin/donations');
    expect(history.location.href).not.toContain('/admin/admin');
  });
});
