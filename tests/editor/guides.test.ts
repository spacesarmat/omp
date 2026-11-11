import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import { SelectionOverlay } from '../../editor/src/components/SelectionOverlay';
import { Rulers } from '../../editor/src/components/Rulers';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import {
  DEFAULT_GUIDE_SETTINGS,
  GRID_SIZE,
  SNAP_THRESHOLD_PX,
  TV_SAFE_AREA_RATIO,
  artboardToScreen,
  collectGuides,
  findSnap,
  getSafeArea,
  resolveGuideSettings,
  snapToGrid,
  type GuideLine,
  type Rect,
} from '../../editor/src/layout/guides';
import { absolutePlacementFromRect, placeNodeTransaction } from '../../editor/src/layout/transactions';
import { getLayoutPlacement } from '../../design/layout';
import type { LayoutContext } from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';

function line(axis: 'x' | 'y', position: number, kind: GuideLine['kind'] = 'node'): GuideLine {
  return { axis, position, kind };
}

describe('guides', () => {
  it('exposes the default editor grid and snap settings', () => {
    expect(GRID_SIZE).toBe(8);
    expect(SNAP_THRESHOLD_PX).toBe(6);
    expect(DEFAULT_GUIDE_SETTINGS).toEqual({
      gridSize: 8,
      snapThreshold: 6,
      snapToGrid: false,
      snapToGuides: true,
      showGrid: false,
      showRulers: true,
    });
    expect(resolveGuideSettings({ snapToGrid: true })).toMatchObject({ gridSize: 8, snapToGrid: true, showRulers: true });
  });

  it('computes the TV safe area as a 5 percent inset of the viewport', () => {
    expect(getSafeArea('lg-webos', { width: 1920, height: 1080 })).toEqual({ x: 96, y: 54, width: 1728, height: 972 });
    expect(getSafeArea('android-tv', { width: 1920, height: 1080 })).toEqual({ x: 96, y: 54, width: 1728, height: 972 });
  });

  it('keeps the identical relative TV safe area geometry at 4K', () => {
    const hd = getSafeArea('lg-webos', { width: 1920, height: 1080 });
    const uhd = getSafeArea('lg-webos', { width: 3840, height: 2160 });
    expect(uhd).toEqual({ x: 192, y: 108, width: 3456, height: 1944 });
    const viewports = [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
    [hd, uhd].forEach((area, index) => {
      const viewport = viewports[index];
      expect(area.x / viewport.width).toBeCloseTo(TV_SAFE_AREA_RATIO);
      expect(area.y / viewport.height).toBeCloseTo(TV_SAFE_AREA_RATIO);
      expect(area.width / viewport.width).toBeCloseTo(1 - TV_SAFE_AREA_RATIO * 2);
      expect(area.height / viewport.height).toBeCloseTo(1 - TV_SAFE_AREA_RATIO * 2);
    });
  });

  it('uses the full viewport as the safe area for non-TV targets', () => {
    expect(getSafeArea('desktop-windows', { width: 1280, height: 720 })).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(getSafeArea('android-phone', { width: 720, height: 960 })).toEqual({ x: 0, y: 0, width: 720, height: 960 });
  });

  it('collects edge and center guides for every rect', () => {
    expect(collectGuides([{ x: 10, y: 20, width: 100, height: 60 }])).toEqual([
      line('x', 10), line('x', 60), line('x', 110),
      line('y', 20), line('y', 50), line('y', 80),
    ]);
  });

  it('adds safe area and artboard guides with their own kinds', () => {
    const guides = collectGuides([], {
      safeArea: { x: 96, y: 54, width: 1728, height: 972 },
      artboard: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    expect(guides).toContainEqual(line('x', 96, 'safe-area'));
    expect(guides).toContainEqual(line('x', 960, 'safe-area'));
    expect(guides).toContainEqual(line('x', 1824, 'safe-area'));
    expect(guides).toContainEqual(line('y', 54, 'safe-area'));
    expect(guides).toContainEqual(line('y', 1026, 'safe-area'));
    expect(guides).toContainEqual(line('x', 0, 'artboard'));
    expect(guides).toContainEqual(line('x', 1920, 'artboard'));
    expect(guides).toContainEqual(line('y', 540, 'artboard'));
    expect(guides.every((guide) => guide.kind !== 'node')).toBe(true);
  });

  it('snaps moving edges and centers to guide lines', () => {
    const guides = [line('x', 0, 'artboard'), line('y', 10)];
    const result = findSnap({ x: 4, y: 8 }, [{ x: 4, y: 8, width: 40, height: 30 }], guides, SNAP_THRESHOLD_PX);
    expect(result.x).toBe(0);
    expect(result.y).toBe(10);
    expect(result.lines).toEqual([line('x', 0, 'artboard'), line('y', 10)]);
  });

  it('snaps a moving center to a center guide within the threshold', () => {
    const guides = [line('x', 26)];
    const result = findSnap({ x: 6, y: 0 }, [{ x: 6, y: 0, width: 36, height: 20 }], guides, SNAP_THRESHOLD_PX);
    expect(result.x).toBe(8);
    expect(result.y).toBeNull();
    expect(result.lines).toEqual([line('x', 26)]);
  });

  it('snaps at the exact threshold and ignores candidates one pixel beyond it', () => {
    const at = findSnap({ x: 6, y: 0 }, [{ x: 6, y: 0, width: 40, height: 20 }], [line('x', 0, 'artboard')], SNAP_THRESHOLD_PX);
    expect(at.x).toBe(0);
    const beyond = findSnap({ x: 7, y: 0 }, [{ x: 7, y: 0, width: 40, height: 20 }], [line('x', 0, 'artboard')], SNAP_THRESHOLD_PX);
    expect(beyond.x).toBeNull();
    expect(beyond.lines).toEqual([]);
  });

  it('prefers the nearest guide when several are inside the threshold', () => {
    const guides = [line('x', 17), line('x', 20)];
    const result = findSnap({ x: 18, y: 0 }, [{ x: 18, y: 0, width: 40, height: 20 }], guides, SNAP_THRESHOLD_PX);
    expect(result.x).toBe(17);
  });

  it('snaps any of the moving rects, not only the first one', () => {
    const guides = [line('x', 57)];
    const moving: Rect[] = [{ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 0, width: 10, height: 10 }];
    const result = findSnap({ x: 0, y: 0 }, moving, guides, SNAP_THRESHOLD_PX);
    expect(result.x).toBe(2);
    expect(result.lines).toEqual([line('x', 57)]);
  });

  it('rounds positions to the 8px grid step', () => {
    expect(snapToGrid(13)).toBe(16);
    expect(snapToGrid(11)).toBe(8);
    expect(snapToGrid(12)).toBe(16);
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(37, GRID_SIZE)).toBe(40);
    expect(snapToGrid(5, 0)).toBe(5);
  });

  it('maps snapped artboard guides to screen proportionally at any zoom', () => {
    const guides = [line('x', 400)];
    const moving: Rect[] = [{ x: 403, y: 0, width: 40, height: 20 }];
    const snap = findSnap({ x: 403, y: 0 }, moving, guides, SNAP_THRESHOLD_PX);
    expect(snap.x).toBe(400);
    for (const zoom of [0.5, 1, 2]) {
      expect(artboardToScreen({ x: snap.x!, y: 0 }, zoom).x).toBe(400 * zoom);
    }
    expect(artboardToScreen({ x: 100, y: 50 }, 0).x).toBe(100);
  });
});

describe('rulers', () => {
  it('renders top and left rulers with ticks mapped through zoom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { render(h(Rulers, { viewport: { width: 1280, height: 720 }, zoom: 1 }), host); });

    const horizontal = host.querySelector<HTMLElement>('[data-testid="ruler-x"]')!;
    const vertical = host.querySelector<HTMLElement>('[data-testid="ruler-y"]')!;
    expect(horizontal.style.width).toBe('1280px');
    expect(horizontal.style.height).toBe('28px');
    expect(vertical.style.height).toBe('720px');
    expect(vertical.style.width).toBe('28px');
    const ticks = [...host.querySelectorAll<HTMLElement>('[data-testid="ruler-tick"]')];
    expect(ticks.length).toBe(13 + 8);
    const tick600 = ticks.find((tick) => tick.dataset.value === '600')!;
    expect(tick600.style.left).toBe('600px');
    expect(tick600.textContent).toBe('600');

    act(() => { render(h(Rulers, { viewport: { width: 1280, height: 720 }, zoom: 2 }), host); });
    const zoomed = host.querySelector<HTMLElement>('[data-testid="ruler-x"]')!;
    expect(zoomed.style.width).toBe('2560px');
    expect(zoomed.style.height).toBe('28px');
    const zoomedTick = [...host.querySelectorAll<HTMLElement>('[data-testid="ruler-tick"]')].find((tick) => tick.dataset.value === '600')!;
    expect(zoomedTick.style.left).toBe('1200px');
    expect(zoomedTick.textContent).toBe('600');

    act(() => { render(null, host); });
    host.remove();
  });
});

describe('selection overlay guides', () => {
  it('renders the TV safe area with identical relative geometry on the artboard', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const context: LayoutContext = { target: 'lg-webos', screenId: 'menu', format: 'landscape' };
    const props = {
      active: true,
      viewport: { width: 1920, height: 1080 },
      zoom: 1,
      context,
      nodes: [],
      rects: {},
      containers: [],
      placements: [],
      selectedIds: [],
      anchorId: null,
      getIframeRect: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      onSelect: () => undefined,
      onMoveNode: () => undefined,
      onPlaceNode: () => undefined,
    };
    act(() => { render(h(SelectionOverlay, props), host); });
    const area = host.querySelector<HTMLElement>('[data-testid="safe-area"]')!;
    expect(area.style.left).toBe('96px');
    expect(area.style.top).toBe('54px');
    expect(area.style.width).toBe('1728px');
    expect(area.style.height).toBe('972px');
    act(() => { render(null, host); });
    host.remove();
  });

  it('hides the safe area frame for non-TV targets', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const props = {
      active: true,
      viewport: { width: 1280, height: 720 },
      zoom: 1,
      context: { target: 'desktop-windows', screenId: 'settings', format: 'landscape' },
      nodes: [],
      rects: {},
      containers: [],
      placements: [],
      selectedIds: [],
      anchorId: null,
      getIframeRect: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
      onSelect: () => undefined,
      onMoveNode: () => undefined,
      onPlaceNode: () => undefined,
    };
    act(() => { render(h(SelectionOverlay, props), host); });
    expect(host.querySelector('[data-testid="safe-area"]')).toBeNull();
    act(() => { render(null, host); });
    host.remove();
  });

  it('keeps guide lines one screen pixel wide at any zoom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const nodes = [
      { nodeId: 'card-a', elementId: 'card-a', parentId: 'root', label: 'A', kind: 'element' as const },
      { nodeId: 'card-b', elementId: 'card-b', parentId: 'root', label: 'B', kind: 'element' as const },
    ];
    const rects = {
      'card-a': { x: 0, y: 100, width: 400, height: 100 },
      'card-b': { x: 0, y: 400, width: 400, height: 100 },
    };
    const placed: { rect: Rect }[] = [];
    const props = {
      active: true,
      viewport: { width: 1280, height: 720 },
      zoom: 2,
      context: { target: 'desktop-windows', screenId: 'settings', format: 'landscape' },
      nodes,
      rects,
      containers: [],
      placements: [],
      selectedIds: ['card-a'],
      anchorId: 'card-a',
      getIframeRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      onSelect: () => undefined,
      onMoveNode: () => undefined,
      onPlaceNode: (placement: { x: number; y: number }) => {
        placed.push({ rect: { x: placement.x, y: placement.y, width: 0, height: 0 } });
      },
    };
    act(() => { render(h(SelectionOverlay, props), host); });
    const surface = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
    const event = (type: string, x: number, y: number): MouseEvent => {
      const pointerEvent = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(pointerEvent, 'pointerId', { value: 7 });
      return pointerEvent;
    };
    // zoom 2: client coordinates are twice the artboard ones
    act(() => { surface.dispatchEvent(event('pointerdown', 400, 300)); });
    act(() => { surface.dispatchEvent(event('pointermove', 412, 300)); });
    const guides = [...host.querySelectorAll<HTMLElement>('[data-testid="guide-line"]')];
    expect(guides.length).toBe(1);
    expect(guides[0].dataset.axis).toBe('x');
    expect(guides[0].style.left).toBe('0px');
    expect(guides[0].style.width).toBe('0.5px');
    act(() => { surface.dispatchEvent(event('pointerup', 412, 300)); });
    expect(placed.length).toBe(1);
    expect(placed[0].rect.x).toBe(0);
    act(() => { render(null, host); });
    host.remove();
  });
});

