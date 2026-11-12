import {
  DESIGN_FORMATS,
  DESIGN_TARGETS,
  type DesignFormat,
  type DesignTarget,
  type LayoutClone,
  type LayoutContainer,
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

type IdentitySource = 'key' | 'anchor' | 'adapter' | 'path' | 'clone' | 'stamp';

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

// One registered root contract: preview shells mark the element the layout runtime applies from
// and every collector (editor canvas, compare workspace, geometry checks) resolves that same
// element, so path-based node ids are identical for collection and application.
export const LAYOUT_ROOT_ATTRIBUTE = 'data-design-root';

export function registerLayoutRoot(element: HTMLElement): HTMLElement {
  element.setAttribute(LAYOUT_ROOT_ATTRIBUTE, '');
  return element;
}

export function layoutRootOf(doc: Document): HTMLElement | null {
  const registered = doc.querySelector(`[${LAYOUT_ROOT_ATTRIBUTE}]`);
  if (registered) return registered as HTMLElement;
  return doc.body ?? null;
}

// FNV-1a 64-bit computed on two 32-bit halves: arbitrary-precision integer literals and
// String.prototype.padStart are unavailable in the oldest supported TV and webOS builds, so
// nothing here may rely on them. The output matches the reference 64-bit hash bit for bit.
function fnv1a64(text: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    lo = (lo ^ code) >>> 0;
    const hiTerm = (Math.imul(hi, 435) + Math.imul(lo, 256)) >>> 0;
    const lowFull = lo * 435;
    lo = lowFull >>> 0;
    hi = (hiTerm + Math.floor(lowFull / 4294967296)) >>> 0;
  }
  let hexHi = hi.toString(16);
  let hexLo = lo.toString(16);
  while (hexHi.length < 8) hexHi = `0${hexHi}`;
  while (hexLo.length < 8) hexLo = `0${hexLo}`;
  return hexHi + hexLo;
}

export function layoutKeyNodeId(dataKey: string): string {
  if (SAFE_DATA_KEY.test(dataKey) && `key-${dataKey}`.length <= 64) return `key-${dataKey}`;
  return `keyh-${fnv1a64(dataKey)}`;
}

function pathNodeId(indices: number[]): string {
  return indices.length ? `path-${indices.join('-')}` : 'path-root';
}

// Remembered identities keep node ids attached to their element between mutations: reordering the
// DOM must not swap adapter or path ids onto other elements. WeakMap keys are the elements
// themselves, so entries disappear together with detached markup.
const identityCache = new WeakMap<HTMLElement, IdentityCandidate>();

