import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDeviceSync, setSyncContext } from '../../src/billing/deviceSyncClient';
import { resetV2AccountCache, setV2SyncContext } from '../../src/billing/deviceSyncV2Client';
import { resetSyncV2Status, syncV2Status } from '../../src/billing/syncV2Status';
import { saveBillingSession } from '../../src/billing/session';
import { lastSyncError, putDeviceRecords, resetDeviceDb, setSyncEnabled } from '../../src/store/deviceDb';
import { resetDeviceV2Db } from '../../src/store/deviceV2Db';

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  resetDeviceV2Db();
  resetV2AccountCache();
  resetSyncV2Status();
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
  vi.stubGlobal('WebSocket', class {});
});

afterEach(() => {
  setSyncEnabled(false);
  setSyncContext(null);
  setV2SyncContext(null);
  saveBillingSession(null);
  resetSyncV2Status();
  vi.unstubAllGlobals();
});

describe('offline protocol status', () => {
  it('keeps offline as the public V2 status when account discovery falls back to V1', async () => {
    setSyncContext(() => ({
      http: {
        get: (url: string) => Promise.resolve({ status: 0, url, text: '' }),
        post: (url: string) => Promise.resolve({ status: 0, url, text: '' }),
        postJson: (url: string) => Promise.resolve({ status: 0, url, text: '' }),
        clearCookies: () => Promise.resolve(),
      },
      client: null,
    }));
    putDeviceRecords([{ id: 'progress:offline:1', kind: 'progress', key: 'offline:1', body: { time: 1 }, updatedAt: 100, deviceId: 'device', deleted: false }]);

    expect(await runDeviceSync()).toBe('error');
    expect(lastSyncError()).toBe('offline');
    expect(syncV2Status().lastError).toBe('offline');
  });
});
