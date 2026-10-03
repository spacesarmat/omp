import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ minimize: vi.fn(async () => {}), exit: vi.fn(async () => {}) }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async () => ({ remove: async () => {} }),
    minimizeApp: hoisted.minimize,
    exitApp: hoisted.exit,
  },
}));

import { handleBack } from '../src/app';
import { currentRoute, resetTo, navigate } from '../src/nav';

beforeEach(() => {
  hoisted.minimize.mockClear();
  hoisted.exit.mockClear();
});

describe('Back on tab roots', () => {
  it('minimizes the app instead of exiting', () => {
    resetTo({ name: 'library' });
    handleBack();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
    expect(hoisted.exit).not.toHaveBeenCalled();
  });

  it('pops a nested screen first and does not minimize', () => {
    resetTo({ name: 'library' });
    navigate({ name: 'torrent', hash: 'x' });
    handleBack();
    expect(currentRoute.value.name).toBe('library');
    expect(hoisted.minimize).not.toHaveBeenCalled();
  });

  it('«Новое» is a tab root; its nested screens go back to it', () => {
    resetTo({ name: 'news' });
    navigate({ name: 'subFindings', id: 's1' });
    handleBack();
    expect(currentRoute.value.name).toBe('news');
    expect(hoisted.minimize).not.toHaveBeenCalled();
    handleBack();
    expect(hoisted.minimize).toHaveBeenCalledTimes(1);
  });

  it('survives minimizeApp rejecting', async () => {
    hoisted.minimize.mockRejectedValueOnce(new Error('no'));
    resetTo({ name: 'settings' });
    expect(() => handleBack()).not.toThrow();
    await Promise.resolve();
  });
});
