import { describe, expect, it } from 'vitest';
import { alignPlacements, distributePlacements, reduceSelection } from '../../editor/src/layout/selection';
import { createPlacement } from '../../editor/src/layout/transactions';
import type { LayoutContext, LayoutPlacement } from '../../design/schema';

const context: LayoutContext = { target: 'android-tv', screenId: 'home', format: 'landscape' };

function placement(nodeId: string, patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return createPlacement(context, nodeId, nodeId, { mode: 'absolute', width: 2500, height: 2500, ...patch });
}

describe('reduceSelection', () => {
  it('selects a single node and keeps it as the anchor', () => {
    const state = reduceSelection({ ids: [], anchorId: null }, { type: 'select', id: 'a' });
    expect(state).toEqual({ ids: ['a'], anchorId: 'a' });
    expect(reduceSelection(state, { type: 'select', id: null })).toEqual({ ids: [], anchorId: null });
  });

  it('toggles nodes with shift and falls back to the last remaining anchor', () => {
    let state = reduceSelection({ ids: ['a'], anchorId: 'a' }, { type: 'toggle', id: 'b' });
    expect(state).toEqual({ ids: ['a', 'b'], anchorId: 'b' });
    state = reduceSelection(state, { type: 'toggle', id: 'a' });
    expect(state).toEqual({ ids: ['b'], anchorId: 'b' });
    state = reduceSelection(state, { type: 'toggle', id: 'b' });
    expect(state).toEqual({ ids: [], anchorId: null });
  });

  it('replaces the selection with a marquee range and anchors the last node', () => {
    const state = reduceSelection({ ids: ['a', 'b'], anchorId: 'a' }, { type: 'range', ids: ['x', 'y'] });
    expect(state).toEqual({ ids: ['x', 'y'], anchorId: 'y' });
    expect(reduceSelection(state, { type: 'range', ids: [] })).toEqual({ ids: [], anchorId: null });
  });

  it('prunes stale ids and repairs the anchor', () => {
    const state = reduceSelection({ ids: ['a', 'b', 'c'], anchorId: 'b' }, { type: 'prune', liveIds: ['a', 'c'] });
    expect(state).toEqual({ ids: ['a', 'c'], anchorId: 'c' });
    expect(reduceSelection(state, { type: 'prune', liveIds: [] })).toEqual({ ids: [], anchorId: null });
  });
});

describe('alignPlacements', () => {
  it('aligns left edges to the leftmost node', () => {
    const aligned = alignPlacements([
      placement('a', { x: 1000 }),
      placement('b', { x: 3000 }),
      placement('c', { x: 2000 }),
    ], 'left');
    expect(aligned.map((entry) => entry.x)).toEqual([1000, 1000, 1000]);
  });

  it('aligns horizontal centers to the group center', () => {
    const aligned = alignPlacements([
      placement('a', { x: 1000, width: 2500 }),
      placement('b', { x: 3000, width: 2500 }),
    ], 'center');
    // span 1000..5500, center 3250, both 2500 wide
    expect(aligned.map((entry) => entry.x)).toEqual([2000, 2000]);
  });

  it('aligns right edges to the rightmost node', () => {
    const aligned = alignPlacements([
      placement('a', { x: 1000, width: 2500 }),
      placement('b', { x: 3000, width: 2500 }),
    ], 'right');
    expect(aligned.map((entry) => entry.x)).toEqual([3000, 3000]);
  });

  it('keeps locked nodes untouched', () => {
    const aligned = alignPlacements([
      placement('a', { x: 2500 }),
      placement('b', { x: 1250, locked: true }),
      placement('c', { x: 5000 }),
    ], 'left');
    expect(aligned.map((entry) => entry.x)).toEqual([2500, 1250, 2500]);
  });

  it('rewrites right-anchored offsets without moving geometry', () => {
    const aligned = alignPlacements([
      placement('a', { anchor: 'top-right', x: 5000, width: 2500 }),
      placement('b', { x: 1000, width: 2500 }),
    ], 'left');
    // left edges: a 2500, b 1000; target 1000; a keeps left edge 1000 via right anchor offset 6500
    expect(aligned[0]).toMatchObject({ anchor: 'top-right', x: 6500 });
    expect(aligned[1].x).toBe(1000);
  });

  it('aligns top edges along Y', () => {
    const aligned = alignPlacements([
      placement('a', { y: 4000 }),
      placement('b', { y: 1000 }),
    ], 'top');
    expect(aligned.map((entry) => entry.y)).toEqual([1000, 1000]);
  });
});

describe('distributePlacements', () => {
  it('spaces three nodes with equal gaps along X', () => {
    const distributed = distributePlacements([
      placement('a', { x: 0, width: 1000 }),
      placement('b', { x: 7000, width: 1000 }),
      placement('c', { x: 3000, width: 1000 }),
    ], 'x');
    // span 0..8000, sizes 3000, gap 2500: a 0, c 3500, b 7000
    expect(distributed.map((entry) => entry.x)).toEqual([0, 7000, 3500]);
  });

  it('skips locked nodes and keeps their geometry', () => {
    const distributed = distributePlacements([
      placement('a', { x: 0, width: 1000 }),
      placement('b', { x: 4500, width: 1000, locked: true }),
      placement('c', { x: 9000, width: 1000 }),
      placement('d', { x: 9500, width: 1000 }),
    ], 'x');
    // participants a, c, d: span 0..10500, gap 3750
    expect(distributed.map((entry) => entry.x)).toEqual([0, 4500, 4750, 9500]);
  });
});
