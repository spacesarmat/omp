import { describe, expect, it } from 'vitest';
import type { LayoutContext, LayoutPlacement } from '../../design/schema';
import { createDefaultTheme } from '../../design/defaults';
import { getLayoutPlacement } from '../../design/layout';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { createDefaultDraft } from '../../editor/shared/draft';
import {
  absolutePlacementFromRect,
  collectLayoutElements,
  createPlacement,
  moveNodeTransaction,
  placeNodeTransaction,
  screenToArtboard,
} from '../../editor/src/layout/transactions';

const BASE = '0000000000000000000000000000000000000000';
const context: LayoutContext = { target: 'desktop-windows', screenId: 'library', format: 'landscape' };

function createController(): DraftController {
  return createDraftController({
    draft: createDefaultDraft('draft-layout', BASE),
    client: {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    },
  });
}

function orderOf(controller: DraftController, parentId: string): string[] {
  const container = controller.draft.theme.layout?.containers.find(
    (entry) => entry.target === context.target
      && entry.screenId === context.screenId
      && entry.format === context.format
      && entry.nodeId === parentId,
  );
  return container ? container.order : [];
}

describe('screenToArtboard', () => {
  it('converts client coordinates at zoom 0.5 with a scrolled iframe origin', () => {
    const point = screenToArtboard(
      { x: 130, y: 90 },
      { x: 100, y: 50, width: 640, height: 360 },
      { width: 1280, height: 720 },
      0.5,
    );
    expect(point).toEqual({ x: 60, y: 80 });
  });

  it('keeps coordinates outside the artboard instead of clamping them', () => {
    const point = screenToArtboard(
      { x: 90, y: 40 },
      { x: 100, y: 50, width: 640, height: 360 },
      { width: 1280, height: 720 },
      1,
    );
    expect(point).toEqual({ x: -10, y: -10 });
  });
});

describe('moveNodeTransaction', () => {
  it('inserts card-b before card-a inside the flow container', () => {
    const controller = createController();
    moveNodeTransaction(controller, { context, nodeId: 'card-a', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'card-b', parentId: 'card-grid', index: 1 });

    moveNodeTransaction(controller, { context, nodeId: 'card-b', parentId: 'card-grid', index: 0 });

    expect(orderOf(controller, 'card-grid')).toEqual(['card-b', 'card-a']);
    expect(controller.canUndo).toBe(true);
    controller.dispose();
  });

  it('moves an absolute node back to flow with one placement in a single undo step', () => {
    const controller = createController();
    moveNodeTransaction(controller, { context, nodeId: 'card-a', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'card-b', parentId: 'card-grid', index: 1 });
    const absolute = createPlacement(context, 'card-b', 'Card B', { mode: 'absolute', x: 5000, y: 2500 });
    placeNodeTransaction(controller, absolute);
    const flowBack = createPlacement(context, 'card-b', 'Card B', { mode: 'flow' });

    moveNodeTransaction(controller, { context, nodeId: 'card-b', parentId: 'card-grid', index: 0, placement: flowBack });

    expect(orderOf(controller, 'card-grid')).toEqual(['card-b', 'card-a']);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-b')?.mode).toBe('flow');

    controller.undo();

    expect(orderOf(controller, 'card-grid')).toEqual(['card-a', 'card-b']);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-b')).toMatchObject({ mode: 'absolute', x: 5000, y: 2500 });
    controller.dispose();
  });
});

describe('placeNodeTransaction', () => {
  it('converts a flow node to absolute placement that preserves the on-screen rect', () => {
    const controller = createController();
    const rect = { x: 40, y: 24, width: 200, height: 120 };
    const parentRect = { x: 0, y: 0, width: 400, height: 400 };
    const placement = absolutePlacementFromRect(rect, parentRect, context, 'card-a', 'Card A');

    placeNodeTransaction(controller, placement);

    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toEqual(placement);
    expect(placement).toMatchObject({
      mode: 'absolute',
      anchor: 'top-left',
      x: 1000,
      y: 600,
      width: 5000,
      height: 3000,
    });
    expect(controller.canUndo).toBe(true);
    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toBeUndefined();
    controller.dispose();
  });

  it('keeps size, zIndex, label and anchor from the base placement while moving', () => {
    const base = createPlacement(context, 'card-a', 'Card A', {
      mode: 'absolute',
      x: 100,
      y: 100,
      anchor: 'bottom-right',
      width: 'auto',
      height: 800,
      zIndex: 3,
      hidden: true,
      locked: true,
    });
    const moved = absolutePlacementFromRect(
      { x: 300, y: 200, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'card-a',
      'Card A',
      base,
    );
    expect(moved).toMatchObject({
      id: base.id,
      mode: 'absolute',
      anchor: 'bottom-right',
      x: 0,
      y: 2500,
      width: 'auto',
      height: 800,
      zIndex: 3,
      hidden: true,
      locked: true,
      label: 'Card A',
    });
  });

  it('creates a valid flow placement that round-trips through the draft validation', () => {
    const controller = createController();
    const placement: LayoutPlacement = createPlacement(context, 'card-a', 'Card A');
    expect(placement).toMatchObject({ mode: 'flow', x: 0, y: 0, anchor: 'top-left', width: 'auto', height: 'auto', zIndex: 0 });
    placeNodeTransaction(controller, placement);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toEqual(placement);
    controller.dispose();
  });
});

describe('collectLayoutElements', () => {
  it('stamps data-layout-node attributes and maps node ids to elements', () => {
    const root = document.createElement('div');
    const grid = document.createElement('div');
    grid.dataset.designId = 'card-grid';
    const first = document.createElement('div');
    first.dataset.designId = 'server-card';
    const second = document.createElement('div');
    second.dataset.designId = 'server-card';
    const keyed = document.createElement('div');
    keyed.dataset.key = 'hash-1';
    grid.append(first, second, keyed);
    root.appendChild(grid);

    const elements = collectLayoutElements(root);

    expect(first.dataset.layoutNode).toBe('server-card');
    expect(second.dataset.layoutNode).toBe('server-card-2');
    expect(keyed.dataset.layoutNode).toBe('key-hash-1');
    expect(grid.dataset.layoutNode).toBe('card-grid');
    expect(elements.get('server-card')).toBe(first);
    expect(elements.get('server-card-2')).toBe(second);
    expect(elements.get('key-hash-1')).toBe(keyed);
  });
});
