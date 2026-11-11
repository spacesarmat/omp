import { describe, expect, it } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import {
  getLayoutPlacement,
  moveLayoutNode,
  upsertLayoutPlacement,
  type LayoutContext,
  type LayoutPlacement,
} from '../../design/layout';
import { parseThemeDocument } from '../../design/validation';

const BASE = '0000000000000000000000000000000000000000';
const landscape: LayoutContext = { target: 'desktop-windows', screenId: 'library', format: 'landscape' };
const portrait: LayoutContext = { target: 'desktop-windows', screenId: 'library', format: 'portrait' };

function placement(context: LayoutContext, nodeId: string, patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return {
    id: `placement-${nodeId}-${context.format}`,
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
    label: nodeId,
    ...patch,
  };
}

function containerOrder(theme: ReturnType<typeof createDefaultTheme>, context: LayoutContext, parentId: string): string[] {
  const container = theme.layout?.containers.find(
    (entry) => entry.target === context.target
      && entry.screenId === context.screenId
      && entry.format === context.format
      && entry.nodeId === parentId,
  );
  return container ? container.order : [];
}

describe('layout operations', () => {
  it('loads a legacy theme without layout and keeps the parsed document unchanged', () => {
    const legacy = createDefaultTheme(BASE) as unknown as Record<string, unknown>;
    delete legacy.layout;
    delete legacy.stylePresets;

    const parsed = parseThemeDocument(legacy);
    expect(parsed.layout).toBeUndefined();
    expect(parsed.stylePresets).toBeUndefined();
    expect(parsed).toEqual(legacy);
  });

  it('moves a node to index 0 inside its flow container without mutating the source theme', () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-a'));
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-b'));
    theme = moveLayoutNode(theme, landscape, 'card-a', 'card-grid', 0);
    theme = moveLayoutNode(theme, landscape, 'card-b', 'card-grid', 1);

    const moved = moveLayoutNode(theme, landscape, 'card-b', 'card-grid', 0);
    expect(containerOrder(moved, landscape, 'card-grid')).toEqual(['card-b', 'card-a']);
    expect(containerOrder(theme, landscape, 'card-grid')).toEqual(['card-a', 'card-b']);
    expect(theme.layout?.placements).toHaveLength(2);
    expect(parseThemeDocument(moved)).toEqual(moved);
  });

  it('moves a node out of a previous container when the parent changes', () => {
    let theme = createDefaultTheme(BASE);
    theme = moveLayoutNode(theme, landscape, 'card-a', 'card-grid', 0);
    theme = moveLayoutNode(theme, landscape, 'card-b', 'card-grid', 1);
    const moved = moveLayoutNode(theme, landscape, 'card-a', 'sidebar', 0);

    expect(containerOrder(moved, landscape, 'card-grid')).toEqual(['card-b']);
    expect(containerOrder(moved, landscape, 'sidebar')).toEqual(['card-a']);
  });

  it('clamps the insertion index to the container order bounds', () => {
    let theme = createDefaultTheme(BASE);
    theme = moveLayoutNode(theme, landscape, 'card-a', 'card-grid', 0);
    const moved = moveLayoutNode(theme, landscape, 'card-b', 'card-grid', 99);
    expect(containerOrder(moved, landscape, 'card-grid')).toEqual(['card-a', 'card-b']);
  });

  it('round-trips an absolute placement with x, y and anchor', () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-a', {
      mode: 'absolute',
      x: 40,
      y: 24,
      anchor: 'top-left',
      width: 200,
      height: 120,
      zIndex: 3,
      label: 'Poster card',
    }));

    const stored = getLayoutPlacement(theme, landscape, 'card-a');
    expect(stored).toMatchObject({ mode: 'absolute', x: 40, y: 24, anchor: 'top-left', width: 200, height: 120 });
    expect(parseThemeDocument(theme)).toEqual(theme);
  });

  it('replaces an existing placement on upsert instead of duplicating it', () => {
    let theme = createDefaultTheme(BASE);
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-a', { mode: 'absolute', x: 40, y: 24 }));
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-a', { mode: 'absolute', x: 64, y: 48 }));

    expect(theme.layout?.placements).toHaveLength(1);
    expect(getLayoutPlacement(theme, landscape, 'card-a')).toMatchObject({ x: 64, y: 48 });
  });

  it('keeps the same nodeId isolated between portrait and landscape', () => {
    let theme = createDefaultTheme(BASE);
    theme = moveLayoutNode(theme, landscape, 'card-a', 'card-grid', 0);
    theme = upsertLayoutPlacement(theme, placement(landscape, 'card-a', { mode: 'absolute', x: 40, y: 24 }));

    expect(getLayoutPlacement(theme, portrait, 'card-a')).toBeUndefined();
    expect(containerOrder(theme, portrait, 'card-grid')).toEqual([]);

    const portraitCopy = upsertLayoutPlacement(theme, placement(portrait, 'card-a', { mode: 'absolute', x: 8, y: 8 }));
    expect(getLayoutPlacement(portraitCopy, portrait, 'card-a')).toMatchObject({ x: 8, y: 8 });
    expect(getLayoutPlacement(portraitCopy, landscape, 'card-a')).toMatchObject({ x: 40, y: 24 });
    expect(parseThemeDocument(portraitCopy)).toEqual(portraitCopy);
  });
});
