import { describe, expect, it } from 'vitest';
import { oppositeAnchor, resizePlacement } from '../../design/geometry';

const BASE = { x: 100, y: 80, width: 200, height: 100 };

describe('resize geometry', () => {
  it('resizes from the se handle by the pointer delta', () => {
    expect(resizePlacement(BASE, 'se', { x: 30, y: -20 })).toEqual({ x: 100, y: 80, width: 230, height: 80 });
  });

  it('moves only the dragged edges for side handles', () => {
    expect(resizePlacement(BASE, 'e', { x: 30, y: -20 })).toEqual({ x: 100, y: 80, width: 230, height: 100 });
    expect(resizePlacement(BASE, 'n', { x: 30, y: 20 })).toEqual({ x: 100, y: 100, width: 200, height: 80 });
  });

  it('clamps resize to the documented min and max constraints', () => {
    const constraints = { minWidth: 150, maxWidth: 260, minHeight: 60, maxHeight: 120 };
    expect(resizePlacement(BASE, 'se', { x: 1000, y: 1000 }, constraints))
      .toEqual({ x: 100, y: 80, width: 260, height: 120 });
    expect(resizePlacement(BASE, 'se', { x: -1000, y: -1000 }, constraints))
      .toEqual({ x: 100, y: 80, width: 150, height: 60 });
  });

  it('clamps negative sizes at the fixed anchor instead of flipping', () => {
    expect(resizePlacement(BASE, 'se', { x: -500, y: -500 })).toEqual({ x: 100, y: 80, width: 0, height: 0 });
    expect(resizePlacement(BASE, 'w', { x: 500, y: 0 })).toEqual({ x: 300, y: 80, width: 0, height: 100 });
  });

  it('keeps the bottom-right anchor fixed for the nw handle', () => {
    expect(oppositeAnchor('nw')).toBe('bottom-right');
    const resized = resizePlacement(BASE, 'nw', { x: 10, y: 20 });
    expect(resized).toEqual({ x: 110, y: 100, width: 190, height: 80 });
    expect(resized.x + resized.width).toBe(300);
    expect(resized.y + resized.height).toBe(180);
  });

  it('holds the min size at the anchor when the opposite handle overshoots', () => {
    const resized = resizePlacement(BASE, 'w', { x: 500, y: 0 }, { minWidth: 120 });
    expect(resized).toEqual({ x: 180, y: 80, width: 120, height: 100 });
    expect(resized.x + resized.width).toBe(300);
  });

  it('maps every handle to the opposite fixed anchor', () => {
    expect(oppositeAnchor('se')).toBe('top-left');
    expect(oppositeAnchor('ne')).toBe('bottom-left');
    expect(oppositeAnchor('sw')).toBe('top-right');
  });
});
