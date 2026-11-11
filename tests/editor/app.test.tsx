import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { LayersPanel } from '../../editor/src/components/LayersPanel';

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
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    },
  });
  act(() => render(h(App, { controller }), host));
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('switches platform with a valid route, viewport and platform-specific layers', () => {
    select('route', 'news');
    select('format', 'portrait');
    const desktop = host.querySelector('iframe')!;
    select('target', 'android-tv');

    expect(controller.draft.target).toBe('android-tv');
    expect(controller.draft.screenId).toBe('settings');
    expect(controller.draft.format).toBe('landscape');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="format"]')!.value).toBe('landscape');
    expect(host.querySelector('.editor-canvas-caption small')!.textContent).toBe('1920 × 1080');
    expect(host.querySelector('iframe')!.dataset.viewport).toBe('1920x1080');
    expect(host.querySelector('iframe')!).not.toBe(desktop);
    expect(host.querySelector<HTMLSelectElement>('[data-testid="format"]')!.disabled).toBe(true);
    expect(host.querySelectorAll('[data-testid^="page-"]')).toHaveLength(4);
    expect(host.querySelectorAll('[data-testid^="layer-"]')).toHaveLength(5);
    expect(host.querySelector('[data-testid="layer-legacy-page"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="layer-sidebar"]')).toBeNull();

    select('target', 'android-phone');
    expect(host.querySelectorAll('[data-testid^="page-"]')).toHaveLength(6);
    select('format', 'portrait');
    expect(host.querySelector('iframe')!.dataset.viewport).toBe('720x960');
  });

  it('shares the selected design state with preview and resets it on navigation', () => {
    const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    select('design-state', 'hover');
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    expect(iframe.dataset.state).toBe('hover');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: { type: 'ready', messageId: 'state-ready', sessionId: iframe.name },
      }));
    });
    expect(send.mock.calls[0][1]).toMatchObject({ type: 'init', props: { state: 'hover' } });

    select('route', 'library');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="design-state"]')!.value).toBe('default');
    expect(host.querySelector('iframe')!.dataset.state).toBe('default');
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

  it('sends initial configuration only after the preview ready handshake', () => {
    const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    expect(send).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: { type: 'ready', messageId: 'ready-1', sessionId: iframe.name },
      }));
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ type: 'init', props: { target: 'desktop-windows' } });
  });

  it('compares a snapshot with the current theme and returns to it', () => {
    const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    const snapshot = controller.snapshot('Before blue');
    controller.upsertOverride({ id: 'current-blue', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-panel': '#112233' } });
    act(() => host.querySelector<HTMLButtonElement>('[data-action="snapshot"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-action="compare-snapshot"]')!.click());
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: { type: 'ready', messageId: 'compare-ready', sessionId: iframe.name },
      }));
    });
    expect(send.mock.calls[0][1]).toMatchObject({ type: 'init', props: { theme: snapshot.theme } });

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="before-after"]')!.click());
    expect(send.mock.calls[send.mock.calls.length - 1][1]).toMatchObject({ type: 'init', props: { theme: controller.draft.theme } });
  });

  it('exits comparison when the compared snapshot is deleted', () => {
    controller.snapshot('Before blue');
    act(() => host.querySelector<HTMLButtonElement>('[data-action="snapshot"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-action="compare-snapshot"]')!.click());
    expect(host.querySelector('[data-testid="before-after"]')!.textContent).toBe('Текущий');

    act(() => host.querySelector<HTMLButtonElement>('[data-action="delete-snapshot"]')!.click());

    expect(controller.draft.snapshots).toHaveLength(0);
    expect(host.querySelector('[data-testid="before-after"]')!.textContent).toBe('До');
  });

  it('shows a failed save and retries it successfully', async () => {
    let attempts = 0;
    controller = createDraftController({
      draft: createDefaultDraft('draft-1', BASE),
      client: {
        state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
        getDraft: async () => null,
        putDraft: async (draft) => {
          attempts += 1;
          if (attempts === 1) throw new Error('offline');
          return draft;
        },
        getDesign: async () => null,
        rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
        exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      },
    });
    act(() => render(h(App, { controller }), host));
    await act(async () => {
      await expect(controller.flush()).rejects.toThrow('offline');
    });
    expect(controller.lastError).toBe('offline');
    expect(controller.draft.lastError).toBe('offline');
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain('offline');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="retry-save"]')!.click();
      await Promise.resolve();
    });
    expect(attempts).toBe(2);
    expect(host.textContent).not.toContain('offline');
  });

  it('shows selectable design layers and opens the chosen element in the inspector', () => {
    const panel = host.querySelector('[aria-label="Слои"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll('[data-testid^="layer-"]')).toHaveLength(5);
    expect(host.querySelectorAll('[role="toolbar"]').length).toBeGreaterThan(0);

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="layer-content"]')!.click();
    });

    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Контент');
    expect(host.querySelector('[data-testid="layer-content"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('maps a selected navigation item to its shared design layer', () => {
    act(() => render(h(LayersPanel, { selected: 'nav-library', route: 'settings', onSelect: () => undefined, onNavigate: () => undefined }), host));

    expect(host.querySelector('[data-testid="layer-sidebar-item"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the legacy page template on a legacy screen', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-library"]')!.click());
    const layer = host.querySelector<HTMLButtonElement>('[data-testid="layer-legacy-page"]')!;
    expect(host.querySelector('[data-testid="layer-settings-continue"]')).toBeNull();
    act(() => layer.click());

    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Шаблон страницы');
    expect(layer.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens an internal component template on phone', () => {
    select('target', 'android-phone');
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layer-button"]')!.click());

    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Кнопка');
    expect(host.querySelector('[data-testid="layer-button"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('lists every desktop page and opens connect with a valid selection', () => {
    expect(host.querySelectorAll('[data-testid^="page-"]')).toHaveLength(6);
    expect(host.querySelector('[data-testid="route"] option[value="connect"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layer-settings-continue"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-connect"]')!.click());

    expect(controller.draft.screenId).toBe('connect');
    expect(host.querySelector('iframe')!.dataset.route).toBe('connect');
    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Контент');
  });

  it('returns to design when leaving settings logic for a theme-only page', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="mode-logic"]')!.click());
    expect(host.querySelector('[data-testid="mode-logic"]')!.getAttribute('aria-pressed')).toBe('true');

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-library"]')!.click());

    expect(controller.draft.screenId).toBe('library');
    expect(host.querySelector('[data-testid="mode-design"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="mode-logic"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the selected template valid when undo changes the page', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-library"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-settings"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layer-server-card"]')!.click());
    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Карточка сервера');

    act(() => host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click());

    expect(controller.draft.screenId).toBe('library');
    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Контент');
  });

  it('fits the artboard to the canvas and keeps the iframe at its native dimensions', () => {
    act(() => render(null, host));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const size = this.dataset.testid === 'canvas-viewport' ? { width: 736, height: 456 } : { width: 0, height: 0 };
      return { ...size, x: 0, y: 0, top: 0, right: size.width, bottom: size.height, left: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    });

    act(() => render(h(App, { controller }), host));

    expect(host.querySelector<HTMLElement>('[data-testid="artboard-size"]')!.style.width).toBe('640px');
    expect(host.querySelector<HTMLElement>('[data-testid="artboard-size"]')!.style.height).toBe('360px');
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('50%');
    expect(host.querySelector('iframe')!.getAttribute('width')).toBe('1280');
    expect(host.querySelector('iframe')!.getAttribute('height')).toBe('720');

    act(() => host.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click());
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('63%');
    act(() => host.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!.click());
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('50%');
    act(() => host.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-action="zoom-fit"]')!.click());
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('50%');
  });

  it('supports canvas and history shortcuts without intercepting form input', () => {
    const key = (value: string, options: KeyboardEventInit = {}) => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }));
      });
    };
    key('h');
    expect(host.querySelector('[data-testid="tool-hand"]')!.getAttribute('aria-pressed')).toBe('true');
    key('v');
    expect(host.querySelector('[data-testid="tool-select"]')!.getAttribute('aria-pressed')).toBe('true');
    key('=', { ctrlKey: true });
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('125%');
    key('-', { ctrlKey: true });
    key('0', { ctrlKey: true });
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('100%');

    act(() => controller.upsertOverride({ id: 'shortcut-test', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-panel': '#112233' } }));
    key('z', { ctrlKey: true });
    expect(controller.draft.theme.overrides).toHaveLength(0);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(controller.draft.theme.overrides).toHaveLength(1);

    const input = host.querySelector<HTMLInputElement>('[data-testid="release-version"]')!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(host.querySelector('[data-testid="tool-select"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(controller.draft.theme.overrides).toHaveLength(1);
  });

  it('handles editor shortcuts from the focused preview document', () => {
    vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
    const previewDocument = iframe.contentDocument;
    expect(previewDocument).not.toBeNull();
    act(() => controller.upsertOverride({ id: 'iframe-shortcut', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-panel': '#112233' } }));

    act(() => {
      previewDocument!.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    expect(host.querySelector('[data-testid="tool-hand"]')!.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      previewDocument!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(controller.draft.theme.overrides).toHaveLength(0);
  });

  it('does not handle editor shortcuts from editable fields inside the preview', () => {
    vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    act(() => { iframe.dispatchEvent(new Event('load')); });
    const previewDocument = iframe.contentDocument!;
    const input = previewDocument.createElement('input');
    const root = previewDocument.createElement('html');
    previewDocument.appendChild(root);
    root.appendChild(input);
    expect(input instanceof HTMLElement).toBe(false);
    act(() => controller.upsertOverride({ id: 'preview-input', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-panel': '#112233' } }));

    act(() => {
      input.dispatchEvent(new previewDocument.defaultView!.KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      input.dispatchEvent(new previewDocument.defaultView!.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });

    expect(host.querySelector('[data-testid="tool-select"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(controller.draft.theme.overrides).toHaveLength(1);
  });

  it('refits the canvas and keyboard fit shortcut when the platform changes', () => {
    act(() => render(null, host));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const size = this.dataset.testid === 'canvas-viewport' ? { width: 1032, height: 636 } : { width: 0, height: 0 };
      return { ...size, x: 0, y: 0, top: 0, right: size.width, bottom: size.height, left: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    });
    act(() => render(h(App, { controller }), host));
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('73%');

    select('target', 'android-tv');
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('49%');
    act(() => host.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }));
    });
    expect(host.querySelector('[data-testid="zoom-value"]')!.textContent).toBe('49%');
  });

  it('pans the canvas with the hand tool', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="tool-hand"]')!.click());
    const viewport = host.querySelector<HTMLElement>('[data-testid="canvas-viewport"]')!;
    viewport.scrollLeft = 100;
    viewport.scrollTop = 80;
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      act(() => {
        viewport.dispatchEvent(event);
      });
    };
    pointer('pointerdown', 300, 300);
    pointer('pointermove', 250, 260);
    pointer('pointerup', 250, 260);

    expect(viewport.scrollLeft).toBe(150);
    expect(viewport.scrollTop).toBe(120);
  });

  it('warns before closing while the latest edits are still saving', async () => {
    const saved: Array<ReturnType<typeof createDefaultDraft>> = [];
    controller = createDraftController({
      draft: createDefaultDraft('draft-1', BASE),
      client: {
        state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
        getDraft: async () => null,
        putDraft: async (draft) => {
          saved.push(draft);
          await new Promise((resolve) => setTimeout(resolve, 0));
          return draft;
        },
        getDesign: async () => null,
        rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
        exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      },
    });
    act(() => render(h(App, { controller }), host));
    controller.upsertOverride({ id: 'latest', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
    const first = controller.flush();
    const event = new Event('beforeunload', { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      await first;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved).toHaveLength(2);
    expect(controller.hasUnsavedChanges()).toBe(false);
  });

  it('recovers from a save conflict with a separate draft', async () => {
    const saved = new Set<string>();
    controller = createDraftController({
      draft: createDefaultDraft('draft-1', BASE),
      client: {
        state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
        getDraft: async () => null,
        putDraft: async (draft) => {
          if (draft.id === 'draft-1') throw new Error('DRAFT_CONFLICT');
          saved.add(draft.id);
          return { ...draft, revision: 1 };
        },
        getDesign: async () => null,
        rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
        exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      },
    });
    act(() => render(h(App, { controller }), host));
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
    await act(async () => {
      await expect(controller.flush()).rejects.toThrow('DRAFT_CONFLICT');
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="save-copy"]')!.click();
      await Promise.resolve();
    });
    expect(saved.has(controller.draft.id)).toBe(true);
    expect(controller.draft.id).not.toBe('draft-1');
    expect(controller.lastError).toBeNull();
    expect(controller.draft.theme.overrides.map((entry) => entry.id)).toEqual(['local']);
  });

  it('does not save an unchanged draft when the page closes', () => {
    let saves = 0;
    controller = createDraftController({
      draft: createDefaultDraft('draft-1', BASE),
      client: {
        state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
        getDraft: async () => null,
        putDraft: async (draft) => {
          saves += 1;
          return draft;
        },
        getDesign: async () => null,
        rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
        exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      },
    });
    act(() => render(h(App, { controller }), host));
    const event = new Event('beforeunload', { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(saves).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a failed save while the page is closing', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      controller = createDraftController({
        draft: createDefaultDraft('draft-1', BASE),
        client: {
          state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
          getDraft: async () => null,
          putDraft: async () => { throw new Error('offline'); },
          getDesign: async () => null,
          rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
          exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
        },
      });
      act(() => render(h(App, { controller }), host));
      controller.upsertOverride({ id: 'closing', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
      act(() => { window.dispatchEvent(new Event('beforeunload')); });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(controller.lastError).toBe('offline');
      expect(host.textContent).toContain('offline');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
