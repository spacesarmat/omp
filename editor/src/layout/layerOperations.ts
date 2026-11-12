import {
  LAYOUT_ANCHORS,
  LAYOUT_CLONE_HTML_LIMIT,
  LAYOUT_MODES,
  type LayoutAnchor,
  type LayoutContext,
  type LayoutMode,
  type LayoutPlacement,
  type ThemeDocument,
} from '../../../design/schema.ts';
import {
  LAYOUT_GEOMETRY_LIMIT,
  LAYOUT_ZINDEX_LIMIT,
  isLayoutGeometryValue,
  isLayoutMarginValue,
  isLayoutSizeValue,
  isLayoutZIndexValue,
} from '../../../design/validation.ts';
import { upsertLayoutClone, upsertLayoutPlacement } from '../../../design/layout.ts';
import type { DraftController } from '../drafts.ts';
import { createPlacement, uniquePlacementId } from './transactions.ts';

export const LAYER_NAME_LIMIT = 60;
export const LAYER_CLIPBOARD_LIMIT = 100;
export { LAYOUT_CLONE_HTML_LIMIT };

export interface LayerNodeArgs {
  context: LayoutContext;
  nodeId: string;
  label: string;
  base?: LayoutPlacement;
}

// Node ids must stay inside the schema id space /^[a-z0-9][a-z0-9-]{0,63}$/ so placements that
// reference them round-trip through parseThemeDocument. Fresh ids are prefixed with copy- so a
// pasted or duplicated node is recognizable in the layer list.
export function createLayerNodeId(): string {
  return `copy-${crypto.randomUUID()}`;
}

export function createCloneRecordId(): string {
  return `clone-${crypto.randomUUID()}`;
}

function commitPlacement(controller: DraftController, args: LayerNodeArgs, patch: Partial<LayoutPlacement>): void {
  controller.update((draft) => {
    const placement = createPlacement(args.context, args.nodeId, patch.label ?? args.label, { ...(args.base ?? {}), ...patch });
    if (args.base?.id) placement.id = args.base.id;
    draft.theme = upsertLayoutPlacement(draft.theme, { ...placement, id: uniquePlacementId(draft.theme, placement) });
    return draft;
  });
}

// An empty or unchanged name never touches the draft history, so undo stays free of noise.
export function renameNode(controller: DraftController, args: LayerNodeArgs & { name: string }): void {
  const name = args.name.trim().slice(0, LAYER_NAME_LIMIT);
  if (!name || name === (args.base?.label ?? args.label)) return;
  commitPlacement(controller, args, { label: name });
}

export function setNodeHidden(controller: DraftController, args: LayerNodeArgs, hidden: boolean): void {
  if ((args.base?.hidden ?? false) === hidden) return;
  commitPlacement(controller, args, { hidden });
}

export function setNodeLocked(controller: DraftController, args: LayerNodeArgs, locked: boolean): void {
  if ((args.base?.locked ?? false) === locked) return;
  commitPlacement(controller, args, { locked });
}

function insertAfterOriginal(theme: ThemeDocument, context: LayoutContext, parentId: string, nodeId: string, afterId: string): ThemeDocument {
  const layout = theme.layout;
  if (!layout) return theme;
  const containers = layout.containers.map((container) => {
    if (container.target !== context.target || container.screenId !== context.screenId || container.format !== context.format || container.nodeId !== parentId) {
      return container;
    }
    if (container.order.includes(nodeId)) return container;
    const at = container.order.indexOf(afterId);
    const order = at < 0
      ? [...container.order, nodeId]
      : [...container.order.slice(0, at + 1), nodeId, ...container.order.slice(at + 1)];
    return { ...container, order };
  });
  return { ...theme, layout: { ...layout, containers } };
}

// The copy lands next to the original inside a recorded container; an unrecorded parent stays
// unrecorded so the first real reorder still seeds the full document order. With an html snapshot
// the copy also becomes a layout clone that the shared runtime renders anywhere.
export function duplicateNode(controller: DraftController, args: LayerNodeArgs & { parentId?: string | null; html?: string | null }): string {
  const nodeId = createLayerNodeId();
  const label = `${args.label} копия`.slice(0, LAYER_NAME_LIMIT);
  controller.update((draft) => {
    const { id: _baseId, nodeId: _baseNodeId, ...base } = args.base ?? {};
    const placement = createPlacement(args.context, nodeId, label, {
      ...base,
      label,
      hidden: false,
      locked: false,
    });
    let theme = upsertLayoutPlacement(draft.theme, placement);
    if (args.html && args.parentId) {
      theme = upsertLayoutClone(theme, {
        id: createCloneRecordId(),
        target: args.context.target,
        screenId: args.context.screenId,
        format: args.context.format,
        nodeId,
        parentId: args.parentId,
        label,
        sourceNodeId: args.nodeId,
        html: args.html,
      });
    }
    if (args.parentId) theme = insertAfterOriginal(theme, args.context, args.parentId, nodeId, args.nodeId);
    draft.theme = theme;
    return draft;
  });
  return nodeId;
}

// Clipboard nodes intentionally carry no nodeId and no interaction action: identity is local to
// one page, so paste mints fresh ids and actions never travel between screens. The sanitized html
// snapshot is optional and only used to render visible clones on the target page.
export interface LayoutClipboardNode {
  label: string;
  mode: LayoutMode;
  x: number;
  y: number;
  anchor: LayoutAnchor;
  width: number | 'auto';
  height: number | 'auto';
  margin?: string;
  zIndex: number;
  hidden: boolean;
  locked: boolean;
  html?: string;
}

