import {
  DESIGN_FORMATS,
  DESIGN_TARGETS,
  type DesignFormat,
  type DesignTarget,
  type LayoutContext,
  type LayoutDocument,
  type LayoutPlacement,
  type ThemeDocument,
} from './schema.ts';
import { PRODUCTION_LAYOUT } from './generated/layout.ts';

export type LayoutNodeKind = 'element' | 'dynamic';

export interface LayoutNodeDescriptor {
  nodeId: string;
  elementId: string;
  parentId: string | null;
  label: string;
  kind: LayoutNodeKind;
}

interface ResolvedNode {
  element: HTMLElement;
  nodeId: string;
  elementId: string;
  parentId: string | null;
  kind: LayoutNodeKind;
}

type IdentitySource = 'key' | 'adapter' | 'path';

interface IdentityCandidate {
  nodeId: string;
  kind: LayoutNodeKind;
  source: IdentitySource;
}

function identityOf(element: HTMLElement, path: string, seenKeys: Set<string>, adapterCounts: Map<string, number>): IdentityCandidate {
  const key = element.dataset.key;
  if (key) {
    if (seenKeys.has(key)) throw new Error(`duplicate data key "${key}"`);
    seenKeys.add(key);
    return { nodeId: `key-${key}`, kind: 'dynamic', source: 'key' };
  }
  const adapter = element.dataset.designId || element.dataset.designComponent || null;
  if (adapter) {
    const count = (adapterCounts.get(adapter) ?? 0) + 1;
    adapterCounts.set(adapter, count);
    return { nodeId: count === 1 ? adapter : `${adapter}#${count}`, kind: 'element', source: 'adapter' };
  }
  return { nodeId: path || '/', kind: 'element', source: 'path' };
}

function labelOf(element: HTMLElement, elementId: string): string {
  const explicit = element.dataset.designLabel;
  if (explicit) return explicit;
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 40) : elementId;
}

function resolveNodes(root: HTMLElement): ResolvedNode[] {
  const nodes: ResolvedNode[] = [];
  const seenKeys = new Set<string>();
  const adapterCounts = new Map<string, number>();
  const visit = (element: HTMLElement, parentId: string | null, path: string): void => {
    const candidate = identityOf(element, path, seenKeys, adapterCounts);
    const elementId = element.dataset.designId || element.dataset.designComponent || candidate.nodeId;
    nodes.push({ element, nodeId: candidate.nodeId, elementId, parentId, kind: candidate.kind });
    let childIndex = 0;
    for (const child of element.children) {
      visit(child as HTMLElement, candidate.nodeId, `${path}/${childIndex}`);
      childIndex += 1;
    }
  };
  visit(root, null, '');
  return nodes;
}

export function collectLayoutNodes(root: HTMLElement): LayoutNodeDescriptor[] {
  return resolveNodes(root).map((node) => ({
    nodeId: node.nodeId,
    elementId: node.elementId,
    parentId: node.parentId,
    label: labelOf(node.element, node.elementId),
    kind: node.kind,
  }));
}

const MANAGED_STYLE_PROPS = ['position', 'left', 'right', 'top', 'bottom', 'width', 'height', 'z-index'] as const;

function resetManagedStyle(element: HTMLElement): void {
  if (element.dataset.layoutManaged !== '1') return;
  for (const prop of MANAGED_STYLE_PROPS) element.style.removeProperty(prop);
  delete element.dataset.layoutManaged;
}

function applyPlacement(element: HTMLElement, placement: LayoutPlacement): void {
  resetManagedStyle(element);
  element.dataset.layoutMode = placement.mode;
  if (placement.mode === 'absolute') {
    element.dataset.layoutManaged = '1';
    element.style.position = 'absolute';
    const x = `${placement.x / 100}%`;
    const y = `${placement.y / 100}%`;
    if (placement.anchor === 'top-left') {
      element.style.left = x;
      element.style.top = y;
    } else if (placement.anchor === 'top-right') {
      element.style.right = x;
      element.style.top = y;
    } else if (placement.anchor === 'bottom-left') {
      element.style.left = x;
      element.style.bottom = y;
    } else {
      element.style.right = x;
      element.style.bottom = y;
    }
    if (typeof placement.width === 'number') element.style.width = `${placement.width / 100}%`;
    if (typeof placement.height === 'number') element.style.height = `${placement.height / 100}%`;
    element.style.zIndex = String(placement.zIndex);
  }
  if (placement.hidden) {
    element.dataset.layoutHidden = '1';
    element.style.display = 'none';
  } else if (element.dataset.layoutHidden === '1') {
    element.style.removeProperty('display');
    delete element.dataset.layoutHidden;
  }
}

function applyContainerOrder(containerElement: HTMLElement, order: string[], nodeIdByElement: Map<HTMLElement, string>): void {
  const children = [...containerElement.children] as HTMLElement[];
  if (children.length < 2) return;
  const rank = new Map(order.map((nodeId, index) => [nodeId, index]));
  const sorted = [...children].sort((a, b) => {
    const aRank = rank.get(nodeIdByElement.get(a) ?? '') ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(nodeIdByElement.get(b) ?? '') ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
  for (let index = 0; index < children.length; index += 1) {
    if (sorted[index] !== children[index]) {
      for (const child of sorted) containerElement.appendChild(child);
      return;
    }
  }
}

function sameContext(entry: LayoutContext, context: LayoutContext): boolean {
  return entry.target === context.target && entry.screenId === context.screenId && entry.format === context.format;
}

interface LayoutRuntimeOptions {
  production: boolean;
}

function createLayoutRuntime(
  root: HTMLElement,
  layoutOf: () => LayoutDocument | undefined,
  contextOf: () => LayoutContext | null,
  options: LayoutRuntimeOptions,
): () => void {
  let applying = false;
  const refresh = (): void => {
    if (applying) return;
    applying = true;
    try {
      const layout = layoutOf();
      const context = contextOf();
      if (!layout || !context) return;
      const nodes = resolveNodes(root);
      const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
      const nodeIdByElement = new Map(nodes.map((node) => [node.element, node.nodeId]));
      for (const node of nodes) {
        const placement = layout.placements.find((entry) => sameContext(entry, context) && entry.nodeId === node.nodeId);
        if (!placement) continue;
        if (placement.locked && !options.production) continue;
        applyPlacement(node.element, placement);
      }
      for (const container of layout.containers) {
        if (!sameContext(container, context)) continue;
        const target = nodeById.get(container.nodeId);
        if (!target) continue;
        applyContainerOrder(target.element, container.order, nodeIdByElement);
      }
    } finally {
      applying = false;
    }
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-key', 'data-design-id', 'data-design-screen', 'data-design-target', 'data-design-format'],
  });
  return () => observer.disconnect();
}

export function observeLayout(root: HTMLElement, theme: ThemeDocument, context: LayoutContext): () => void {
  return createLayoutRuntime(root, () => theme.layout, () => context, { production: false });
}

function readProductionContext(root: HTMLElement): LayoutContext | null {
  const target = root.getAttribute('data-design-target');
  const screenId = root.getAttribute('data-design-screen');
  const format = root.getAttribute('data-design-format');
  if (!target || !screenId || !format) return null;
  if (!(DESIGN_TARGETS as readonly string[]).includes(target)) return null;
  if (!(DESIGN_FORMATS as readonly string[]).includes(format)) return null;
  return { target: target as DesignTarget, screenId, format: format as DesignFormat };
}

export function observeProductionLayout(root: HTMLElement): () => void {
  return createLayoutRuntime(root, () => PRODUCTION_LAYOUT, () => readProductionContext(root), { production: true });
}
