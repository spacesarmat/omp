import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import { PreviewPane } from '../../editor/src/components/PreviewPane';
import type { EditorClient } from '../../editor/src/client';
import * as protocol from '../../editor/src/preview/protocol';
import * as fixtures from '../../desktop/src/preview/fixtures';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { lang } from '../../src/i18n';
import { platformKind } from '../../src/platform/env';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;
let client: EditorClient & { getDraft: ReturnType<typeof vi.fn> };
let sendMock: ReturnType<typeof vi.spyOn>;
let fixtureSpy: ReturnType<typeof vi.spyOn>;

function clientRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function select(testId: string, value: string): void {
  const input = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(testId: string): void {
  act(() => {
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickAction(action: string): void {
  act(() => {
    host.querySelector<HTMLElement>(`[data-action="${action}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => {
    (target as HTMLElement).dispatchEvent(event);
  });
}

function frame(viewId: string): HTMLIFrameElement {
  const element = host.querySelector<HTMLIFrameElement>(`[data-testid="compare-frame-${viewId}"]`);
  if (!element) throw new Error(`compare frame ${viewId} is missing`);
  return element;
}

function mainFrame(): HTMLIFrameElement {
  return host.querySelector<HTMLIFrameElement>('[data-testid="canvas-viewport"] iframe')!;
}

interface CapturedCommand {
  type?: string;
  sessionId?: string;
  props: Record<string, unknown>;
}

function initsFor(sessionId: string): CapturedCommand[] {
  const commands = sendMock.mock.calls.map((call: unknown[]) => call[1] as CapturedCommand);
  return commands.filter((command: CapturedCommand) => command.type === 'init' && command.sessionId === sessionId);
}

function lastInit(sessionId: string): CapturedCommand {
  const inits = initsFor(sessionId);
  return inits[inits.length - 1];
}

function buildFrameBody(iframe: HTMLIFrameElement): void {
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
  const grid = make('card-grid', 0, 0, 400, 300);
  grid.appendChild(make('server-card', 0, 0, 400, 100));
  grid.appendChild(make('server-card-2', 0, 100, 400, 100));
  body.appendChild(grid);
  act(() => {
    iframe.dispatchEvent(new Event('load'));
  });
}

function buildMainPreview(): void {
  buildFrameBody(mainFrame());
}

function openCompare(): void {
  click('compare-toggle');
  for (const viewId of ['desktop', 'phone', 'tv']) buildFrameBody(frame(viewId));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  client = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: vi.fn(async () => null),
    putDraft: async (draft) => draft,
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client,
  });
  sendMock = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
  fixtureSpy = vi.spyOn(fixtures, 'installPreviewFixture');
  act(() => render(h(App, { controller, client }), host));
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
});

describe('compare workspace', () => {
  it('opens desktop, phone and TV side by side with independent sessions and one frozen theme', () => {
    openCompare();

    expect(host.querySelector('[data-testid="compare-workspace"]')).not.toBeNull();
    const expectedTargets: Record<string, string> = {
      desktop: 'desktop-windows',
      phone: 'android-phone',
      tv: 'android-tv',
    };
    const names = [mainFrame().name, frame('desktop').name, frame('phone').name, frame('tv').name];
    expect(new Set(names).size).toBe(4);
    for (const [viewId, target] of Object.entries(expectedTargets)) {
      const iframe = frame(viewId);
      expect(iframe.dataset.target).toBe(target);
      const inits = initsFor(iframe.name);
      expect(inits.length).toBeGreaterThan(0);
      expect(inits[inits.length - 1].props.target).toBe(target);
      expect(inits[inits.length - 1].props.route).toBe('settings');
      expect(inits[inits.length - 1].props.theme).toEqual(controller.draft.theme);
    }
  });

  it('keeps target, format and language independent per compare view', () => {
    openCompare();

    select('compare-format-phone', 'portrait');
    select('compare-language-phone', 'en');

    expect(lastInit(frame('phone').name).props.format).toBe('portrait');
    expect(lastInit(frame('phone').name).props.language).toBe('en');
    expect(lastInit(frame('desktop').name).props.format).toBe('landscape');
    expect(lastInit(frame('desktop').name).props.language).toBe('ru');

    select('compare-target-desktop', 'desktop-macos');
    expect(lastInit(frame('desktop').name).props.target).toBe('desktop-macos');
    expect(lastInit(frame('phone').name).props.target).toBe('android-phone');
  });

  it('forces the landscape format when a compare view switches to a TV target', () => {
    openCompare();

    select('compare-format-phone', 'portrait');
    select('compare-target-phone', 'android-tv');

    const inits = initsFor(frame('phone').name);
    expect(inits[inits.length - 1].props.target).toBe('android-tv');
    expect(inits[inits.length - 1].props.format).toBe('landscape');
  });

  it('propagates the interactive design state to every compare view', () => {
    openCompare();

    select('design-state', 'hover');

    for (const viewId of ['desktop', 'phone', 'tv']) {
      expect(lastInit(frame(viewId).name).props.state).toBe('hover');
    }
  });

  it('syncs compare selection by data-layout-node across all views and the editor', () => {
    buildMainPreview();
    openCompare();
    const phone = frame('phone');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: phone.contentWindow,
        data: { type: 'element-selected', elementId: 'server-card', messageId: 'msg-1', sessionId: phone.name },
      }));
    });

    for (const viewId of ['desktop', 'phone', 'tv']) {
      const mark = host.querySelector<HTMLElement>(`[data-testid="compare-view-${viewId}"] [data-testid="compare-selection"]`);
      expect(mark).not.toBeNull();
      expect(mark!.dataset.layoutNode).toBe('server-card');
      expect(mark!.style.width).toBe('400px');
    }
    const box = host.querySelector<HTMLElement>('[data-testid="selection-box"]');
    expect(box).not.toBeNull();
    expect(box!.dataset.layoutNode).toBe('server-card');
  });

  it('does not change compare views when the main draft is edited', () => {
    openCompare();
    const phoneSession = frame('phone').name;
    const frozenTheme = structuredClone(lastInit(phoneSession).props.theme);
    const initCount = initsFor(phoneSession).length;

    act(() => {
      controller.upsertOverride({
        id: 'compare-edit-guard',
        scope: 'element',
        target: 'desktop-windows',
        screenId: 'settings',
        elementId: 'button',
        format: 'landscape',
        tokens: { '--omp-color-accent': '#123456' },
      });
    });

    expect(controller.draft.theme.overrides.some((entry) => entry.id === 'compare-edit-guard')).toBe(true);
    expect(initsFor(phoneSession).length).toBe(initCount);
    expect(lastInit(phoneSession).props.theme).toEqual(frozenTheme);
    expect(lastInit(frame('desktop').name).props.theme).toEqual(frozenTheme);
  });

  it('never reloads the shared draft and installs no page-level fixtures', () => {
    const previousFetch = window.fetch;
    const previousLang = lang.value;
    const previousPlatform = platformKind();
    openCompare();

    expect(client.getDraft).not.toHaveBeenCalled();
    expect(fixtureSpy).not.toHaveBeenCalled();

    act(() => render(null, host));

    expect(lang.value).toBe(previousLang);
    expect(platformKind()).toBe(previousPlatform);
    expect(window.fetch).toBe(previousFetch);
  });
});

describe('non-draft preview editing guard', () => {
  it('disables canvas editing while the base theme is shown', () => {
    buildMainPreview();
    click('before-after');

    expect(host.querySelector('[data-testid="canvas-readonly"]')).not.toBeNull();
    const surface = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
    expect(surface.dataset.active).toBe('false');

    const update = vi.spyOn(controller, 'update');
    pointer(surface, 'pointerdown', 200, 50);
    pointer(surface, 'pointermove', 500, 250);
    pointer(surface, 'pointerup', 500, 250);

    expect(update).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="selection-box"]')).toBeNull();
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
  });

  it('disables canvas editing while a comparison snapshot is shown', () => {
    buildMainPreview();
    clickAction('snapshot');
    const name = host.querySelector<HTMLInputElement>('[data-testid="snapshot-name"]')!;
    act(() => {
      name.value = 'before compare';
      name.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickAction('create-snapshot');
    clickAction('compare-snapshot');

    expect(host.querySelector('[data-testid="canvas-readonly"]')).not.toBeNull();
    const surface = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
    expect(surface.dataset.active).toBe('false');

    const update = vi.spyOn(controller, 'update');
    pointer(surface, 'pointerdown', 200, 50);
    pointer(surface, 'pointermove', 500, 250);
    pointer(surface, 'pointerup', 500, 250);

    expect(update).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="selection-box"]')).toBeNull();
  });

  it('keeps canvas editing enabled for the live draft theme', () => {
    buildMainPreview();

    expect(host.querySelector('[data-testid="canvas-readonly"]')).toBeNull();
    expect(host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!.dataset.active).toBe('true');
  });
});

describe('preview mutation collect', () => {
  it('collects layout rects with the current zoom after deferred mutations', async () => {
    const zoomHost = document.createElement('div');
    document.body.appendChild(zoomHost);
    const onNodesChange = vi.fn();
    const baseProps = {
      target: 'desktop-windows' as const,
      route: 'settings' as const,
      format: 'landscape' as const,
      language: 'ru' as const,
      mode: 'design' as const,
      serverConnected: false,
      state: 'default' as const,
      theme: controller.draft.theme,
      flow: controller.draft.flow,
      sessionId: 'zoom-session',
      tool: 'select' as const,
      selection: { ids: [], anchorId: null },
      onZoomChange: () => undefined,
      onTool: () => undefined,
      onSelect: () => undefined,
      onNavigate: () => undefined,
      onTrace: () => undefined,
      onNodesChange,
      onSelectNode: () => undefined,
      onMoveNode: () => undefined,
      onPlaceNode: () => undefined,
    };
    try {
      act(() => render(h(PreviewPane, { ...baseProps, zoom: 1 }), zoomHost));
      const iframe = zoomHost.querySelector<HTMLIFrameElement>('iframe')!;
      iframe.getBoundingClientRect = () => clientRect(0, 0, 1280, 720);
      const doc = iframe.contentDocument!;
      if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
      const body = doc.createElement('body');
      doc.documentElement.appendChild(body);
      const card = doc.createElement('div');
      card.dataset.designId = 'server-card';
      card.getBoundingClientRect = () => clientRect(100, 50, 400, 100);
      body.appendChild(card);
      act(() => {
        iframe.dispatchEvent(new Event('load'));
      });
      expect(onNodesChange.mock.calls[onNodesChange.mock.calls.length - 1][1]['server-card'].width).toBe(400);

      act(() => render(h(PreviewPane, { ...baseProps, zoom: 2 }), zoomHost));
      expect(onNodesChange.mock.calls[onNodesChange.mock.calls.length - 1][1]['server-card'].width).toBe(200);

      onNodesChange.mockClear();
      await act(async () => {
        body.appendChild(doc.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const rects = onNodesChange.mock.calls[onNodesChange.mock.calls.length - 1][1] as Record<string, { width: number }>;
      expect(rects['server-card'].width).toBe(200);
    } finally {
      act(() => render(null, zoomHost));
      zoomHost.remove();
    }
  });
});