export interface LayoutClipboard {
  schemaVersion: 1;
  nodes: LayoutClipboardNode[];
}

export function copyNodes(placements: LayoutPlacement[], resolveHtml?: (nodeId: string) => string | null): LayoutClipboard {
  return {
    schemaVersion: 1,
    nodes: placements.slice(0, LAYER_CLIPBOARD_LIMIT).map((placement) => {
      const html = resolveHtml?.(placement.nodeId) ?? undefined;
      return {
        label: placement.label,
        mode: placement.mode,
        x: placement.x,
        y: placement.y,
        anchor: placement.anchor,
        width: placement.width,
        height: placement.height,
        ...(placement.margin !== undefined ? { margin: placement.margin } : {}),
        zIndex: placement.zIndex,
        hidden: placement.hidden,
        locked: placement.locked,
        ...(html ? { html } : {}),
      };
    }),
  };
}

export interface ClipboardParseResult {
  clipboard: LayoutClipboard | null;
  errors: string[];
}

function validateClipboardNode(raw: unknown, index: number, errors: string[]): void {
  const prefix = `Узел ${index + 1}`;
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${prefix}: некорректные данные`);
    return;
  }
  const node = raw as Record<string, unknown>;
  if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > LAYER_NAME_LIMIT) errors.push(`${prefix}: некорректное имя`);
  if (!(LAYOUT_MODES as readonly string[]).includes(String(node.mode))) errors.push(`${prefix}: режим не поддерживается`);
  if (!(LAYOUT_ANCHORS as readonly string[]).includes(String(node.anchor))) errors.push(`${prefix}: якорь не поддерживается`);
  if (!isLayoutGeometryValue(node.x) || !isLayoutGeometryValue(node.y)) errors.push(`${prefix}: координаты должны быть целыми от 0 до ${LAYOUT_GEOMETRY_LIMIT}`);
  if (!isLayoutZIndexValue(node.zIndex)) errors.push(`${prefix}: zIndex должен быть целым от 0 до ${LAYOUT_ZINDEX_LIMIT}`);
  for (const key of ['width', 'height'] as const) {
    if (!isLayoutSizeValue(node[key])) errors.push(`${prefix}: размер должен быть целым от 0 до ${LAYOUT_GEOMETRY_LIMIT} или auto`);
  }
  for (const key of ['hidden', 'locked'] as const) {
    if (typeof node[key] !== 'boolean') errors.push(`${prefix}: флаг ${key} должен быть булевым`);
  }
  if (node.margin !== undefined && !isLayoutMarginValue(node.margin)) errors.push(`${prefix}: отступ должен быть размером в px, например 8px`);
  if (node.html !== undefined
    && (typeof node.html !== 'string' || node.html.length > LAYOUT_CLONE_HTML_LIMIT || /<script[\s>/]/i.test(node.html))) {
    errors.push(`${prefix}: html недопустим`);
  }
}

// Validation errors are collected, not thrown, so the panel can list every incompatibility
// before anything reaches the draft.
export function parseLayoutClipboard(raw: unknown): ClipboardParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { clipboard: null, errors: ['Clipboard должен быть объектом'] };
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    errors.push('Неподдерживаемая версия clipboard');
  }
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
    errors.push('В clipboard нет узлов');
  } else {
    if (candidate.nodes.length > LAYER_CLIPBOARD_LIMIT) errors.push(`В clipboard больше ${LAYER_CLIPBOARD_LIMIT} узлов`);
    candidate.nodes.forEach((node, index) => validateClipboardNode(node, index, errors));
  }
  return errors.length ? { clipboard: null, errors } : { clipboard: candidate as unknown as LayoutClipboard, errors };
}

export interface PasteNodesArgs {
  context: LayoutContext;
  clipboard: LayoutClipboard;
  parentId?: string | null;
}

function appendToContainer(theme: ThemeDocument, context: LayoutContext, parentId: string, nodeIds: string[]): ThemeDocument {
  const layout = theme.layout;
  if (!layout) return theme;
  const containers = layout.containers.map((container) => {
    if (container.target !== context.target || container.screenId !== context.screenId || container.format !== context.format || container.nodeId !== parentId) {
      return container;
    }
    const fresh = nodeIds.filter((nodeId) => !container.order.includes(nodeId));
    return fresh.length ? { ...container, order: [...container.order, ...fresh] } : container;
  });
  return { ...theme, layout: { ...layout, containers } };
}

// The whole paste is a single draft update, so one undo removes every pasted node at once.
export function pasteNodes(controller: DraftController, args: PasteNodesArgs): string[] {
  const nodeIds = args.clipboard.nodes.map(() => createLayerNodeId());
  controller.update((draft) => {
    let theme = draft.theme;
    args.clipboard.nodes.forEach((node, index) => {
      const nodeId = nodeIds[index];
      const { html, ...placementFields } = node;
      theme = upsertLayoutPlacement(theme, createPlacement(args.context, nodeId, node.label, { ...placementFields }));
      if (html && args.parentId) {
        theme = upsertLayoutClone(theme, {
          id: createCloneRecordId(),
          target: args.context.target,
          screenId: args.context.screenId,
          format: args.context.format,
          nodeId,
          parentId: args.parentId,
          label: node.label,
          html,
        });
      }
    });
    if (args.parentId) theme = appendToContainer(theme, args.context, args.parentId, nodeIds);
    draft.theme = theme;
    return draft;
  });
  return nodeIds;
}
