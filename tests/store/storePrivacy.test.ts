import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storeMode', () => ({
  STORE_BUILD: true,
  publicSearchEnabled: () => false,
}));

import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/store/settings';

describe('LG store build privacy defaults', () => {
  it('diagnostics are off until the person moves the switch', () => {
    expect(DEFAULT_SETTINGS.diagnostics).toBe(false);
    expect(sanitizeSettings({}).diagnostics).toBe(false);
    expect(sanitizeSettings({ diagnostics: true }).diagnostics).toBe(false);
    expect(sanitizeSettings({ diagnostics: true, diagnosticsTouched: true }).diagnostics).toBe(true);
    expect(sanitizeSettings({ diagnostics: false, diagnosticsTouched: true }).diagnostics).toBe(false);
  });

  it('does not send ranking stats, and a saved on does not bring them back', () => {
    expect(DEFAULT_SETTINGS.helpRank).toBe(false);
    expect(sanitizeSettings({ helpRank: true }).helpRank).toBe(false);
  });
});
