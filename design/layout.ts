import type {
  LayoutContainer,
  LayoutContext,
  LayoutDocument,
  LayoutPlacement,
  ThemeDocument,
} from './schema.ts';

export type {
  LayoutContext,
  LayoutContainer,
  LayoutPlacement,
  LayoutDocument,
  StylePreset,
} from './schema.ts';

function emptyLayout(): LayoutDocument {
  return { containers: [], placements: [] };
}

function sameContext(entry: LayoutContext, context: LayoutContext): boolean {
  return entry.target === context.target && entry.screenId === context.screenId && entry.format === context.format;
}

function sameIdentity(entry: LayoutContext & { nodeId: string }, other: LayoutContext & { nodeId: string }): boolean {
  return sameContext(entry, other) && entry.nodeId === other.nodeId;
}

export function getLayoutPlacement(theme: ThemeDocument, context: LayoutContext, nodeId: string): LayoutPlacement | undefined {
  return theme.layout?.placements.find((placement) => sameIdentity(placement, { ...context, nodeId }));
}

export function upsertLayoutPlacement(theme: ThemeDocument, placement: LayoutPlacement): ThemeDocument {
  const layout = theme.layout ?? emptyLayout();
  const index = layout.placements.findIndex((entry) => sameIdentity(entry, placement));
  const placements = index >= 0
    ? layout.placements.map((entry, entryIndex) => (entryIndex === index ? placement : entry))
    : [...layout.placements, placement];
  return { ...theme, layout: { ...layout, placements } };
}

function containerId(theme: ThemeDocument, parentId: string): string {
  const taken = new Set(theme.layout?.containers.map((container) => container.id) ?? []);
  let candidate = `flow-${parentId}`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `flow-${parentId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function moveLayoutNode(
  theme: ThemeDocument,
  context: LayoutContext,
  nodeId: string,
  parentId: string,
  index: number,
  seed?: string[],
): ThemeDocument {
  const layout = theme.layout ?? emptyLayout();
  const containers: LayoutContainer[] = [];
  let targetIndex = -1;
  layout.containers.forEach((container, containerIndex) => {
    if (!sameContext(container, context)) {
      containers.push(container);
      return;
    }
    let order = container.order.filter((entry) => entry !== nodeId);
    if (container.nodeId === parentId) {
      targetIndex = containerIndex;
      const at = Math.max(0, Math.min(index, order.length));
      order = [...order.slice(0, at), nodeId, ...order.slice(at)];
    }
    containers.push({ ...container, order });
  });
  if (targetIndex < 0) {
    const base = seed ? seed.filter((entry) => entry !== nodeId) : [];
    const at = Math.max(0, Math.min(index, base.length));
    containers.push({
      id: containerId(theme, parentId),
      ...context,
      nodeId: parentId,
      order: [...base.slice(0, at), nodeId, ...base.slice(at)],
    });
  }
  return { ...theme, layout: { ...layout, containers } };
}
