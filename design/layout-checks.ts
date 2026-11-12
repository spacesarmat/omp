import type { DesignFormat, DesignTarget, ThemeDocument } from './schema.ts';
import { collectLayoutNodes } from './layoutDom.ts';
import { resolveThemeTokens } from './theme.ts';

// Accessibility and geometry lint rules run on a GeometrySnapshot collected from the live
// preview DOM: rects come from getBoundingClientRect and typography/colors from real computed
// styles, never from placement text, so the checks measure what users would actually see.
export const TV_MIN_FONT_PX = 24;
export const MIN_TARGET_SIZE_PX = 24;
export const TV_SAFE_AREA_RATIO = 0.05;
export const CONTRAST_MIN_RATIO = 4.5;
export const CONTRAST_MIN_LARGE_TEXT_RATIO = 3;
const LARGE_TEXT_MIN_FONT_PX = 24;
const LARGE_TEXT_MIN_WEIGHT = 700;
const LARGE_TEXT_BOLD_MIN_FONT_PX = 18.67;
const SUB_PIXEL_EPSILON = 0.5;

export type LayoutIssueCode =
  | 'CONTRAST'
  | 'TV_FONT_SIZE'
  | 'FOCUS_INDICATION'
  | 'TARGET_SIZE'
  | 'OVERFLOW'
  | 'OVERLAP'
  | 'SAFE_AREA';

export interface LayoutIssue {
  code: LayoutIssueCode;
  nodeId: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeometryNodeStyle {
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  display: string;
  visibility: string;
  opacity: string;
  outlineStyle: string;
  outlineWidth: number;
  boxShadow: string;
  focusOutlineStyle: string;
  focusOutlineWidth: number;
  focusBoxShadow: string;
}

export interface GeometryNodeSnapshot {
  nodeId: string;
  elementId: string;
  parentId: string | null;
  label: string;
  kind: 'element' | 'dynamic';
  interactive: boolean;
  hasText: boolean;
  rect: GeometryRect;
  styles: GeometryNodeStyle;
  // Whether an ancestor clips this node's overflow on each axis (nearest clipping ancestor's
  // nodeId), so offscreen content of scroll rows and carousels is not mistaken for viewport
  // overflow: the part beyond the viewport is clipped away and the user never sees it cut.
  clip: { x: boolean; y: boolean; ancestorId: string | null };
}

export interface GeometrySnapshot {
  target: DesignTarget;
  screenId: string;
  format: DesignFormat;
  viewport: { width: number; height: number };
  nodes: GeometryNodeSnapshot[];
}

export interface GeometrySnapshotInit {
  target: DesignTarget;
  screenId: string;
  format: DesignFormat;
  viewport: { width: number; height: number };
}

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'option',
  'slider',
  'spinbutton',
  'searchbox',
  'textbox',
]);

function isInteractive(element: HTMLElement): boolean {
  if (INTERACTIVE_TAGS.has(element.tagName)) return true;
  const role = element.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  return element.hasAttribute('tabindex');
}

function hasDirectText(element: HTMLElement): boolean {
  for (const child of element.childNodes) {
    if (child.nodeType === 3 && (child.textContent ?? '').trim()) return true;
  }
  return false;
}

