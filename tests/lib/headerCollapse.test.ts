import { describe, it, expect } from 'vitest';
import { nextHeaderCollapsed } from '../../src/lib/headerCollapse';

describe('header collapse hysteresis', () => {
  it('stays open until the fixed threshold', () => {
    expect(nextHeaderCollapsed(false, 24)).toBe(false);
    expect(nextHeaderCollapsed(false, 48)).toBe(false);
    expect(nextHeaderCollapsed(false, 49)).toBe(true);
  });

  it('stays closed until the scroll falls back by the hysteresis', () => {
    expect(nextHeaderCollapsed(true, 40)).toBe(true);
    expect(nextHeaderCollapsed(true, 25)).toBe(true);
    expect(nextHeaderCollapsed(true, 24)).toBe(false);
    expect(nextHeaderCollapsed(true, 0)).toBe(false);
  });
});
