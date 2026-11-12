import type { LayoutContainer, LayoutContext, LayoutPlacement, ThemeDocument } from '../../../design/schema.ts';
import { moveLayoutNode, upsertLayoutContainer, upsertLayoutPlacement, createContainer } from '../../../design/layout.ts';
import { collectLayoutNodes } from '../../../design/layoutDom.ts';
import type { DraftController } from '../drafts.ts';

export const DRAG_THRESHOLD_PX = 4;
export const LAYOUT_GEOMETRY_LIMIT = 10000;
// Placement record ids must stay inside the schema id space /^[a-z0-9][a-z0-9-]{0,63}$/, so the
// placement- prefix plus the longest 64-char node id is truncated and suffixes keep room.
export const PLACEMENT_ID_LIMIT = 64;
const PLACEMENT_ID_PREFIX = 'placement-';
const PLACEMENT_ID_SUFFIX_ROOM = 8;

export interface ClientPoint {
  x: number;
  y: number;
}

export interface ClientRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Geometry is stored in fixed-point percent units: 10000 units cover the container, the runtime
// renders them as units / 100 percent. Conversion happens here so the rest of the editor works
// in native artboard pixels.
export function screenToArtboard(
  point: ClientPoint,
  iframeRect: ClientRectLike,
  _viewport: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  const scale = zoom > 0 ? zoom : 1;
  return { x: (point.x - iframeRect.x) / scale, y: (point.y - iframeRect.y) / scale };
}

function clampGeometry(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LAYOUT_GEOMETRY_LIMIT, Math.max(0, Math.round(value)));
}

function toUnits(px: number, size: number): number {
  if (!(size > 0)) return 0;
  return clampGeometry((px * LAYOUT_GEOMETRY_LIMIT) / size);
}

// Explicit size conversions for resize commits: absolutePlacementFromRect keeps explicit sizes
// only for an already absolute base node, so resizing overrides them with the freshly computed
// units and a flow conversion freezes the measured box instead of inheriting 'auto'.
export function rectSizeToUnits(px: number, size: number): number {
  return toUnits(px, size);
}

export function placementToRect(placement: LayoutPlacement, parentRect: LayoutRect, fallback?: LayoutRect | null): LayoutRect {
  const width = typeof placement.width === 'number'
    ? (placement.width / LAYOUT_GEOMETRY_LIMIT) * (placement.basisWidth ?? parentRect.width)
    : fallback?.width ?? parentRect.width;
  const height = typeof placement.height === 'number'
    ? (placement.height / LAYOUT_GEOMETRY_LIMIT) * (placement.basisHeight ?? parentRect.height)
    : fallback?.height ?? parentRect.height;
  const xUnits = (placement.x / LAYOUT_GEOMETRY_LIMIT) * parentRect.width;
  const yUnits = (placement.y / LAYOUT_GEOMETRY_LIMIT) * parentRect.height;
  const x = placement.anchor === 'top-right' || placement.anchor === 'bottom-right'
    ? parentRect.x + parentRect.width - xUnits - width
    : parentRect.x + xUnits;
  const y = placement.anchor === 'bottom-left' || placement.anchor === 'bottom-right'
    ? parentRect.y + parentRect.height - yUnits - height
    : parentRect.y + yUnits;
  return { x, y, width, height };
}

// Document margins are single px values. A measured border box already sits one margin away
// from its margin-free flow position, and the placement margin re-adds that offset at render:
// converting a measured rect must subtract it, or the node jumps by twice the margin.
export function marginOffsetPx(margin: string | undefined): number {
  if (!margin) return 0;
  const parsed = Number.parseFloat(margin);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Percent size conversions resolve against the captured basis when a record carries one, so
// written units always describe what the runtime renders.
export function placementSizeBasis(placement: LayoutPlacement | undefined, parentSize: number, axis: 'width' | 'height'): number {
  const basis = axis === 'width' ? placement?.basisWidth : placement?.basisHeight;
  return typeof basis === 'number' && basis > 0 ? basis : parentSize;
}

function placementRecordId(nodeId: string): string {
  return `${PLACEMENT_ID_PREFIX}${nodeId}`.slice(0, PLACEMENT_ID_LIMIT - PLACEMENT_ID_SUFFIX_ROOM);
}

export function createPlacement(
  context: LayoutContext,
  nodeId: string,
  label: string,
  patch: Partial<LayoutPlacement> = {},
): LayoutPlacement {
  return {
    id: placementRecordId(nodeId),
    target: context.target,
    screenId: context.screenId,
    format: context.format,
    nodeId,
    mode: 'flow',
    x: 0,
    y: 0,
    anchor: 'top-left',
    width: 'auto',
    height: 'auto',
    zIndex: 0,
    hidden: false,
    locked: false,
    label,
    ...patch,
  };
}

function sameIdentity(entry: LayoutPlacement, other: LayoutPlacement): boolean {
  return entry.target === other.target
    && entry.screenId === other.screenId
    && entry.format === other.format
    && entry.nodeId === other.nodeId;
}

export function uniquePlacementId(theme: ThemeDocument, placement: LayoutPlacement): string {
  const taken = new Set(theme.layout?.placements.map((entry) => entry.id) ?? []);
  if (!taken.has(placement.id)) return placement.id;
  const existing = theme.layout?.placements.find((entry) => entry.id === placement.id);
  if (existing && sameIdentity(existing, placement)) return placement.id;
  let suffix = 2;
  let candidate = `${placement.id}-${suffix}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${placement.id}-${suffix}`.slice(0, PLACEMENT_ID_LIMIT);
  }
  return candidate;
}

