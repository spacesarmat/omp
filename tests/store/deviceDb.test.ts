import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceRecords, hydrateDeviceDb, putDeviceRecords, resetDeviceDb, setSyncEnabled } from '../../src/store/deviceDb';
import { readV2Records, resetDeviceV2Db } from '../../src/store/deviceV2Db';

const row = { id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 40 }, updatedAt: 100, deviceId: 'device-a', deleted: false };

beforeEach(async () => {
  localStorage.clear();
  resetDeviceV2Db();
  for (const name of ['omp-device', 'omp-sync-v2']) {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
  resetDeviceV2Db();
  resetDeviceDb();
});

describe('deviceDb V2 projection', () => {
  it('mirrors while sync is off and restores records during hydrate', async () => {
    setSyncEnabled(false);
    putDeviceRecords([row]);
    await vi.waitFor(async () => expect(await readV2Records()).toHaveLength(1));
    resetDeviceDb();
    expect(deviceRecords()).toEqual([]);
    await new Promise<void>((resolve) => hydrateDeviceDb(() => resolve()));
    expect(deviceRecords()).toEqual([row]);
  });
});
