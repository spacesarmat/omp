import type { DesignTarget } from '../../../design/schema.ts';
import { isTvTarget } from '../../shared/routes.ts';

// Guides and snapping are computed in native artboard pixels; the canvas applies zoom as a CSS
// transform, so rendering stays aligned at any zoom while decisions stay resolution independent.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GRID_SIZE = 8;
export const SNAP_THRESHOLD_PX = 6;
// TV overscan margin: the same fraction of the viewport on 1080p and 4K artboards.
export const TV_SAFE_AREA_RATIO = 0.05;

export interface GuideSettings {
  gridSize: number;
  snapThreshold: number;
  snapToGrid: boolean;
  snapToGuides: boolean;
  showGrid: boolean;
  showRulers: boolean;
}

export const DEFAULT_GUIDE_SETTINGS: GuideSettings = {
  gridSize: GRID_SIZE,
  snapThreshold: SNAP_THRESHOLD_PX,
  snapToGrid: false,
  snapToGuides: true,
  showGrid: false,
  showRulers: true,
};

export function resolveGuideSettings(patch: Partial<GuideSettings> = {}): GuideSettings {
  return { ...DEFAULT_GUIDE_SETTINGS, ...patch };
}

export type GuideKind = 'node' | 'safe-area' | 'artboard';

export interface GuideLine {
  axis: 'x' | 'y';
  position: number;
  kind: GuideKind;
}

export interface CollectGuideOptions {
  safeArea?: Rect | null;
  artboard?: Rect | null;
}

function frameGuides(rect: Rect, kind: GuideKind): GuideLine[] {
  return [
    { axis: 'x', position: rect.x, kind },
    { axis: 'x', position: rect.x + rect.width / 2, kind },
    { axis: 'x', position: rect.x + rect.width, kind },
    { axis: 'y', position: rect.y, kind },
    { axis: 'y', position: rect.y + rect.height / 2, kind },
    { axis: 'y', position: rect.y + rect.height, kind },
  ];
}

// Edges and centers of every given rect are snap targets; the safe area and the artboard itself
// join in with their own kinds so the renderer can tell them apart.
export function collectGuides(rects: Rect[], options: CollectGuideOptions = {}): GuideLine[] {
  const guides: GuideLine[] = [];
  for (const rect of rects) guides.push(...frameGuides(rect, 'node'));
  if (options.safeArea) guides.push(...frameGuides(options.safeArea, 'safe-area'));
  if (options.artboard) guides.push(...frameGuides(options.artboard, 'artboard'));
  return guides;
}

export interface SnapResult {
  x: number | null;
  y: number | null;
  lines: GuideLine[];
}

// Snaps the moving bounds (one rect per moving node, absolute artboard coordinates) to the
// nearest guide on each axis. Returns the corrected top-left position per axis, null when nothing
// is within the threshold, plus the matched lines for the renderer.
export function findSnap(position: { x: number; y: number }, movingRects: Rect[], guides: GuideLine[], threshold: number): SnapResult {
  const solve = (axis: 'x' | 'y'): { delta: number; line: GuideLine } | null => {
    let best: { delta: number; line: GuideLine } | null = null;
    for (const rect of movingRects) {
      const lead = axis === 'x' ? rect.x : rect.y;
      const size = axis === 'x' ? rect.width : rect.height;
      const candidates = [lead, lead + size / 2, lead + size];
      for (const candidate of candidates) {
        for (const guide of guides) {
          if (guide.axis !== axis) continue;
          const delta = guide.position - candidate;
          if (Math.abs(delta) > threshold) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line: guide };
        }
      }
    }
    return best;
  };
  const horizontal = solve('x');
  const vertical = solve('y');
  return {
    x: horizontal ? position.x + horizontal.delta : null,
    y: vertical ? position.y + vertical.delta : null,
    lines: [horizontal?.line, vertical?.line].filter((guide): guide is GuideLine => Boolean(guide)),
  };
}

export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  if (!(gridSize > 0)) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function artboardToScreen(point: { x: number; y: number }, zoom: number): { x: number; y: number } {
  const scale = zoom > 0 ? zoom : 1;
  return { x: point.x * scale, y: point.y * scale };
}

// TV targets render inside the overscan safe area; every other target can use the full artboard.
// The inset is a fixed fraction of the viewport, so the relative geometry is identical at
// 1920x1080 and 4K.
export function getSafeArea(target: DesignTarget, viewport: { width: number; height: number }): Rect {
  if (!isTvTarget(target)) return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const insetX = Math.round(viewport.width * TV_SAFE_AREA_RATIO);
  const insetY = Math.round(viewport.height * TV_SAFE_AREA_RATIO);
  return {
    x: insetX,
    y: insetY,
    width: viewport.width - insetX * 2,
    height: viewport.height - insetY * 2,
  };
}
