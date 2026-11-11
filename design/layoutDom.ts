import {
  DESIGN_FORMATS,
  DESIGN_TARGETS,
  type DesignFormat,
  type DesignTarget,
  type LayoutClone,
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

type IdentitySource = 'key' | 'adapter' | 'path' | 'clone';

interface IdentityCandidate {
  nodeId: string;
  kind: LayoutNodeKind;
  source: IdentitySource;
}

// Node ids must stay inside the schema id space /^[a-z0-9][a-z0-9-]{0,63}$/ so a layout document
// that references them round-trips through parseThemeDocument. Safe data keys stay literal;
// unsafe or long ones get a deterministic hash fallback (prefixes key- and keyh- are disjoint).
const SAFE_DATA_KEY = /^[a-z0-9][a-z0-9-]*$/;
const SCHEMA_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function layoutKeyNodeId(dataKey: string): string {
  if (SAFE_DATA_KEY.test(dataKey) && `key-${dataKey}`.length <= 64) return `key-${dataKey}`;
  return `keyh-${fnv1a64(dataKey)}`;
}

function pathNodeId(indices: number[]): string {
  return indices.length ? `path-${indices.join('-')}` : 'path-root';
}

function identityOf(element: HTMLElement, indices: number[], seenKeys: Set<string>, adapterCounts: Map<string, number>): IdentityCandidate {
  // Clone roots stamped by the layout runtime carry an explicit schema-safe node id; they win
  // over every other identity source so a clone is addressable by its own record.
  const cloneId = element.dataset.layoutId;
  if (cloneId && SCHEMA_ID.test(cloneId)) return { nodeId: cloneId, kind: 'element', source: 'clone' };
  const key = element.dataset.key;
  if (key) {
    if (seenKeys.has(key)) throw new Error(`duplicate data key "${key}"`);
    seenKeys.add(key);
    return { nodeId: layoutKeyNodeId(key), kind: 'dynamic', source: 'key' };
  }
  const adapter = element.dataset.designId || element.dataset.designComponent || null;
  if (adapter) {
    const count = (adapterCounts.get(adapter) ?? 0) + 1;
    adapterCounts.set(adapter, count);
    return { nodeId: count === 1 ? adapter : `${adapter}-${count}`, kind: 'element', source: 'adapter' };
  }
  return { nodeId: pathNodeId(indices), kind: 'element', source: 'path' };
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
  const visit = (element: HTMLElement, parentId: string | null, indices: number[]): void => {
    const candidate = identityOf(element, indices, seenKeys, adapterCounts);
    const elementId = element.dataset.designId || element.dataset.designComponent || candidate.nodeId;
    nodes.push({ element, nodeId: candidate.nodeId, elementId, parentId, kind: candidate.kind });
    let childIndex = 0;
    for (const child of element.children) {
      visit(child as HTMLElement, candidate.nodeId, [...indices, childIndex]);
      childIndex += 1;
    }
  };
  visit(root, null, []);
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

const CLONE_BLOCKED_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);
const CLONE_STRIP_ATTRIBUTES = ['data-key', 'data-layout-id', 'data-layout-clone'];

// Clone snapshots copy real component markup only: scripts, embedded content, inline handlers,
// javascript: URLs, per-node layout identity and baked placement styles never travel with a clone.
function sanitizeCloneElement(element: HTMLElement): void {
  const walk = (current: HTMLElement): void => {
    for (const child of [...current.children]) {
      const childElement = child as HTMLElement;
      if (CLONE_BLOCKED_TAGS.has(childElement.tagName)) {
        childElement.remove();
        continue;
      }
      walk(childElement);
    }
    for (const name of current.getAttributeNames()) {
      const lower = name.toLowerCase();
      const value = current.getAttribute(name) ?? '';
      if (lower.startsWith('on')
        || ((lower === 'href' || lower === 'src' || lower === 'xlink:href') && /^\s*javascript:/i.test(value))
        || CLONE_STRIP_ATTRIBUTES.includes(lower)
        || lower === 'style') {
        current.removeAttribute(name);
      }
    }
  };
  walk(element);
}

// Editor-side snapshot of a live preview element used for duplicate and clipboard html.
export function snapshotCloneHtml(source: HTMLElement): string {
  const copy = source.cloneNode(true) as HTMLElement;
  sanitizeCloneElement(copy);
  return copy.outerHTML;
}

function materializeCloneElement(clone: LayoutClone, doc: Document): HTMLElement | null {
  // Template parsing is inert: markup never executes while being materialized.
  const template = doc.createElement('template');
  template.innerHTML = clone.html.trim();
  const element = template.content.firstElementChild;
  if (!(element instanceof HTMLElement)) return null;
  sanitizeCloneElement(element);
  element.dataset.layoutId = clone.nodeId;
  element.dataset.layoutClone = clone.nodeId;
  return element;
}

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
  const syncClones = (layout: LayoutDocument, context: LayoutContext): void => {
    const clones = (layout.clones ?? []).filter((clone) => sameContext(clone, context));
    const active = new Set(clones.map((clone) => clone.nodeId));
    for (const stale of [...root.querySelectorAll('[data-layout-clone]')]) {
      if (!active.has(stale.getAttribute('data-layout-clone')!)) stale.remove();
    }
    if (!clones.length) return;
    const elementById = new Map(resolveNodes(root).map((node) => [node.nodeId, node.element]));
    for (const clone of clones) {
      if (elementById.has(clone.nodeId)) continue;
      const parent = elementById.get(clone.parentId) ?? root;
      const element = materializeCloneElement(clone, root.ownerDocument);
      if (element) parent.appendChild(element);
    }
  };
  const refresh = (): void => {
    if (applying) return;
    applying = true;
    try {
      const layout = layoutOf();
      const context = contextOf();
      if (!layout || !context) return;
      syncClones(layout, context);
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

const observedProductionRoots = new WeakSet<HTMLElement>();

export function observeProductionLayout(root: HTMLElement): () => void {
  if (observedProductionRoots.has(root)) return () => undefined;
  observedProductionRoots.add(root);
  const stop = createLayoutRuntime(root, () => PRODUCTION_LAYOUT, () => readProductionContext(root), { production: true });
  return () => {
    observedProductionRoots.delete(root);
    stop();
  };
}
