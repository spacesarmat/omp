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
const LARGE_TEXT_BOLD_MIN_FONT_PX = 29;
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

function readStyles(element: HTMLElement, interactive: boolean): GeometryNodeStyle {
  const base = getComputedStyle(element);
  // jsdom accepts a pseudo-class argument but ignores it and logs a console error, so the focus
  // styles are read there only from the base styles - a focused element already carries its
  // :focus rules in them. Real browsers force the :focus state through the pseudo argument.
  const readFocus = interactive && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);
  const focused = readFocus ? focusStyles(element) : base;
  return {
    fontSize: Number.parseFloat(base.fontSize) || 0,
    fontWeight: fontWeightValue(base.fontWeight || ''),
    color: base.color || '',
    backgroundColor: base.backgroundColor || '',
    display: base.display || '',
    visibility: base.visibility || '',
    opacity: base.opacity || '',
    outlineStyle: base.outlineStyle || '',
    outlineWidth: outlineWidthPx(base.outlineWidth || ''),
    boxShadow: base.boxShadow || '',
    focusOutlineStyle: focused.outlineStyle || '',
    focusOutlineWidth: outlineWidthPx(focused.outlineWidth || ''),
    focusBoxShadow: focused.boxShadow || '',
  };
}

function focusStyles(element: HTMLElement): CSSStyleDeclaration {
  try {
    return getComputedStyle(element, ':focus');
  } catch {
    return getComputedStyle(element);
  }
}

// The descriptor walk in collectLayoutNodes pairs with a plain pre-order element walk, so the
// same pairing here keeps node identity identical to the editor canvas and the layout runtime.
export function collectGeometrySnapshot(root: HTMLElement, init: GeometrySnapshotInit): GeometrySnapshot {
  const rootBox = root.getBoundingClientRect();
  const scale = rootBox.width > 0 ? init.viewport.width / rootBox.width : 1;
  const elements: HTMLElement[] = [];
  const visit = (element: HTMLElement): void => {
    elements.push(element);
    for (const child of element.children) visit(child as HTMLElement);
  };
  visit(root);
  const nodes = collectLayoutNodes(root);
  const snapshotNodes: GeometryNodeSnapshot[] = [];
  nodes.forEach((node, index) => {
    const element = elements[index];
    if (!element) return;
    const box = element.getBoundingClientRect();
    const interactive = isInteractive(element);
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
      styles: readStyles(element, interactive),
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
  const checked = snapshot.nodes.filter((node) => !isHidden(node) && !hiddenPlacements.has(node.nodeId));
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
          && (node.styles.fontWeight >= LARGE_TEXT_MIN_WEIGHT || node.styles.fontSize >= LARGE_TEXT_BOLD_MIN_FONT_PX);
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
    if (rect.x < -SUB_PIXEL_EPSILON
      || rect.y < -SUB_PIXEL_EPSILON
      || rect.x + rect.width > snapshot.viewport.width + SUB_PIXEL_EPSILON
      || rect.y + rect.height > snapshot.viewport.height + SUB_PIXEL_EPSILON) {
      issues.push({
        code: 'OVERFLOW',
        nodeId: node.nodeId,
        severity: 'error',
        message: `rect extends beyond the ${snapshot.viewport.width}x${snapshot.viewport.height} viewport`,
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
