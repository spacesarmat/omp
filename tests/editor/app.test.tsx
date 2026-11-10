import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function select(testId: string, value: string): void {
  const input = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client: {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
    },
  });
  act(() => render(h(App, { controller }), host));
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
});

describe('editor app', () => {
  it('starts with Windows settings in Russian landscape and a token-free titled iframe', () => {
    expect(host.querySelector<HTMLSelectElement>('[data-testid="target"]')!.value).toBe('desktop-windows');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="route"]')!.value).toBe('settings');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="format"]')!.value).toBe('landscape');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="language"]')!.value).toBe('ru');
    const iframe = host.querySelector('iframe')!;
    expect(iframe.title).toBe('OMP preview');
    expect(iframe.getAttribute('src')).toBe('/preview.html');
    expect(iframe.src).not.toContain('token');
    expect(iframe.dataset.viewport).toBe('1280x720');
  });

  it('switches macOS and Linux without changing screen or language', () => {
    select('target', 'desktop-macos');
    expect(host.querySelector('iframe')!.dataset.target).toBe('desktop-macos');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="route"]')!.value).toBe('settings');
    select('target', 'desktop-linux');
    expect(host.querySelector('iframe')!.dataset.target).toBe('desktop-linux');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="language"]')!.value).toBe('ru');
  });

  it('uses portrait dimensions and remounts preview for English', () => {
    select('format', 'portrait');
    expect(host.querySelector('iframe')!.dataset.viewport).toBe('720x960');
    const russian = host.querySelector('iframe')!;
    select('language', 'en');
    const english = host.querySelector('iframe')!;
    expect(english).not.toBe(russian);
    expect(english.dataset.language).toBe('en');
  });

  it('sends a protocol navigation command for screen selection', () => {
    const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    const iframe = host.querySelector('iframe')!;
    iframe.dispatchEvent(new Event('load'));
    send.mockClear();
    select('route', 'library');
    expect(send).toHaveBeenCalled();
    const command = send.mock.calls[send.mock.calls.length - 1][1];
    expect(command).toMatchObject({ type: 'navigate', route: 'library' });
  });
});
