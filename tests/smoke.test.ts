import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs in jsdom', () => {
    expect(typeof document.createElement).toBe('function');
    expect(typeof localStorage.setItem).toBe('function');
  });
});
