import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../../src/storeMode', () => ({
  STORE_BUILD: true,
  publicSearchEnabled: () => false,
}));

import { deviceName, loadDeviceName, resetDeviceName, WEBOS_FALLBACK_NAME } from '../../src/platform/deviceName';

afterEach(() => {
  delete (window as unknown as { PalmServiceBridge?: unknown }).PalmServiceBridge;
  resetDeviceName();
});

describe('store build device name', () => {
  it('does not call settingsservice and shows the fallback', async () => {
    const calls: string[] = [];
    (window as unknown as { PalmServiceBridge?: unknown }).PalmServiceBridge = function Bridge(this: { call: (uri: string) => void }) {
      this.call = (uri: string) => { calls.push(uri); };
    };
    await loadDeviceName();
    expect(calls).toEqual([]);
    expect(deviceName.value).toBe(WEBOS_FALLBACK_NAME);
  });
});