export function absolutePlacementFromRect(
  rect: LayoutRect,
  parentRect: LayoutRect,
  context: LayoutContext,
  nodeId: string,
  label: string,
  base?: LayoutPlacement,
): LayoutPlacement {
  const anchor = base?.anchor ?? 'top-left';
  const left = rect.x - parentRect.x;
  const top = rect.y - parentRect.y;
  const right = parentRect.x + parentRect.width - rect.x - rect.width;
  const bottom = parentRect.y + parentRect.height - rect.y - rect.height;
  const x = anchor === 'top-right' || anchor === 'bottom-right' ? right : left;
  const y = anchor === 'bottom-left' || anchor === 'bottom-right' ? bottom : top;
  // Explicit sizes survive only for an already absolute base node: switching a flow node to
  // absolute freezes the measured box instead of carrying 'auto' over and letting the node
  // shrink around its content. Resize commits override the sizes with fresh units anyway.
  const keepSize = base?.mode === 'absolute';
  const patch: Partial<LayoutPlacement> = {
    ...(base ?? {}),
    mode: 'absolute',
    anchor,
    x: toUnits(x, parentRect.width),
    y: toUnits(y, parentRect.height),
    width: keepSize ? base!.width : toUnits(rect.width, parentRect.width),
    height: keepSize ? base!.height : toUnits(rect.height, parentRect.height),
    zIndex: base?.zIndex ?? 0,
    hidden: base?.hidden ?? false,
    locked: base?.locked ?? false,
    label: base?.label ?? label,
  };
  if (!keepSize) {
    // A flow conversion pins the size basis to the current parent: the percent sizes keep
    // resolving against these pixel sizes, so the parent shrinking after the removal cannot
    // collapse the absolute node. An absolute base keeps its own basis untouched.
    patch.basisWidth = Math.round(parentRect.width);
    patch.basisHeight = Math.round(parentRect.height);
  }
  if (base?.id) patch.id = base.id;
  return createPlacement(context, nodeId, label, patch);
}

// Arrow-key nudge: one press moves the element by whole artboard pixels, Shift multiplies the
// step by 10. Right and bottom anchors measure the offset from the opposite edge, so the sign
// flips there to keep the visual direction of the pressed arrow.
export function nudgePlacement(
  placement: LayoutPlacement,
  delta: { x: number; y: number },
  parentSize: { width: number; height: number },
): LayoutPlacement {
  const signX = placement.anchor === 'top-right' || placement.anchor === 'bottom-right' ? -1 : 1;
  const signY = placement.anchor === 'bottom-left' || placement.anchor === 'bottom-right' ? -1 : 1;
  return {
    ...placement,
    x: toUnits((placement.x / LAYOUT_GEOMETRY_LIMIT) * parentSize.width + delta.x * signX, parentSize.width),
    y: toUnits((placement.y / LAYOUT_GEOMETRY_LIMIT) * parentSize.height + delta.y * signY, parentSize.height),
  };
}

export interface MoveNodeTransactionArgs {
  context: LayoutContext;
  nodeId: string;
  parentId: string;
  index: number;
  siblings?: string[];
  placement?: LayoutPlacement;
}

// One call is exactly one undo step: the flow order and the optional mode switch
// (absolute back to flow) land in a single draft update. Siblings seed a container
// record that does not exist yet, so the first reorder keeps the full document order
// instead of remembering only the dropped node.
export function moveNodeTransaction(controller: DraftController, args: MoveNodeTransactionArgs): void {
  controller.update((draft) => {
    draft.theme = moveLayoutNode(draft.theme, args.context, args.nodeId, args.parentId, args.index, args.siblings);
    if (args.placement) {
      draft.theme = upsertLayoutPlacement(draft.theme, {
        ...args.placement,
        id: uniquePlacementId(draft.theme, args.placement),
      });
    }
    return draft;
  });
}