describe('layout snapping', () => {
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
    grid.append(make('server-card', 0, 0, 400, 100), make('server-card-2', 0, 100, 400, 100));
    body.appendChild(grid);
    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });
  }

  function overlay(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]');
    if (!element) throw new Error('selection overlay is missing');
    return element;
  }

  function pointer(target: HTMLElement, type: string, x: number, y: number, altKey = false): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, altKey });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  function contextOf(): LayoutContext {
    return { target: controller.draft.target, screenId: controller.draft.screenId, format: controller.draft.format };
  }

  function placeSecondCard(): void {
    const context = contextOf();
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 0, y: 100, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card-2',
      'server-card',
    ));
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
    vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => render(null, host));
    controller.dispose();
    host.remove();
    vi.restoreAllMocks();
  });

  it('snaps a dragged node to a sibling edge and highlights the guide lines', () => {
    buildPreview();
    placeSecondCard();

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 200, 446);
    const guides = [...host.querySelectorAll<HTMLElement>('[data-testid="guide-line"]')];
    expect(guides.length).toBe(2);
    const vertical = guides.find((guide) => guide.dataset.axis === 'x')!;
    expect(vertical.style.left).toBe('0px');
    const horizontal = guides.find((guide) => guide.dataset.axis === 'y')!;
    expect(horizontal.style.top).toBe('400px');
    pointer(overlay(), 'pointerup', 200, 446);

    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card-2')).toMatchObject({ x: 0, y: 10000 });
    expect(host.querySelector('[data-testid="guide-line"]')).toBeNull();
  });

  it('keeps the raw drag position and hides guides while Alt is held', () => {
    buildPreview();
    placeSecondCard();

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 200, 446, true);
    expect(host.querySelector('[data-testid="guide-line"]')).toBeNull();
    pointer(overlay(), 'pointerup', 200, 446, true);

    expect(getLayoutPlacement(controller.draft.theme, contextOf(), 'server-card-2')).toMatchObject({ x: 0, y: 9900 });
  });

  it('flags selection boxes that leave the safe area', () => {
    buildPreview();
    placeSecondCard();

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    const box = host.querySelector<HTMLElement>('[data-testid="selection-box"]')!;
    expect(box.dataset.layoutNode).toBe('server-card-2');
    expect(box.dataset.safeOverflow).toBe('false');
  });
});
