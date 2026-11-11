import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { getLayoutPlacement } from '../../design/layout';
import { parseThemeDocument } from '../../design/validation';
import type { LayoutContext } from '../../design/schema';
import { LayersPanel, type LayerRowModel } from '../../editor/src/components/LayersPanel';

const BASE = '0000000000000000000000000000000000000000';

describe('LayersPanel layer operations', () => {
  let host: HTMLDivElement;

  const rows: LayerRowModel[] = [
    { nodeId: 'server-card', label: 'Карточка сервера', hidden: false, locked: false },
    { nodeId: 'card-grid', label: 'Сетка карточек', hidden: true, locked: false },
    { nodeId: 'banner', label: 'Баннер', hidden: false, locked: true },
  ];

  function renderPanel(overrides: Partial<Parameters<typeof LayersPanel>[0]> = {}) {
    const handlers = {
      onSelect: () => undefined,
      onNavigate: () => undefined,
      onSelectNode: () => undefined,
      onRenameNode: () => undefined,
      onToggleHidden: () => undefined,
      onToggleLocked: () => undefined,
      onDuplicateNode: () => undefined,
      onCopySelection: () => undefined,
      onPaste: () => undefined,
    };
    act(() => render(h(LayersPanel, { selected: 'sidebar', route: 'settings', layers: rows, ...handlers, ...overrides }), host));
  }

  function row(nodeId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-testid="layout-row-${nodeId}"]`);
    if (!element) throw new Error(`row ${nodeId} is missing`);
    return element;
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  it('lists every layout node, including hidden and locked ones', () => {
    renderPanel();

    expect(host.querySelectorAll('[data-testid^="layout-row-"]')).toHaveLength(3);
    expect(row('card-grid').classList.contains('editor-layer-muted')).toBe(true);
    expect(row('banner').classList.contains('editor-layer-muted')).toBe(true);
  });

  it('keeps rendering the screen template layers and pages', () => {
    renderPanel();

    expect(host.querySelectorAll('[data-testid^="layer-"]')).toHaveLength(5);
    expect(host.querySelectorAll('[data-testid^="page-"]')).toHaveLength(6);
  });

  it('filters rows by search query and by the hidden and locked filters', () => {
    renderPanel();
    const search = host.querySelector<HTMLInputElement>('[data-testid="layout-search"]')!;

    act(() => {
      search.value = 'карточ';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('[data-testid^="layout-row-"]')).toHaveLength(2);

    const filter = host.querySelector<HTMLSelectElement>('[data-testid="layout-filter"]')!;
    act(() => {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      filter.value = 'hidden';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelectorAll('[data-testid^="layout-row-"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="layout-row-card-grid"]')).not.toBeNull();

    act(() => {
      filter.value = 'locked';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelectorAll('[data-testid^="layout-row-"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="layout-row-banner"]')).not.toBeNull();

    act(() => {
      filter.value = 'all';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelectorAll('[data-testid^="layout-row-"]')).toHaveLength(3);
  });

  it('selects a node row and reports hide, lock and duplicate actions', () => {
    const onSelectNode = vi.fn();
    const onToggleHidden = vi.fn();
    const onToggleLocked = vi.fn();
    const onDuplicateNode = vi.fn();
    renderPanel({ onSelectNode, onToggleHidden, onToggleLocked, onDuplicateNode });

    act(() => row('server-card').click());
    expect(onSelectNode).toHaveBeenCalledWith('server-card');
    renderPanel({ onSelectNode, onToggleHidden, onToggleLocked, onDuplicateNode, selectedNodeId: 'server-card' });
    expect(row('server-card').getAttribute('aria-pressed')).toBe('true');

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-hide-server-card"]')!.click());
    expect(onToggleHidden).toHaveBeenCalledWith('server-card', true);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-lock-banner"]')!.click());
    expect(onToggleLocked).toHaveBeenCalledWith('banner', false);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-duplicate-server-card"]')!.click());
    expect(onDuplicateNode).toHaveBeenCalledWith('server-card');
  });

  it('renames a node through the inline editor and commits on Enter', () => {
    const onRenameNode = vi.fn();
    renderPanel({ onRenameNode });

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-rename-server-card"]')!.click());
    const input = host.querySelector<HTMLInputElement>('[data-testid="layout-rename-input"]')!;
    expect(input.value).toBe('Карточка сервера');

    act(() => {
      input.value = '  Главная карточка  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onRenameNode).toHaveBeenCalledWith('server-card', '  Главная карточка  ');
    expect(host.querySelector('[data-testid="layout-rename-input"]')).toBeNull();
  });

  it('offers copy and paste actions and shows clipboard incompatibilities', () => {
    const onCopySelection = vi.fn();
    const onPaste = vi.fn();
    renderPanel({ onCopySelection, onPaste, clipboardError: 'Неподдерживаемая версия clipboard' });

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-copy"]')!.click());
    expect(onCopySelection).toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-paste"]')!.click());
    expect(onPaste).toHaveBeenCalled();
    expect(host.querySelector('.editor-layers-footer')!.textContent).toContain('Неподдерживаемая версия clipboard');
  });
});

describe('App layer operations', () => {
  let host: HTMLDivElement;
  let controller: DraftController;

  function clientRect(x: number, y: number, width: number, height: number): DOMRect {
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
  }

  function buildPreview(): void {
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    iframe.getBoundingClientRect = () => clientRect(0, 0, 1280, 720);
    const doc = iframe.contentDocument!;
    if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
    let body = doc.body;
    if (!body) {
      body = doc.createElement('body');
      doc.documentElement.appendChild(body);
    }
    body.innerHTML = '';
    const make = (designId: string, x: number, y: number, width: number, height: number): HTMLElement => {
      const element = doc.createElement('div');
      element.dataset.designId = designId;
      element.getBoundingClientRect = () => clientRect(x, y, width, height);
      return element;
    };
    const grid = make('card-grid', 0, 0, 400, 400);
    const first = make('server-card', 0, 0, 400, 100);
    const second = make('server-card', 0, 100, 400, 100);
    grid.append(first, second);
    body.appendChild(grid);
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
  }

  function pointer(target: HTMLElement, type: string, x: number, y: number): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  function overlay(): HTMLElement {
    return host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
  }

  function key(value: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }));
    });
  }

  function contextOf(): LayoutContext {
    return { target: controller.draft.target, screenId: controller.draft.screenId, format: controller.draft.format };
  }

  beforeEach(() => {
    window.localStorage.clear();
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
    vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => render(null, host));
    controller.dispose();
    host.remove();
    vi.restoreAllMocks();
  });

  it('hides a node from the panel so the canvas no longer selects or edits it, while the panel still does', () => {
    buildPreview();

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-hide-server-card"]')!.click());
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')?.hidden).toBe(true);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    expect(host.querySelector('[data-testid="selection-box"]')).toBeNull();

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-row-server-card"]')!.click());
    const box = host.querySelector<HTMLElement>('[data-testid="selection-box"]');
    expect(box).not.toBeNull();
    expect(box!.dataset.layoutNode).toBe('server-card');

    const update = vi.spyOn(controller, 'update');
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointermove', 600, 300);
    pointer(overlay(), 'pointerup', 600, 300);
    expect(update).not.toHaveBeenCalled();
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')).toMatchObject({ mode: 'flow', hidden: true });

    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')).toBeUndefined();
  });

  it('keeps a hidden node out of group align and group margin edits', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    const toggle = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 200, clientY: 150, button: 0, shiftKey: true });
    Object.defineProperty(toggle, 'pointerId', { value: 7 });
    act(() => {
      overlay().dispatchEvent(toggle);
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-hide-server-card"]')!.click());
    expect(host.querySelector('[data-testid="multi-select-inspector"]')).not.toBeNull();

    const update = vi.spyOn(controller, 'update');
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-left"]')!.click());
    expect(update).not.toHaveBeenCalled();

    act(() => {
      const margin = host.querySelector<HTMLInputElement>('[data-testid="multi-margin"]')!;
      margin.value = '12';
      margin.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const hiddenPlacement = getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card');
    expect(hiddenPlacement).toMatchObject({ hidden: true });
    expect(hiddenPlacement?.margin).toBeUndefined();
  });

  it('blocks canvas edits for a locked node until it is unlocked', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    expect(host.querySelector<HTMLElement>('[data-testid="selection-box"]')!.dataset.layoutNode).toBe('server-card');

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-lock-server-card"]')!.click());
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')?.locked).toBe(true);

    const update = vi.spyOn(controller, 'update');
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointermove', 600, 300);
    pointer(overlay(), 'pointerup', 600, 300);
    expect(update).not.toHaveBeenCalled();
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')?.mode ?? 'flow').toBe('flow');

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-lock-server-card"]')!.click());
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')?.locked).toBe(false);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointermove', 600, 300);
    pointer(overlay(), 'pointerup', 600, 300);
    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card')?.mode).toBe('absolute');
  });

  it('duplicates a node with a new id, a sanitized html snapshot and a panel-selected copy', () => {
    buildPreview();

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-duplicate-server-card"]')!.click());

    const layout = controller.draft.theme.layout!;
    const placement = layout.placements.find((entry) => entry.nodeId !== 'server-card');
    expect(placement).toBeDefined();
    expect(placement!.nodeId).toMatch(/^copy-/);
    expect(host.querySelector(`[data-testid="layout-row-${placement!.nodeId}"]`)!.getAttribute('aria-pressed')).toBe('true');

    const clone = layout.clones!.find((entry) => entry.nodeId === placement!.nodeId)!;
    expect(clone).toMatchObject({ parentId: 'card-grid', sourceNodeId: 'server-card' });
    expect(clone.html).toContain('data-design-id="server-card"');
    expect(clone.html).not.toContain('<script');
    expect(() => parseThemeDocument(controller.draft.theme)).not.toThrow();

    act(() => host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click());
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    expect(controller.draft.theme.layout?.clones ?? []).toHaveLength(0);
  });

  it('copies a node and pastes it with a visible clone into another page that has no original', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);

    key('c', { ctrlKey: true });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="page-news"]')!.click());
    key('v', { ctrlKey: true });

    const context = contextOf();
    expect(context.screenId).toBe('news');
    const layout = controller.draft.theme.layout!;
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0].nodeId).not.toBe('server-card');
    expect(layout.placements[0].nodeId).toMatch(/^copy-/);
    expect(layout.placements[0]).toMatchObject({ label: 'server-card', screenId: 'news' });

    const clone = layout.clones!.find((entry) => entry.nodeId === layout.placements[0].nodeId)!;
    expect(clone).toMatchObject({ parentId: 'path-root', screenId: 'news' });
    expect(clone.html).toContain('data-design-id="server-card"');
    expect(clone.html).not.toContain('data-key');
    expect(() => parseThemeDocument(controller.draft.theme)).not.toThrow();

    controller.undo();
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    expect(controller.draft.theme.layout?.clones ?? []).toHaveLength(0);
  });

  it('shows a clipboard incompatibility instead of saving when the stored clipboard is invalid', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    key('c', { ctrlKey: true });
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);

    window.localStorage.setItem('omp.editor.layoutClipboard', JSON.stringify({ schemaVersion: 2, nodes: [] }));
    key('v', { ctrlKey: true });

    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    expect(host.querySelector('.editor-layers-footer')!.textContent).toContain('версия');
  });

  it('pastes nothing and shows no error when the clipboard is empty', () => {
    buildPreview();

    key('v', { ctrlKey: true });

    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    expect(host.querySelector('.editor-layers-footer')!.textContent).toContain('Синхронизировано');
  });
});