// Every resolved identity is stamped onto its element as data-layout-node: the editor canvas runs
// in a separate module realm and reads the stamp, so runtime and editor share one id per element
// no matter which realm walks the tree first.
function identityOf(
  element: HTMLElement,
  indices: number[],
  seenKeys: Set<string>,
  usedIds: Set<string>,
  adapterCounts: Map<string, number>,
): IdentityCandidate {
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
  // Real lists stamp their stable item key on the markup (data-anchor, e.g. a torrent hash):
  // Preact keys never reach the DOM, so without this read a reorder would remap saved edits
  // onto the wrong item through path ids. The anchor wins over stamps and remembered ids, so
  // identity stays attached to the real item data in every module realm.
  const anchor = element.dataset.anchor;
  if (anchor) {
    if (seenKeys.has(anchor)) throw new Error(`duplicate data anchor "${anchor}"`);
    seenKeys.add(anchor);
    return { nodeId: layoutKeyNodeId(anchor), kind: 'dynamic', source: 'anchor' };
  }
  const stamped = element.dataset.layoutNode;
  if (stamped && SCHEMA_ID.test(stamped)) return { nodeId: stamped, kind: 'element', source: 'stamp' };
  const remembered = identityCache.get(element);
  if (remembered) return remembered;
  const adapter = element.dataset.designId || element.dataset.designComponent || null;
  if (adapter) {
    let count = adapterCounts.get(adapter) ?? 0;
    let nodeId = '';
    do {
      count += 1;
      nodeId = count === 1 ? adapter : `${adapter}-${count}`;
    } while (usedIds.has(nodeId));
    adapterCounts.set(adapter, count);
    return { nodeId, kind: 'element', source: 'adapter' };
  }
  let nodeId = pathNodeId(indices);
  if (usedIds.has(nodeId)) {
    const bumped = indices.length ? [...indices] : [0];
    do {
      bumped[bumped.length - 1] += 1;
      nodeId = pathNodeId(bumped);
    } while (usedIds.has(nodeId));
  }
  return { nodeId, kind: 'element', source: 'path' };
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
  const usedIds = new Set<string>();
  const adapterCounts = new Map<string, number>();
  // Reserve every remembered or stamped identity before assigning fresh adapter or path ids, so
  // a reordered element keeps its id and no fresh element can collide with a remembered one.
  const reserve = (element: HTMLElement): void => {
    const remembered = identityCache.get(element);
    if (remembered) usedIds.add(remembered.nodeId);
    const stamped = element.dataset.layoutNode;
    if (stamped && SCHEMA_ID.test(stamped)) usedIds.add(stamped);
    for (const child of element.children) reserve(child as HTMLElement);
  };
  reserve(root);
  const visit = (element: HTMLElement, parentId: string | null, indices: number[]): void => {
    const candidate = identityOf(element, indices, seenKeys, usedIds, adapterCounts);
    identityCache.set(element, candidate);
    usedIds.add(candidate.nodeId);
    if (element.dataset.layoutNode !== candidate.nodeId) element.dataset.layoutNode = candidate.nodeId;
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

// Runtime-managed inline properties. User values are snapshotted before the first managed write
// and restored when the managing record stops applying, so undo, context switches and cleanup
// never delete styles that did not come from the layout runtime.
const PLACEMENT_STYLE_PROPS = ['position', 'left', 'right', 'top', 'bottom', 'width', 'height', 'z-index', 'margin', 'display'] as const;
const CONTAINER_STYLE_PROPS = ['display', 'flex-direction', 'align-items', 'justify-content', 'padding'] as const;
const MANAGED_STYLE_PROPS = [...new Set<string>([...PLACEMENT_STYLE_PROPS, ...CONTAINER_STYLE_PROPS])];

// TV CSS restrictions allow plain flexbox here: no flex gap, no aspect-ratio, no inset, no :has.
const FLEX_ALIGNMENT = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;
const FLEX_DISTRIBUTION = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  'space-between': 'space-between',
  'space-around': 'space-around',
} as const;

const originalInlineStyles = new WeakMap<HTMLElement, Map<string, string>>();

function snapshotInlineStyles(element: HTMLElement): void {
  if (originalInlineStyles.has(element)) return;
  const saved = new Map<string, string>();
  for (const prop of MANAGED_STYLE_PROPS) saved.set(prop, element.style.getPropertyValue(prop));
  originalInlineStyles.set(element, saved);
}

function restoreInlineStyles(element: HTMLElement): boolean {
  const saved = originalInlineStyles.get(element);
  if (!saved) return false;
  for (const [prop, value] of saved) {
    if (value) element.style.setProperty(prop, value);
    else element.style.removeProperty(prop);
  }
  return true;
}

function releaseManagedElement(element: HTMLElement): void {
  restoreInlineStyles(element);
  originalInlineStyles.delete(element);
  delete element.dataset.layoutManaged;
  delete element.dataset.layoutHidden;
  delete element.dataset.layoutMode;
}

const CLONE_BLOCKED_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);
const CLONE_STRIP_ATTRIBUTES = ['data-key', 'data-anchor', 'data-layout-id', 'data-layout-clone', 'data-layout-node'];

// Clone snapshots copy real component markup only: scripts, embedded content, inline handlers,
// javascript: URLs, per-node layout identity, item anchors and baked placement styles never
// travel with a clone (a copied anchor would read as a duplicate of the original item).
// The root itself must be a renderable tag as well, never a live script or embedded document.
function sanitizeCloneElement(element: HTMLElement): HTMLElement | null {
  if (CLONE_BLOCKED_TAGS.has(element.tagName)) return null;
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
  return element;
}