function outlineWidthPx(value: string): number {
  const keywords: Record<string, number> = { thin: 1, medium: 3, thick: 5 };
  if (value in keywords) return keywords[value];
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fontWeightValue(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return value === 'bold' ? 700 : 400;
}

// Browsers only expose :focus rules while an element really holds focus, but a real focus fires
// focusin handlers, opens the phone keypad on inputs and can scroll the page. Probe rules instead
// copy every matching :focus rule with the pseudo-class swapped for a plain class: the focused
// styles compute for the probed element without any of those side effects, and the cascade order
// is preserved by inserting each probe right after its source rule.
const FOCUS_PROBE_CLASS = 'editor-focus-probe';
const FOCUS_PSEUDO = /:(focus-visible|focus)\b/g;

interface FocusProbeStyles {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}

function focusProbeStyles(doc: Document, element: HTMLElement): FocusProbeStyles {
  interface ProbeRule {
    parent: CSSStyleSheet | CSSGroupingRule;
    index: number;
    css: string;
  }
  const matches: ProbeRule[] = [];
  const collect = (rules: CSSRuleList): void => {
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText.includes(':focus')) continue;
        const selector = rule.selectorText.replace(FOCUS_PSEUDO, `.${FOCUS_PROBE_CLASS}`);
        const parent = (rule.parentRule ?? rule.parentStyleSheet) as CSSStyleSheet | CSSGroupingRule;
        matches.push({ parent, index, css: `${selector} { ${rule.style.cssText} }` });
      } else if (rule instanceof CSSGroupingRule && rule.cssRules.length) {
        collect(rule.cssRules);
      }
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      collect(sheet.cssRules);
    } catch {
      // Cross-origin sheets stay unreadable; their focus rules cannot be probed.
    }
  }
  const inserted: { parent: CSSStyleSheet | CSSGroupingRule; index: number }[] = [];
  // Reverse order keeps the stored indices valid while inserting right after each source rule.
  for (const match of [...matches].reverse()) {
    try {
      match.parent.insertRule(match.css, match.index + 1);
      inserted.push({ parent: match.parent, index: match.index + 1 });
    } catch {
      // An unsupported selector stays unread, exactly as if the rule never matched.
    }
  }
  element.classList.add(FOCUS_PROBE_CLASS);
  try {
    const computed = getComputedStyle(element);
    return { outlineStyle: computed.outlineStyle || '', outlineWidth: computed.outlineWidth || '', boxShadow: computed.boxShadow || '' };
  } finally {
    element.classList.remove(FOCUS_PROBE_CLASS);
    for (let index = inserted.length - 1; index >= 0; index -= 1) {
      try {
        inserted[index].parent.deleteRule(inserted[index].index);
      } catch {
        // The sheet may have changed while reading; leftover probes are removed on the next pass.
      }
    }
  }
}

// Interactive nodes carry their focused styles: the computed :focus rules were replicated with a
// probe class, so no real focus was needed to read them.
function readStyles(computed: CSSStyleDeclaration, focus: FocusProbeStyles | null): GeometryNodeStyle {
  return {
    fontSize: Number.parseFloat(computed.fontSize) || 0,
    fontWeight: fontWeightValue(computed.fontWeight || ''),
    color: computed.color || '',
    backgroundColor: computed.backgroundColor || '',
    display: computed.display || '',
    visibility: computed.visibility || '',
    opacity: computed.opacity || '',
    outlineStyle: computed.outlineStyle || '',
    outlineWidth: outlineWidthPx(computed.outlineWidth || ''),
    boxShadow: computed.boxShadow || '',
    focusOutlineStyle: focus ? focus.outlineStyle : '',
    focusOutlineWidth: focus ? outlineWidthPx(focus.outlineWidth) : 0,
    focusBoxShadow: focus ? focus.boxShadow : '',
  };
}

function usedOverflow(overflowX: string, overflowY: string): { x: string; y: string } {
  const clips = (value: string) => value !== '' && value !== 'visible';
  let x = overflowX || 'visible';
  let y = overflowY || 'visible';
  // Spec used-value rule: an axis specified as visible next to a clipping axis computes to
  // auto, so such an element clips both axes. jsdom reports specified values, so the rule is
  // applied here; engines that already return used values pass through unchanged.
  if (x === 'visible' && clips(y)) x = 'auto';
  if (y === 'visible' && clips(x)) y = 'auto';
  return { x, y };
}