export function placeNodeTransaction(controller: DraftController, placement: LayoutPlacement): void {
  controller.update((draft) => {
    draft.theme = upsertLayoutPlacement(draft.theme, { ...placement, id: uniquePlacementId(draft.theme, placement) });
    return draft;
  });
}

export interface ContainerPatchTransactionArgs {
  context: LayoutContext;
  nodeId: string;
  seed?: string[];
  patch: Partial<Pick<LayoutContainer, 'padding' | 'direction' | 'alignment' | 'distribution'>>;
}

// Container spacing edits stay one undo step: the record is created from the document
// order seed when missing, otherwise patched in place with its order preserved.
export function updateContainerTransaction(controller: DraftController, args: ContainerPatchTransactionArgs): void {
  controller.update((draft) => {
    const layout = draft.theme.layout ?? { containers: [], placements: [] };
    const existing = layout.containers.find(
      (entry) => entry.target === args.context.target
        && entry.screenId === args.context.screenId
        && entry.format === args.context.format
        && entry.nodeId === args.nodeId,
    );
    const container = existing
      ? { ...existing, ...args.patch }
      : createContainer(args.context, args.nodeId, args.seed ?? [], args.patch);
    draft.theme = upsertLayoutContainer(draft.theme, container);
    return draft;
  });
}

export interface NodeMarginTransactionArgs {
  context: LayoutContext;
  nodeId: string;
  label: string;
  base?: LayoutPlacement;
  margin?: string;
}

export function updateNodeMarginTransaction(controller: DraftController, args: NodeMarginTransactionArgs): void {
  controller.update((draft) => {
    const placement = createPlacement(args.context, args.nodeId, args.label, { ...(args.base ?? {}), margin: args.margin });
    if (args.base?.id) placement.id = args.base.id;
    draft.theme = upsertLayoutPlacement(draft.theme, { ...placement, id: uniquePlacementId(draft.theme, placement) });
    return draft;
  });
}

// Group alignment and distribution stay one undo step: the container record patch and every
// rewritten placement land in a single draft update, so undo restores the whole group at once.
export interface AlignSelectionTransactionArgs {
  context: LayoutContext;
  placements?: LayoutPlacement[];
  container?: {
    nodeId: string;
    seed?: string[];
    patch: Partial<Pick<LayoutContainer, 'alignment' | 'distribution'>>;
  };
}

export function alignSelectionTransaction(controller: DraftController, args: AlignSelectionTransactionArgs): void {
  controller.update((draft) => {
    if (args.container) {
      const layout = draft.theme.layout ?? { containers: [], placements: [] };
      const existing = layout.containers.find(
        (entry) => entry.target === args.context.target
          && entry.screenId === args.context.screenId
          && entry.format === args.context.format
          && entry.nodeId === args.container!.nodeId,
      );
      const container = existing
        ? { ...existing, ...args.container.patch }
        : createContainer(args.context, args.container.nodeId, args.container.seed ?? [], args.container.patch);
      draft.theme = upsertLayoutContainer(draft.theme, container);
    }
    for (const placement of args.placements ?? []) {
      draft.theme = upsertLayoutPlacement(draft.theme, { ...placement, id: uniquePlacementId(draft.theme, placement) });
    }
    return draft;
  });
}

export interface NodesMarginTransactionArgs {
  context: LayoutContext;
  items: { nodeId: string; label: string; base?: LayoutPlacement; margin?: string }[];
}

// One shared margin edit for every selected node is a single undo step, same as a solo margin edit.
export function updateNodesMarginTransaction(controller: DraftController, args: NodesMarginTransactionArgs): void {
  controller.update((draft) => {
    for (const item of args.items) {
      const placement = createPlacement(args.context, item.nodeId, item.label, { ...(item.base ?? {}), margin: item.margin });
      if (item.base?.id) placement.id = item.base.id;
      draft.theme = upsertLayoutPlacement(draft.theme, { ...placement, id: uniquePlacementId(draft.theme, placement) });
    }
    return draft;
  });
}

// collectLayoutNodes resolves identity by walking the tree in pre-order; repeating the same walk
// here pairs every descriptor with its element so the editor can stamp data-layout-node and read
// geometry without a second identity implementation.
export function collectLayoutElements(root: HTMLElement): Map<string, HTMLElement> {
  const elements: HTMLElement[] = [];
  const visit = (element: HTMLElement): void => {
    elements.push(element);
    for (const child of element.children) visit(child as HTMLElement);
  };
  visit(root);
  const nodes = collectLayoutNodes(root);
  const byNodeId = new Map<string, HTMLElement>();
  nodes.forEach((node, index) => {
    const element = elements[index];
    if (!element) return;
    element.dataset.layoutNode = node.nodeId;
    byNodeId.set(node.nodeId, element);
  });
  return byNodeId;
}