// Editor-side snapshot of a live preview element used for duplicate and clipboard html.
export function snapshotCloneHtml(source: HTMLElement): string {
  const copy = source.cloneNode(true) as HTMLElement;
  return sanitizeCloneElement(copy)?.outerHTML ?? '';
}

function materializeCloneElement(clone: LayoutClone, doc: Document): HTMLElement | null {
  // Template parsing is inert: markup never executes while being materialized.
  const template = doc.createElement('template');
  template.innerHTML = clone.html.trim();
  const element = template.content.firstElementChild;
  if (!(element instanceof HTMLElement)) return null;
  const sanitized = sanitizeCloneElement(element);
  if (!sanitized) return null;
  sanitized.dataset.layoutId = clone.nodeId;
  sanitized.dataset.layoutClone = clone.nodeId;
  return sanitized;
}

// Originals are restored exactly once per refresh, before any record writes, and reapplied on
// top: a node can carry both a container record and a placement record, and neither pass may
// wipe the fields the other one just set. The snapshot lives until the release pass.
function prepareManagedElement(element: HTMLElement): void {
  restoreInlineStyles(element);
  snapshotInlineStyles(element);
}

function resetManagedPlacement(element: HTMLElement): void {
  delete element.dataset.layoutManaged;
  delete element.dataset.layoutHidden;
}

// Absolute percent geometry is resolved against the nearest positioned ancestor. The layout
// parent is not necessarily positioned in the app CSS, so the runtime promotes it to a
// containing block itself: the property is set only when nothing else positions the element,
// it is flagged as runtime-owned and removed once no absolute child needs it anymore.
function ensureContainingBlock(element: HTMLElement, managed: Set<HTMLElement>): void {
  // The flag alone cannot be trusted across refreshes: a node's own placement rebuilds its
  // inline styles and wipes the runtime-owned position, so the actual value is checked every
  // time and a flagged but unpositioned parent is promoted again instead of being skipped.
  const inline = element.style.position;
  if (inline && inline !== 'static') {
    if (element.dataset.layoutParent === '1') managed.add(element);
    return;
  }
  let computed = '';
  try {
    computed = typeof getComputedStyle === 'function' ? getComputedStyle(element).position : '';
  } catch {
    computed = '';
  }
  if (computed && computed !== 'static') return;
  element.style.position = 'relative';
  element.dataset.layoutParent = '1';
  managed.add(element);
}

function releaseContainingBlocks(held: Set<HTMLElement>, managed: Set<HTMLElement>): void {
  for (const element of held) {
    if (managed.has(element)) continue;
    if (element.style.position === 'relative') element.style.removeProperty('position');
    delete element.dataset.layoutParent;
  }
  held.clear();
  for (const element of managed) held.add(element);
}

