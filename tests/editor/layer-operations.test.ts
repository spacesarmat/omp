import { describe, expect, it } from 'vitest';
import type { LayoutContext, LayoutPlacement } from '../../design/schema';
import { getLayoutPlacement } from '../../design/layout';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createPlacement, moveNodeTransaction } from '../../editor/src/layout/transactions';
import {
  copyNodes,
  duplicateNode,
  LAYER_CLIPBOARD_LIMIT,
  LAYER_NAME_LIMIT,
  parseLayoutClipboard,
  pasteNodes,
  renameNode,
  setNodeHidden,
  setNodeLocked,
  type LayerNodeArgs,
} from '../../editor/src/layout/layerOperations';

const BASE = '0000000000000000000000000000000000000000';
const context: LayoutContext = { target: 'desktop-windows', screenId: 'library', format: 'landscape' };
const otherContext: LayoutContext = { target: 'desktop-windows', screenId: 'news', format: 'landscape' };

function createController(): DraftController {
  return createDraftController({
    draft: createDefaultDraft('draft-layers', BASE),
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

function args(nodeId: string, label: string, base?: LayoutPlacement): LayerNodeArgs {
  return { context, nodeId, label, base };
}

function orderOf(controller: DraftController, ctx: LayoutContext, parentId: string): string[] {
  const container = controller.draft.theme.layout?.containers.find(
    (entry) => entry.target === ctx.target
      && entry.screenId === ctx.screenId
      && entry.format === ctx.format
      && entry.nodeId === parentId,
  );
  return container ? container.order : [];
}

describe('renameNode', () => {
  it('renames a node and keeps the change in a single undo step', () => {
    const controller = createController();

    renameNode(controller, { ...args('card-a', 'Card A'), name: '  Главная карточка  ' });

    const placement = getLayoutPlacement(controller.draft.theme, context, 'card-a');
    expect(placement).toMatchObject({ label: 'Главная карточка', mode: 'flow' });
    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toBeUndefined();
    controller.dispose();
  });

  it('renames an existing placement in place and preserves its id and geometry', () => {
    const controller = createController();
    const base = createPlacement(context, 'card-a', 'Card A', { mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000 });
    renameNode(controller, { ...args('card-a', 'Card A', base), name: 'Hero' });

    const placement = getLayoutPlacement(controller.draft.theme, context, 'card-a');
    expect(placement).toMatchObject({ id: base.id, label: 'Hero', mode: 'absolute', x: 2500, y: 1200, width: 5000 });
    controller.dispose();
  });

  it('ignores an empty name without touching the draft history', () => {
    const controller = createController();

    renameNode(controller, { ...args('card-a', 'Card A'), name: '   ' });

    expect(controller.canUndo).toBe(false);
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    controller.dispose();
  });

  it('truncates names longer than the layer name limit', () => {
    const controller = createController();
    const longName = 'а'.repeat(LAYER_NAME_LIMIT + 20);

    renameNode(controller, { ...args('card-a', 'Card A'), name: longName });

    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.label).toHaveLength(LAYER_NAME_LIMIT);
    controller.dispose();
  });
});

describe('setNodeHidden', () => {
  it('hides a node and restores it with one undo step', () => {
    const controller = createController();

    setNodeHidden(controller, args('card-a', 'Card A'), true);

    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.hidden).toBe(true);
    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toBeUndefined();
    controller.dispose();
  });

  it('unhides a hidden node in place without adding undo steps for repeated values', () => {
    const controller = createController();
    setNodeHidden(controller, args('card-a', 'Card A'), true);
    const base = getLayoutPlacement(controller.draft.theme, context, 'card-a');
    const undoDepth = controller.canUndo;

    setNodeHidden(controller, args('card-a', 'Card A', base), true);
    expect(controller.canUndo).toBe(undoDepth);

    setNodeHidden(controller, args('card-a', 'Card A', base), false);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.hidden).toBe(false);
    expect(base && getLayoutPlacement(controller.draft.theme, context, 'card-a')?.id).toBe(base!.id);
    controller.dispose();
  });
});

describe('setNodeLocked', () => {
  it('locks a node so edits are blocked until it is unlocked, each in one undo step', () => {
    const controller = createController();

    setNodeLocked(controller, args('card-a', 'Card A'), true);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.locked).toBe(true);

    setNodeLocked(controller, args('card-a', 'Card A', getLayoutPlacement(controller.draft.theme, context, 'card-a')), false);
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.locked).toBe(false);

    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')?.locked).toBe(true);
    controller.undo();
    expect(getLayoutPlacement(controller.draft.theme, context, 'card-a')).toBeUndefined();
    controller.dispose();
  });
});

