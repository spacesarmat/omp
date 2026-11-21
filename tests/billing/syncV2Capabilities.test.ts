import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { canUseV2, resetSyncV2Capabilities, setSyncV2Mode, syncV2Mode } from '../../src/billing/syncV2Capabilities';
import { resetDeviceV2Db } from '../../src/store/deviceV2Db';
import type { BillingAccount } from '../../src/billing/session';

const account: BillingAccount = { telegramId: 'u', paidUntil: 1, active: true, deviceLimit: 5, sync: { audience: 'subscribers', allowed: true, v2: true } };

beforeEach(async () => {
  localStorage.clear();
  resetSyncV2Capabilities();
  resetDeviceV2Db();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('omp-sync-v2');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  resetDeviceV2Db();
  vi.stubGlobal('WebSocket', class {});
});

afterEach(() => vi.unstubAllGlobals());

describe('sync V2 capabilities', () => {
  it('honors off and performs a real transaction in auto mode', async () => {
    setSyncV2Mode('off');
    expect(syncV2Mode()).toBe('off');
    expect(await canUseV2(account)).toBe(false);
    setSyncV2Mode('auto');
    expect(await canUseV2(account)).toBe(true);
  });

  it('lets the server kill-switch disable every local mode', async () => {
    setSyncV2Mode('on');
    expect(await canUseV2({ ...account, sync: { ...account.sync!, v2: false } })).toBe(false);
  });

  it('falls back when WebSocket is unavailable', async () => {
    vi.stubGlobal('WebSocket', undefined);
    expect(await canUseV2(account)).toBe(false);
  });

  it('falls back when IndexedDB cannot commit', async () => {
    resetDeviceV2Db();
    vi.stubGlobal('indexedDB', undefined);
    expect(await canUseV2(account)).toBe(false);
  });

  it('rejects an account without sync data', async () => {
    expect(await canUseV2(null)).toBe(false);
  });
});