function applyPlacement(element: HTMLElement, placement: LayoutPlacement): void {
  // No style restore here: originals come back once per refresh in prepareManagedElement, so a
  // container record applied earlier in the same pass keeps its fields.
  resetManagedPlacement(element);
  element.dataset.layoutMode = placement.mode;
  if (placement.mode === 'absolute') {
    snapshotInlineStyles(element);
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
  if (placement.margin !== undefined) {
    snapshotInlineStyles(element);
    element.style.setProperty('margin', placement.margin);
  }
  if (placement.hidden) {
    snapshotInlineStyles(element);
    element.dataset.layoutHidden = '1';
    element.style.display = 'none';
  }
}

// Container layout speaks the schema vocabulary through plain flexbox properties that every
// supported platform renders: direction row or column, token-sized padding, alignment on the
// cross axis and distribution on the main axis. Direction auto and absent fields leave the real
// component styles untouched. The restore-once-per-refresh contract lives in the caller, so
// placement records applied after this pass never wipe these fields.
function applyContainerLayout(element: HTMLElement, container: LayoutContainer): void {
  snapshotInlineStyles(element);
  const direction = container.direction && container.direction !== 'auto' ? container.direction : '';
  if (direction) {
    element.style.display = 'flex';
    element.style.setProperty('flex-direction', direction);
  }
  if (container.alignment) {
    element.style.setProperty('align-items', FLEX_ALIGNMENT[container.alignment]);
  }
  if (container.distribution) {
    element.style.setProperty('justify-content', FLEX_DISTRIBUTION[container.distribution]);
  }
  if (container.padding !== undefined) {
    element.style.setProperty('padding', container.padding);
  }
}

// Original child order per container element, snapshotted before the first reorder and restored
// when the container record stops applying, so undo and orientation changes bring the document
// order back instead of leaving sorted markup behind.
const originalChildOrder = new WeakMap<HTMLElement, Element[]>();

function restoreContainerOrder(element: HTMLElement): void {
  const snapshot = originalChildOrder.get(element);
  if (!snapshot) return;
  originalChildOrder.delete(element);
  for (const child of snapshot) {
    if (child.parentElement === element) element.appendChild(child);
  }
}

// Nodes borrowed from another parent by a container order remember their origin, so the runtime
// moves them back once no active order lists them anymore.
const moveOrigins = new WeakMap<HTMLElement, { parent: HTMLElement; next: Element | null }>();

// One node has exactly one destination per refresh: container records are processed in array
// order and the first order claiming a node wins, so a crafted document that lists one node in
// two destination orders cannot bounce it between containers on every mutation.
function applyContainerOrder(
  containerElement: HTMLElement,
  container: LayoutContainer,
  nodeById: Map<string, ResolvedNode>,
  nodeIdByElement: Map<HTMLElement, string>,
  moved: Set<HTMLElement>,
  claimed: Set<string>,
): void {
  // Resolve the destination order first: nodes recorded in the order but living in another parent
  // move across parents before the in-parent sort runs. A recorded order must never move a node
  // into itself or into its own descendant: the DOM would throw HierarchyRequestError and leave
  // the tree half-updated, so the cycle is skipped instead.
  for (const nodeId of container.order) {
    if (claimed.has(nodeId)) continue;
    const node = nodeById.get(nodeId);
    if (!node || node.element.parentElement === containerElement) continue;
    if (node.element === containerElement || node.element.contains(containerElement)) continue;
    if (!moveOrigins.has(node.element)) {
      moveOrigins.set(node.element, { parent: node.element.parentElement!, next: node.element.nextElementSibling });
    }
    containerElement.appendChild(node.element);
    moved.add(node.element);
  }
  for (const nodeId of container.order) claimed.add(nodeId);
  const children = [...containerElement.children] as HTMLElement[];
  if (children.length < 2) return;
  const rank = new Map(container.order.map((nodeId, index) => [nodeId, index]));
  const sorted = [...children].sort((a, b) => {
    const aRank = rank.get(nodeIdByElement.get(a) ?? '') ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(nodeIdByElement.get(b) ?? '') ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
  for (let index = 0; index < children.length; index += 1) {
    if (sorted[index] !== children[index]) {
      if (!originalChildOrder.has(containerElement)) originalChildOrder.set(containerElement, [...containerElement.children]);
      for (const child of sorted) containerElement.appendChild(child);
      return;
    }
  }
}

function sameContext(entry: LayoutContext, context: LayoutContext): boolean {
  return entry.target === context.target && entry.screenId === context.screenId && entry.format === context.format;
}

function createLayoutRuntime(
  root: HTMLElement,
  layoutOf: () => LayoutDocument | undefined,
  contextOf: () => LayoutContext | null,
): () => void {
  let applying = false;
  const heldParents = new Set<HTMLElement>();
  let managedElements = new Set<HTMLElement>();
  let managedContainers = new Set<HTMLElement>();
  const movedNodes = new Set<HTMLElement>();
  registerLayoutRoot(root);
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
      const matchingContainers = layout.containers.filter((container) => sameContext(container, context));
      let nodes = resolveNodes(root);
      let nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
      let nodeIdByElement = new Map(nodes.map((node) => [node.element, node.nodeId]));
      const placementByNode = new Map<string, LayoutPlacement>();
      for (const node of nodes) {
        const placement = layout.placements.find((entry) => sameContext(entry, context) && entry.nodeId === node.nodeId);
        if (placement) placementByNode.set(node.nodeId, placement);
      }
      // Originals come back exactly once per refresh and before any managed write: container and
      // placement records frequently share one element, and neither pass may reset the fields the
      // other one applies.
      for (const container of matchingContainers) {
        const target = nodeById.get(container.nodeId);
        if (target) prepareManagedElement(target.element);
      }
      for (const nodeId of placementByNode.keys()) {
        const target = nodeById.get(nodeId);
        if (target) prepareManagedElement(target.element);
      }
      const touched = new Set<HTMLElement>();
      const touchedContainers = new Set<HTMLElement>();
      const claimedDestinations = new Set<string>();
      // Containers run first: cross-parent moves change parenthood, and the second resolution
      // below pairs placements with the updated tree. Node ids stay stable across the moves.
      for (const container of matchingContainers) {
        const target = nodeById.get(container.nodeId);
        if (!target) continue;
        applyContainerOrder(target.element, container, nodeById, nodeIdByElement, movedNodes, claimedDestinations);
        applyContainerLayout(target.element, container);
        touched.add(target.element);
        touchedContainers.add(target.element);
      }
      nodes = resolveNodes(root);
      nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
      nodeIdByElement = new Map(nodes.map((node) => [node.element, node.nodeId]));
      // Return borrowed nodes whose id no active container order lists anymore.
      const activeOrder = new Set<string>();
      for (const container of matchingContainers) {
        for (const nodeId of container.order) activeOrder.add(nodeId);
      }
      for (const element of [...movedNodes]) {
        const nodeId = nodeIdByElement.get(element);
        if (nodeId && activeOrder.has(nodeId)) continue;
        movedNodes.delete(element);
        const origin = moveOrigins.get(element);
        moveOrigins.delete(element);
        if (!origin || !origin.parent.isConnected) continue;
        if (origin.next && origin.next.parentElement === origin.parent) origin.parent.insertBefore(element, origin.next);
        else origin.parent.appendChild(element);
      }
      const activeParents = new Set<HTMLElement>();
      for (const node of nodes) {
        // Locked records still apply in every runtime: the lock only blocks editor edits, it
        // must never reset the saved appearance or hidden state in the preview.
        const placement = placementByNode.get(node.nodeId);
        if (!placement) continue;
        applyPlacement(node.element, placement);
        touched.add(node.element);
        if (placement.mode === 'absolute' && node.element.parentElement) {
          ensureContainingBlock(node.element.parentElement, activeParents);
        }
      }
      releaseContainingBlocks(heldParents, activeParents);
      // Records that stopped applying release their managed state: undo of the first hide or
      // absolute placement and orientation switches restore original inline styles and the
      // original document order.
      for (const element of managedElements) {
        if (!touched.has(element)) releaseManagedElement(element);
      }
      managedElements = touched;
      for (const element of managedContainers) {
        if (!touchedContainers.has(element)) restoreContainerOrder(element);
      }
      managedContainers = touchedContainers;
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
    attributeFilter: ['data-key', 'data-design-id', 'data-design-component', 'data-design-screen', 'data-design-target', 'data-design-format'],
  });
  return () => {
    observer.disconnect();
    releaseContainingBlocks(heldParents, new Set());
  };
}

export function observeLayout(root: HTMLElement, theme: ThemeDocument, context: LayoutContext): () => void {
  return createLayoutRuntime(root, () => theme.layout, () => context);
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
  const stop = createLayoutRuntime(root, () => PRODUCTION_LAYOUT, () => readProductionContext(root));
  return () => {
    observedProductionRoots.delete(root);
    stop();
  };
}
