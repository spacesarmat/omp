import { describe, expect, it } from 'vitest';
import { RESUME_CARD_TARGET, RESUME_GAP, RESUME_MIN_VISIBLE, resumeCardStyle, resumeRowActive, resumeRowLayout } from '../src/ui/resumeRow';

function fills(width: number): void {
  const row = resumeRowLayout(width);
  expect(row.visible).toBeGreaterThanOrEqual(RESUME_MIN_VISIBLE);
  expect(row.cardPx).toBeGreaterThan(0);
  const used = row.visible * row.cardPx + (row.visible - 1) * RESUME_GAP;
  expect(used).toBeCloseTo(width, 6);
}

const shown = { mine: true, history: false, selecting: false, unavailable: false, open: true, count: 3 };

describe('resumeRowActive', () => {
  it('measures only while the continue row is actually on screen', () => {
    expect(resumeRowActive(shown)).toBe(true);
    expect(resumeRowActive({ ...shown, mine: false })).toBe(false);
    expect(resumeRowActive({ ...shown, history: true })).toBe(false);
    expect(resumeRowActive({ ...shown, selecting: true })).toBe(false);
    expect(resumeRowActive({ ...shown, unavailable: true })).toBe(false);
    expect(resumeRowActive({ ...shown, open: false })).toBe(false);
    expect(resumeRowActive({ ...shown, count: 0 })).toBe(false);
  });
});

describe('resumeRowLayout', () => {
  it('puts at least 4 cards across a phone portrait row and fills it', () => {
    // 412px screen, 16px padding on each side
    const phone = 412 - 32;
    const row = resumeRowLayout(phone);
    expect(row.visible).toBe(4);
    fills(phone);
    expect(row.cardPx).toBeLessThan(RESUME_CARD_TARGET);
  });

  it('fits more cards on a wide row instead of growing past the target by a full card', () => {
    const wide = 900;
    const row = resumeRowLayout(wide);
    expect(row.visible).toBeGreaterThan(RESUME_MIN_VISIBLE);
    fills(wide);
    // packing the row can leave a card a little wider than the target, still far below the old 64% cards
    expect(row.cardPx).toBeLessThan(RESUME_CARD_TARGET + RESUME_GAP * 2);
  });

  it('still shows 4 cards when the row is narrower than four targets', () => {
    const row = resumeRowLayout(200);
    expect(row.visible).toBe(4);
    fills(200);
  });

  it('reports 4 cards and no pixel width before the row is measured', () => {
    expect(resumeRowLayout(0)).toEqual({ visible: RESUME_MIN_VISIBLE, cardPx: 0 });
    expect(resumeRowLayout(-10)).toEqual({ visible: RESUME_MIN_VISIBLE, cardPx: 0 });
    expect(resumeCardStyle(0)).toBeUndefined();
    expect(resumeCardStyle(89)).toBe('--m-resume-card:89px');
  });
});