describe('duplicateNode', () => {
  it('duplicates a node with a fresh schema-safe id, a copy label and the same geometry', () => {
    const controller = createController();
    const base = createPlacement(context, 'card-a', 'Card A', { mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000, hidden: true, locked: true });

    const copyId = duplicateNode(controller, { ...args('card-a', 'Card A', base), parentId: 'card-grid' });

    expect(copyId).not.toBe('card-a');
    expect(copyId).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    const copy = getLayoutPlacement(controller.draft.theme, context, copyId);
    expect(copy).toMatchObject({
      mode: 'absolute',
      x: 2500,
      y: 1200,
      width: 5000,
      height: 3000,
      label: 'Card A копия',
      hidden: false,
      locked: false,
    });
    controller.dispose();
  });

  it('inserts the copy right after the original in a recorded container order and undoes as one step', () => {
    const controller = createController();
    moveNodeTransaction(controller, { context, nodeId: 'card-a', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'card-b', parentId: 'card-grid', index: 1 });
    const before = orderOf(controller, context, 'card-grid');

    const copyId = duplicateNode(controller, { ...args('card-a', 'Card A', getLayoutPlacement(controller.draft.theme, context, 'card-a')), parentId: 'card-grid' });

    expect(orderOf(controller, context, 'card-grid')).toEqual(['card-a', copyId, 'card-b']);
    controller.undo();
    expect(orderOf(controller, context, 'card-grid')).toEqual(before);
    expect(getLayoutPlacement(controller.draft.theme, context, copyId)).toBeUndefined();
    controller.dispose();
  });

  it('does not create a container record for an unrecorded parent', () => {
    const controller = createController();

    duplicateNode(controller, { ...args('card-a', 'Card A'), parentId: 'card-grid' });

    expect(controller.draft.theme.layout?.containers ?? []).toHaveLength(0);
    expect(controller.draft.theme.layout?.placements).toHaveLength(1);
    controller.dispose();
  });
});

describe('clipboard', () => {
  it('copyNodes strips node ids, context and placement ids and keeps layout data', () => {
    const placement = createPlacement(context, 'card-a', 'Card A', {
      mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000, margin: '8px', zIndex: 3, hidden: true, locked: true,
    });

    const clipboard = copyNodes([placement]);
    const node = clipboard.nodes[0];

    expect(clipboard.schemaVersion).toBe(1);
    expect(node).toMatchObject({ label: 'Card A', mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000, margin: '8px', zIndex: 3, hidden: true, locked: true });
    expect('nodeId' in node).toBe(false);
    expect('id' in node).toBe(false);
    expect('action' in node).toBe(false);
    expect('target' in node).toBe(false);
    expect('screenId' in node).toBe(false);
  });

  it('copyNodes clamps the clipboard to the node limit', () => {
    const placements = Array.from({ length: LAYER_CLIPBOARD_LIMIT + 25 }, (_, index) =>
      createPlacement(context, `card-${index}`, `Card ${index}`));

    expect(copyNodes(placements).nodes).toHaveLength(LAYER_CLIPBOARD_LIMIT);
  });

  it('parseLayoutClipboard accepts a clipboard produced by copyNodes', () => {
    const placement = createPlacement(context, 'card-a', 'Card A', { mode: 'absolute', x: 2500, y: 1200 });
    const parsed = parseLayoutClipboard(JSON.parse(JSON.stringify(copyNodes([placement]))));

    expect(parsed.errors).toEqual([]);
    expect(parsed.clipboard?.nodes[0]).toMatchObject({ label: 'Card A', mode: 'absolute', x: 2500, y: 1200 });
  });

  it('parseLayoutClipboard reports incompatibilities instead of throwing', () => {
    const valid = copyNodes([createPlacement(context, 'card-a', 'Card A')]);

    expect(parseLayoutClipboard(null).clipboard).toBeNull();
    expect(parseLayoutClipboard({ ...valid, schemaVersion: 2 }).errors[0]).toContain('версия');
    expect(parseLayoutClipboard({ schemaVersion: 1, nodes: [] }).errors[0]).toContain('узлов');
    expect(parseLayoutClipboard({ schemaVersion: 1, nodes: Array(LAYER_CLIPBOARD_LIMIT + 1).fill(valid.nodes[0]) }).errors[0]).toContain('100');

    const broken = { ...valid.nodes[0], mode: 'diagonal', anchor: 'center', x: Number.NaN, width: 'wide', hidden: 'yes' };
    const parsed = parseLayoutClipboard({ schemaVersion: 1, nodes: [broken] });
    expect(parsed.clipboard).toBeNull();
    expect(parsed.errors.length).toBeGreaterThanOrEqual(4);
    expect(parsed.errors[0]).toContain('Узел 1');
  });

  it('pasteNodes pastes into another page with fresh ids and one undo step', () => {
    const controller = createController();
    const source = createPlacement(context, 'card-a', 'Card A', { mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000 });
    const clipboard = copyNodes([source]);

    const [pastedId] = pasteNodes(controller, { context: otherContext, clipboard });

    expect(pastedId).not.toBe('card-a');
    const pasted = getLayoutPlacement(controller.draft.theme, otherContext, pastedId);
    expect(pasted).toMatchObject({ label: 'Card A', mode: 'absolute', x: 2500, y: 1200, width: 5000, height: 3000 });
    expect(pasted?.target).toBe('desktop-windows');
    expect(pasted?.screenId).toBe('news');
    expect(getLayoutPlacement(controller.draft.theme, context, pastedId)).toBeUndefined();

    controller.undo();
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
    controller.dispose();
  });

  it('pasteNodes appends pasted ids to a recorded parent container and keeps ids unique across pastes', () => {
    const controller = createController();
    moveNodeTransaction(controller, { context, nodeId: 'card-a', parentId: 'card-grid', index: 0 });
    const clipboard = copyNodes([createPlacement(context, 'card-a', 'Card A')]);

    const first = pasteNodes(controller, { context, clipboard, parentId: 'card-grid' });
    const second = pasteNodes(controller, { context, clipboard, parentId: 'card-grid' });

    expect(orderOf(controller, context, 'card-grid')).toEqual(['card-a', ...first, ...second]);
    expect(new Set([...first, ...second]).size).toBe(2);
    controller.undo();
    controller.undo();
    expect(orderOf(controller, context, 'card-grid')).toEqual(['card-a']);
    controller.dispose();
  });
});