// The descriptor walk in collectLayoutNodes pairs with a plain pre-order element walk, so the
// same pairing here keeps node identity identical to the editor canvas and the layout runtime.
export function collectGeometrySnapshot(root: HTMLElement, init: GeometrySnapshotInit): GeometrySnapshot {
  const rootBox = root.getBoundingClientRect();
  const scale = rootBox.width > 0 ? init.viewport.width / rootBox.width : 1;
  const elements: HTMLElement[] = [];
  const computedList: CSSStyleDeclaration[] = [];
  const focusList: (FocusProbeStyles | null)[] = [];
  const clipList: { x: boolean; y: boolean; ancestor: HTMLElement | null }[] = [];
  const visit = (
    element: HTMLElement,
    inherited: { x: boolean; y: boolean; ancestor: HTMLElement | null },
  ): void => {
    const computed = getComputedStyle(element);
    const focus = isInteractive(element) ? focusProbeStyles(root.ownerDocument, element) : null;
    const overflow = usedOverflow(computed.overflowX || '', computed.overflowY || '');
    const clipsX = overflow.x !== 'visible';
    const clipsY = overflow.y !== 'visible';
    elements.push(element);
    computedList.push(computed);
    focusList.push(focus);
    clipList.push(inherited);
    const next = {
      x: inherited.x || clipsX,
      y: inherited.y || clipsY,
      ancestor: clipsX || clipsY ? element : inherited.ancestor,
    };
    for (const child of element.children) visit(child as HTMLElement, next);
  };
  visit(root, { x: false, y: false, ancestor: null });
  const nodes = collectLayoutNodes(root);
  const nodeIdByElement = new Map<HTMLElement, string>();
  const snapshotNodes: GeometryNodeSnapshot[] = [];
  nodes.forEach((node, index) => {
    const element = elements[index];
    if (!element) return;
    nodeIdByElement.set(element, node.nodeId);
    const box = element.getBoundingClientRect();
    const interactive = isInteractive(element);
    const clip = clipList[index];
    snapshotNodes.push({
      nodeId: node.nodeId,
      elementId: node.elementId,
      parentId: node.parentId,
      label: node.label,
      kind: node.kind,
      interactive,
      hasText: hasDirectText(element),
      rect: {
        x: (box.left - rootBox.left) * scale,
        y: (box.top - rootBox.top) * scale,
        width: box.width * scale,
        height: box.height * scale,
      },
      styles: readStyles(computedList[index], focusList[index]),
      clip: {
        x: clip.x,
        y: clip.y,
        ancestorId: clip.ancestor ? nodeIdByElement.get(clip.ancestor) ?? null : null,
      },
    });
  });
  return {
    target: init.target,
    screenId: init.screenId,
    format: init.format,
    viewport: init.viewport,
    nodes: snapshotNodes,
  };
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): RgbaColor | null {
  const text = value.trim().toLowerCase();
  if (!text || text === 'transparent' || text === 'none' || text === 'currentcolor') return null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((char) => char + char).join('');
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number.parseFloat(part));
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1 };
  }
  return null;
}

