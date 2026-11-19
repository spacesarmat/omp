import { describe, expect, it } from 'vitest';
import { startDeviceLink, startAdminPanelLogin } from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';

const NOW = Date.UTC(2026, 10, 19, 9, 0, 0);

describe('pending link/login caps refuse instead of evicting', () => {
  it('refuses a new link at 80 pending and keeps every existing token', () => {
    let s = emptyState();
    const tokens: string[] = [];
    for (let i = 0; i < 80; i++) {
      const r = startDeviceLink(s, { deviceId: (i + 1).toString(16).padStart(16, '0'), now: NOW });
      expect(r.result.token).toBeTruthy();
      tokens.push(r.result.token);
      s = r.state;
    }
    const full = startDeviceLink(s, { deviceId: 'f'.repeat(16), now: NOW });
    expect(full.result.error).toBe('too_many_pending');
    expect(full.state.links).toHaveLength(80);
    for (const t of tokens) expect(full.state.links.some((l) => l.token === t)).toBe(true);
  });

  it('refuses a new admin login at 40 pending and keeps every existing token', () => {
    let s = emptyState();
    const tokens: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = startAdminPanelLogin(s, { now: NOW });
      expect(r.result.token).toBeTruthy();
      tokens.push(r.result.token);
      s = r.state;
    }
    const full = startAdminPanelLogin(s, { now: NOW });
    expect(full.result.error).toBe('too_many_pending');
    expect(full.state.adminLogins).toHaveLength(40);
    for (const t of tokens) expect(full.state.adminLogins.some((l) => l.token === t)).toBe(true);
  });

  it('expired pending rows do not count toward the cap', () => {
    let s = emptyState();
    for (let i = 0; i < 80; i++) s = startDeviceLink(s, { deviceId: (i + 1).toString(16).padStart(16, '0'), now: NOW }).state;
    const later = startDeviceLink(s, { deviceId: 'e'.repeat(16), now: NOW + 11 * 60 * 1000 });
    expect(later.result.token).toBeTruthy();
    expect(later.state.links).toHaveLength(1);
  });
});