import { describe, it, expect } from 'vitest';
import { hintBlockedByOverlay, hintTargetVisible, placeCoachMark, readSafeInsets, type HintBox, type HintInsets } from '../src/ui/hintPlace';

function box(top: number, left: number, width: number, height: number): HintBox {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

const hint = { width: 280, height: 100 };

describe('placeCoachMark', () => {
  it('sits under the control and aims the arrow at its center', () => {
    const anchor = box(70, 300, 44, 44);
    const spot = placeCoachMark(anchor, hint, 390, 844);
    expect(spot).not.toBeNull();
    expect(spot!.place).toBe('below');
    expect(spot!.top).toBe(70 + 44 + 10);
    // center 322, bubble is clamped to the right margin
    expect(spot!.left).toBe(390 - 280 - 16);
    expect(spot!.arrow).toBe(322 - spot!.left);
    expect(spot!.left).toBeGreaterThanOrEqual(16);
    expect(spot!.left + hint.width).toBeLessThanOrEqual(390 - 16);
  });

  it('flips above a control that is against the bottom edge', () => {
    const anchor = box(780, 40, 44, 40);
    const spot = placeCoachMark(anchor, hint, 390, 844);
    expect(spot!.place).toBe('above');
    expect(spot!.top).toBe(780 - 10 - 100);
    expect(spot!.arrow).toBe(40 + 22 - spot!.left);
  });

  it('keeps the arrow on the bubble when the control is at the left edge', () => {
    const spot = placeCoachMark(box(80, 4, 28, 28), hint, 390, 844);
    expect(spot!.left).toBe(16);
    expect(spot!.arrow).toBeGreaterThanOrEqual(14);
    expect(spot!.arrow).toBeLessThanOrEqual(hint.width - 14);
  });

  it('drops «Мои» below the switch when the status bar leaves no room above', () => {
    // S21: the switch sits just under the status bar. A bubble above it is clipped; the whole bubble fits underneath.
    const insets: HintInsets = { top: 48, right: 0, bottom: 0, left: 0 };
    const anchor = box(72, 48, 72, 44);
    const bubble = { width: 280, height: 150 };
    const spot = placeCoachMark(anchor, bubble, 390, 844, insets);
    expect(spot).not.toBeNull();
    expect(spot!.place).toBe('below');
    expect(spot!.top).toBe(72 + 44 + 10);
    expect(spot!.top).toBeGreaterThanOrEqual(insets.top + 8);
    expect(spot!.left).toBeGreaterThanOrEqual(16);
    expect(spot!.left + bubble.width).toBeLessThanOrEqual(390 - 16);
    // arrow meets the center of «Мои»
    expect(spot!.left + spot!.arrow).toBe(48 + 36);
  });

  it('does not clamp an above-placement up into the status bar', () => {
    const insets: HintInsets = { top: 52, right: 0, bottom: 34, left: 0 };
    const anchor = box(80, 40, 44, 44);
    const spot = placeCoachMark(anchor, { width: 260, height: 160 }, 390, 800, insets);
    expect(spot!.place).toBe('below');
    expect(spot!.top).toBeGreaterThanOrEqual(insets.top + 8);
    expect(spot!.top + 160).toBeLessThanOrEqual(800 - insets.bottom);
  });

  it('flips above when the gesture inset leaves no room below, and honors a left inset', () => {
    const insets: HintInsets = { top: 40, right: 0, bottom: 48, left: 24 };
    const low = placeCoachMark(box(760, 40, 44, 40), hint, 390, 844, insets);
    expect(low!.place).toBe('above');
    expect(low!.top).toBeGreaterThanOrEqual(insets.top + 8);
    expect(low!.top + hint.height).toBeLessThanOrEqual(760);

    const side = placeCoachMark(box(120, 20, 36, 28), hint, 390, 844, insets);
    expect(side!.left).toBeGreaterThanOrEqual(insets.left);
    expect(side!.left + hint.width).toBeLessThanOrEqual(390 - 16);
    expect(side!.left + side!.arrow).toBe(20 + 18);
  });

  it('hides when the control has scrolled off, including a sliver and a clamp-to-bottom case', () => {
    expect(placeCoachMark(box(-80, 20, 44, 44), hint, 390, 844)).toBeNull();
    expect(placeCoachMark(box(-40, 20, 44, 44), hint, 390, 844)).toBeNull();
    expect(hintTargetVisible(box(-30, 20, 44, 44), 390, 844)).toBe(true);
    // below the fold: the old mark clamped itself to innerHeight - 120 and sat on a poster
    expect(placeCoachMark(box(2000, 20, 44, 44), hint, 390, 844)).toBeNull();
    expect(placeCoachMark(box(80, -200, 44, 44), hint, 390, 844)).toBeNull();
    expect(placeCoachMark(box(80, 20, 0, 44), hint, 390, 844)).toBeNull();
  });
});

describe('readSafeInsets', () => {
  it('reads padding and ignores anything that is not a length', () => {
    expect(readSafeInsets({ paddingTop: '47px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '12.5px' })).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 12.5,
    });
    expect(readSafeInsets({ paddingTop: 'env(safe-area-inset-top)', paddingRight: '', paddingBottom: 'auto', paddingLeft: '-4px' })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe('hintBlockedByOverlay', () => {
  it('is true for a dialog or an aria-modal, and false when the screen is clear', () => {
    const root = document.createElement('div');
    expect(hintBlockedByOverlay(root)).toBe(false);
    root.innerHTML = '<div class="m-hint" role="note"></div>';
    expect(hintBlockedByOverlay(root)).toBe(false);
    root.innerHTML = '<div role="dialog"></div>';
    expect(hintBlockedByOverlay(root)).toBe(true);
    root.innerHTML = '<div aria-modal="true"></div>';
    expect(hintBlockedByOverlay(root)).toBe(true);
  });
});
