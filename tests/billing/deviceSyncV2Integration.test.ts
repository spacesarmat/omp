import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDeviceSync, setSyncContext } from '../../src/billing/deviceSyncClient';
import { setV2SyncContext } from '../../src/billing/deviceSyncV2Client';
import { saveBillingSession } from '../../src/billing/session';
import { resetDeviceDb } from '../../src/store/deviceDb';
import { resetDeviceV2Db } from '../../src/store/deviceV2Db';

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
  vi.stubGlobal('WebSocket', class {});
});

afterEach(() => {
  setSyncContext(null);
  setV2SyncContext(null);
  resetDeviceV2Db();
  vi.unstubAllGlobals();
  saveBillingSession(null);
});

describe('device sync protocol selection', () => {
  it('uses HTTP V2 when the account and device capabilities allow it', async () => {
    const urls: string[] = [];
    const context = {
      http: {
        get: (url: string) => {
          urls.push(url);
          return Promise.resolve({
            status: 200,
            url,
            text: JSON.stringify({ telegramId: 'user-1', active: true, sync: { audience: 'subscribers', allowed: true, v2: true } }),
          });
        },
        post: () => Promise.resolve({ status: 0, url: '', text: '' }),
        postJson: (url: string) => {
          urls.push(url);
          return Promise.resolve({ status: 200, url, text: '{"ok":true,"records":[],"nextRevision":1,"ack":[]}' });
        },
        clearCookies: () => Promise.resolve(),
      },
      client: null,
    };
    setSyncContext(() => context);

    expect(await runDeviceSync()).toBe('ok');
    expect(urls.some((url) => url.endsWith('/v1/me'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/v2/sync'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/v1/sync'))).toBe(false);
  });
});
