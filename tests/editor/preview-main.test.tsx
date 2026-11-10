import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';

vi.mock('../../desktop/src/preview/DesktopPreview', () => ({ DesktopPreview: () => null }));

const BASE = '0000000000000000000000000000000000000000';

function initCommand(sessionId: string) {
  return {
    type: 'init',
    messageId: `message-${sessionId}`,
    sessionId,
    props: {
      target: 'desktop-windows',
      route: 'settings',
      format: 'landscape',
      language: 'ru',
      mode: 'design',
      serverConnected: false,
      theme: createDefaultTheme(BASE),
      flow: createDefaultFlow(BASE),
    },
  };
}

describe('preview entry lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one ready response per init instead of accumulating listeners', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    await act(async () => {
      await import('../../editor/src/preview/main');
    });
    const send = (sessionId: string) => window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: initCommand(sessionId),
    }));
    act(() => {
      send('session-one');
    });
    await act(async () => {
      await Promise.resolve();
    });
    post.mockClear();
    act(() => {
      send('session-two');
    });
    await act(async () => {
      await Promise.resolve();
    });
    const ready = post.mock.calls.filter(([message]) => (message as { type?: string }).type === 'ready');
    expect(ready).toHaveLength(1);
  });
});
