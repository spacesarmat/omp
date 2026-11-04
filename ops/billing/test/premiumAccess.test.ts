import { describe, expect, it } from 'vitest';
import { MONITOR_FREE_MAX, monitorMaxFor } from '../src/logic.mjs';
import { adsConfigLimitConfig } from '../src/services.mjs';

describe('premium access answers', () => {
  it('monitorMax is 0 while access is on and 10 when it is not', () => {
    expect(MONITOR_FREE_MAX).toBe(10);
    expect(monitorMaxFor(true)).toBe(0);
    expect(monitorMaxFor(false)).toBe(10);
  });

  it('ads-config stays public and the limit defaults to 120 per 10 minutes', () => {
    expect(adsConfigLimitConfig({})).toEqual({ ipMax: 120, windowMs: 600_000 });
    expect(adsConfigLimitConfig({ BILLING_ADS_CONFIG_IP_MAX: '0', BILLING_ADS_CONFIG_WINDOW_SEC: '60' }).ipMax).toBe(0);
    expect(adsConfigLimitConfig({ BILLING_ADS_CONFIG_IP_MAX: '30', BILLING_ADS_CONFIG_WINDOW_SEC: '60' })).toEqual({
      ipMax: 30,
      windowMs: 60_000,
    });
  });
});
