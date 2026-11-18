import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { devmodeExtendAt, devmodeExpiring, extendDevMode, openDevMode } from '../../src/platform/devmode';
import { DEVMODE_HOURS, REMINDER_BEFORE_HOURS } from '../../src/lib/installPlan';

const HOUR = 3600 * 1000;
const LEAD = (DEVMODE_HOURS - REMINDER_BEFORE_HOURS) * HOUR;
let calls: { uri: string; params: any }[] = [];

function fakeBridge() {
  calls = [];
  (window as any).PalmServiceBridge = function (this: any) {
    this.call = (uri: string, params: string) => {
      calls.push({ uri, params: JSON.parse(params) });
      setTimeout(() => this.onservicecallback(JSON.stringify({ returnValue: true })), 0);
    };
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => { delete (window as any).PalmServiceBridge; localStorage.clear(); });

describe('devmode', () => {
  it('starts the proxy window on first launch and keeps it', () => {
    const now = 1700000000000;
    expect(devmodeExtendAt(now)).toBe(now);
    expect(devmodeExtendAt(now + 5 * HOUR)).toBe(now);
    expect(devmodeExpiring(now + LEAD - 1)).toBe(false);
    expect(devmodeExpiring(now + LEAD)).toBe(true);
  });
  it('ignores a corrupt saved window', () => {
    localStorage.setItem('omp.devmode.extendAt', '"yesterday"');
    const now = 1700000000000;
    expect(devmodeExtendAt(now)).toBe(now);
  });
  it('extend restarts the window only after a successful launch', async () => {
    const now = 1700000000000;
    devmodeExtendAt(now);
    await expect(extendDevMode(now + 10 * HOUR)).rejects.toThrow('Luna unavailable');
    expect(devmodeExpiring(now + LEAD)).toBe(true);
    fakeBridge();
    await extendDevMode(now + 10 * HOUR);
    expect(calls[0]).toEqual({ uri: 'luna://com.webos.applicationManager/launch', params: { id: 'com.palmdts.devmode' } });
    expect(devmodeExpiring(now + 10 * HOUR + LEAD - 1)).toBe(false);
    expect(devmodeExpiring(now + 10 * HOUR + LEAD)).toBe(true);
  });
  it('openDevMode rejects without Luna', async () => {
    await expect(openDevMode()).rejects.toThrow('Luna unavailable');
  });
});