import type {
  LayoutClone,
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
  LayoutClone,
  StylePreset,
} from './schema.ts';

function emptyLayout(): LayoutDocument {
  return { containers: [], placements: [] };
}

// Container record ids must stay inside the schema id space /^[a-z0-9][a-z0-9-]{0,63}$/, so the
// flow- prefix plus the longest 64-char node id is truncated and suffixes keep room.
const CONTAINER_ID_LIMIT = 64;
const CONTAINER_ID_PREFIX = 'flow-';
const CONTAINER_ID_SUFFIX_ROOM = 8;

function containerRecordId(nodeId: string): string {
  return `${CONTAINER_ID_PREFIX}${nodeId}`.slice(0, CONTAINER_ID_LIMIT - CONTAINER_ID_SUFFIX_ROOM);
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

export function createContainer(
  context: LayoutContext,
  nodeId: string,
  seed: string[],
  patch: Partial<Pick<LayoutContainer, 'padding' | 'direction' | 'alignment' | 'distribution'>> = {},
): LayoutContainer {
  return {
    id: containerRecordId(nodeId),
    ...context,
    nodeId,
    order: [...seed],
    ...patch,
  };
}

export function upsertLayoutContainer(theme: ThemeDocument, container: LayoutContainer): ThemeDocument {
  const layout = theme.layout ?? emptyLayout();
  const index = layout.containers.findIndex((entry) => sameContext(entry, container) && entry.nodeId === container.nodeId);
  const containers = index >= 0
    ? layout.containers.map((entry, entryIndex) => (entryIndex === index ? container : entry))
    : [...layout.containers, { ...container, id: containerId(theme, container.nodeId) }];
  return { ...theme, layout: { ...layout, containers } };
}

export function upsertLayoutClone(theme: ThemeDocument, clone: LayoutClone): ThemeDocument {
  const layout = theme.layout ?? emptyLayout();
  const clones = layout.clones ?? [];
  const index = clones.findIndex((entry) => sameContext(entry, clone) && entry.nodeId === clone.nodeId);
  const next = index >= 0
    ? clones.map((entry, entryIndex) => (entryIndex === index ? clone : entry))
    : [...clones, clone];
  return { ...theme, layout: { ...layout, clones: next } };
}

function containerId(theme: ThemeDocument, parentId: string): string {
  const taken = new Set(theme.layout?.containers.map((container) => container.id) ?? []);
  const base = containerRecordId(parentId);
  if (!taken.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, CONTAINER_ID_LIMIT);
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