function luminance(color: RgbaColor): number {
  const channel = (value: number): number => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function isTvTarget(target: DesignTarget): boolean {
  return target === 'android-tv' || target === 'lg-webos';
}

function isHidden(node: GeometryNodeSnapshot): boolean {
  const styles = node.styles;
  return styles.display === 'none'
    || styles.visibility === 'hidden'
    || styles.visibility === 'collapse'
    || Number.parseFloat(styles.opacity) === 0;
}

function effectiveBackground(snapshot: GeometrySnapshot, node: GeometryNodeSnapshot, fallback: string): string {
  const byId = new Map(snapshot.nodes.map((entry) => [entry.nodeId, entry]));
  let current: GeometryNodeSnapshot | undefined = node;
  while (current) {
    const color = parseColor(current.styles.backgroundColor);
    if (color && color.a > 0) return current.styles.backgroundColor;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return fallback;
}

function outlineVisible(outlineStyle: string, outlineWidth: number): boolean {
  if (outlineStyle === '' || outlineStyle === 'none') return false;
  if (outlineStyle === 'auto') return true;
  return outlineWidth > 0;
}

function shadowVisible(boxShadow: string): boolean {
  return boxShadow !== '' && boxShadow !== 'none';
}

function hasFocusIndication(node: GeometryNodeSnapshot): boolean {
  const styles = node.styles;
  return outlineVisible(styles.outlineStyle, styles.outlineWidth)
    || shadowVisible(styles.boxShadow)
    || outlineVisible(styles.focusOutlineStyle, styles.focusOutlineWidth)
    || shadowVisible(styles.focusBoxShadow);
}

function rectsIntersect(first: GeometryRect, second: GeometryRect): boolean {
  return first.x + first.width > second.x + SUB_PIXEL_EPSILON
    && second.x + second.width > first.x + SUB_PIXEL_EPSILON
    && first.y + first.height > second.y + SUB_PIXEL_EPSILON
    && second.y + second.height > first.y + SUB_PIXEL_EPSILON;
}

function safeAreaFor(viewport: { width: number; height: number }): GeometryRect {
  const insetX = Math.round(viewport.width * TV_SAFE_AREA_RATIO);
  const insetY = Math.round(viewport.height * TV_SAFE_AREA_RATIO);
  return {
    x: insetX,
    y: insetY,
    width: viewport.width - insetX * 2,
    height: viewport.height - insetY * 2,
  };
}

function rectInside(rect: GeometryRect, bounds: GeometryRect): boolean {
  return rect.x >= bounds.x - SUB_PIXEL_EPSILON
    && rect.y >= bounds.y - SUB_PIXEL_EPSILON
    && rect.x + rect.width <= bounds.x + bounds.width + SUB_PIXEL_EPSILON
    && rect.y + rect.height <= bounds.y + bounds.height + SUB_PIXEL_EPSILON;
}

// Full-viewport nodes are the screen backdrop, not focusable content: they legitimately paint
// across the overscan margins, so the safe area rule never applies to them.
function spansViewport(rect: GeometryRect, viewport: { width: number; height: number }): boolean {
  return rect.x <= SUB_PIXEL_EPSILON
    && rect.y <= SUB_PIXEL_EPSILON
    && rect.x + rect.width >= viewport.width - SUB_PIXEL_EPSILON
    && rect.y + rect.height >= viewport.height - SUB_PIXEL_EPSILON;
}

export function checkLayoutAccessibility(snapshot: GeometrySnapshot, theme: ThemeDocument): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const hiddenPlacements = new Set(
    (theme.layout?.placements ?? [])
      .filter((placement) => placement.target === snapshot.target
        && placement.screenId === snapshot.screenId
        && placement.format === snapshot.format
        && placement.hidden)
      .map((placement) => placement.nodeId),
  );
  const nodeById = new Map(snapshot.nodes.map((entry) => [entry.nodeId, entry]));
  // A node is skipped when it or any ancestor is hidden, either by computed styles or by a
  // hidden placement: children of an invisible container are invisible too and must never block
  // the export with errors the user cannot see.
  const isSkipped = (node: GeometryNodeSnapshot): boolean => {
    let current: GeometryNodeSnapshot | undefined = node;
    while (current) {
      if (isHidden(current) || hiddenPlacements.has(current.nodeId)) return true;
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
    return false;
  };
  const checked = snapshot.nodes.filter((node) => !isSkipped(node));
  const tokens = resolveThemeTokens(theme, {
    target: snapshot.target,
    screenId: snapshot.screenId,
    format: snapshot.format,
    state: 'default',
  });
  const fallbackBackground = tokens['--omp-color-background'] ?? '#ffffff';
  const tv = isTvTarget(snapshot.target);

  for (const node of checked) {
    if (node.hasText) {
      const foreground = parseColor(node.styles.color);
      const background = parseColor(effectiveBackground(snapshot, node, fallbackBackground));
      if (foreground && background) {
        const large = node.styles.fontSize >= LARGE_TEXT_MIN_FONT_PX
          || (node.styles.fontWeight >= LARGE_TEXT_MIN_WEIGHT && node.styles.fontSize >= LARGE_TEXT_BOLD_MIN_FONT_PX);
        const minimum = large ? CONTRAST_MIN_LARGE_TEXT_RATIO : CONTRAST_MIN_RATIO;
        const ratio = contrastRatio(foreground, background);
        if (ratio < minimum) {
          issues.push({
            code: 'CONTRAST',
            nodeId: node.nodeId,
            severity: 'error',
            message: `color ${node.styles.color} on ${effectiveBackground(snapshot, node, fallbackBackground)} has contrast ${ratio.toFixed(2)}:1, expected at least ${minimum}:1`,
          });
        }
      }
      if (tv && node.styles.fontSize > 0 && node.styles.fontSize < TV_MIN_FONT_PX) {
        issues.push({
          code: 'TV_FONT_SIZE',
          nodeId: node.nodeId,
          severity: 'error',
          message: `font size ${node.styles.fontSize}px is below the TV minimum ${TV_MIN_FONT_PX}px`,
        });
      }
    }
    if (node.interactive) {
      if (!hasFocusIndication(node)) {
        issues.push({
          code: 'FOCUS_INDICATION',
          nodeId: node.nodeId,
          severity: 'warning',
          message: 'interactive node has no visible outline or shadow for the focused state',
        });
      }
      if (node.rect.width < MIN_TARGET_SIZE_PX || node.rect.height < MIN_TARGET_SIZE_PX) {
        issues.push({
          code: 'TARGET_SIZE',
          nodeId: node.nodeId,
          severity: 'warning',
          message: `target size ${Math.round(node.rect.width)}x${Math.round(node.rect.height)}px is below the ${MIN_TARGET_SIZE_PX}px minimum`,
        });
      }
    }
    const rect = node.rect;
    const edges: string[] = [];
    if (!node.clip.x) {
      if (rect.x < -SUB_PIXEL_EPSILON) edges.push(`left edge ${Math.round(rect.x)} < 0`);
      if (rect.x + rect.width > snapshot.viewport.width + SUB_PIXEL_EPSILON) edges.push(`right edge ${Math.round(rect.x + rect.width)} > ${snapshot.viewport.width}`);
    }
    if (!node.clip.y) {
      if (rect.y < -SUB_PIXEL_EPSILON) edges.push(`top edge ${Math.round(rect.y)} < 0`);
      if (rect.y + rect.height > snapshot.viewport.height + SUB_PIXEL_EPSILON) edges.push(`bottom edge ${Math.round(rect.y + rect.height)} > ${snapshot.viewport.height}`);
    }
    if (edges.length > 0) {
      issues.push({
        code: 'OVERFLOW',
        nodeId: node.nodeId,
        severity: 'error',
        message: `rect extends beyond the ${snapshot.viewport.width}x${snapshot.viewport.height} viewport (${edges.join('; ')})`,
      });
    }
  }

  const interactive = checked.filter((node) => node.interactive);
  for (let index = 0; index < interactive.length; index += 1) {
    for (let other = index + 1; other < interactive.length; other += 1) {
      if (rectsIntersect(interactive[index].rect, interactive[other].rect)) {
        issues.push({
          code: 'OVERLAP',
          nodeId: interactive[other].nodeId,
          severity: 'warning',
          message: `"${interactive[other].nodeId}" overlaps interactive node "${interactive[index].nodeId}"`,
        });
      }
    }
  }

  if (tv) {
    const safeArea = safeAreaFor(snapshot.viewport);
    for (const node of checked) {
      if (spansViewport(node.rect, snapshot.viewport)) continue;
      if (node.rect.width <= SUB_PIXEL_EPSILON || node.rect.height <= SUB_PIXEL_EPSILON) continue;
      if (!rectInside(node.rect, safeArea)) {
        issues.push({
          code: 'SAFE_AREA',
          nodeId: node.nodeId,
          severity: 'warning',
          message: `rect leaves the TV safe area (${Math.round(TV_SAFE_AREA_RATIO * 100)}% overscan)`,
        });
      }
    }
  }
  return issues;
}
