import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitBillingChange, saveBillingSession } from '../../src/billing/session';
import { runDeviceSync, setSyncContext } from '../../src/billing/deviceSyncClient';
import { deviceRecords, putDeviceRecords, resetDeviceDb } from '../../src/store/deviceDb';

function ok(nextSeq: number) {
  return { status: 200, json: () => Promise.resolve({ ok: true, records: [], nextSeq }) };
}

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setSyncContext(null);
  saveBillingSession(null);
  resetDeviceDb();
});

describe('runDeviceSync', () => {
  it('sends an edit that arrived while a request was still running', async () => {
    const bodies: string[] = [];
    let release: (res: { status: number; json: () => Promise<unknown> }) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body?: string }) => {
      bodies.push(init && init.body ? init.body : '');
      if (bodies.length === 1) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve(ok(2));
    }));
    const first = runDeviceSync();
    putDeviceRecords([{ id: 'progress:h:1', kind: 'progress', key: 'h:1', body: { time: 8 }, updatedAt: 20, deviceId: 'local' }]);
    expect(await runDeviceSync()).toBe('busy');
    release(ok(1));
    await first;
    expect(bodies.length).toBe(2);
    expect(bodies[1]).toContain('progress:h:1');
  });

  it('drops a reply that arrives after the account changed', async () => {
    let release: (res: { status: number; json: () => Promise<unknown> }) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve; })));
    const first = runDeviceSync();
    saveBillingSession({ token: 'tok2', paidUntil: Date.now() + 60000, id: 'acc-2' });
    release({
      status: 200,
      json: () => Promise.resolve({
        ok: true,
        records: [{ id: 'progress:h:9', kind: 'progress', key: 'h:9', body: { time: 1 }, updatedAt: 50, deviceId: 'other', deleted: false }],
        nextSeq: 4,
      }),
    });
    expect(await first).toBe('switched');
    expect(deviceRecords().some((r) => r.id === 'progress:h:9')).toBe(false);
  });

  it('starts a sync when a different account signs in', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok(1))));
    await runDeviceSync();
    vi.useFakeTimers();
    const later = vi.fn(() => Promise.resolve(ok(2)));
    vi.stubGlobal('fetch', later);
    saveBillingSession({ token: 'tok2', paidUntil: Date.now() + 60000, id: 'acc-2' });
    emitBillingChange();
    await vi.advanceTimersByTimeAsync(1600);
    expect(later).toHaveBeenCalled();
  });

  it('uses the device http client instead of window.fetch', async () => {
    const bodies: string[] = [];
    setSyncContext(() => ({
      http: {
        get: () => Promise.resolve({ status: 0, url: '', text: '' }),
        post: () => Promise.resolve({ status: 0, url: '', text: '' }),
        postJson: (_url: string, body: string) => {
          bodies.push(body);
          return Promise.resolve({ status: 200, url: '', text: '{"ok":true,"records":[],"nextSeq":3}' });
        },
        clearCookies: () => Promise.resolve(),
      },
      client: null,
    }));
    const fetched = vi.fn(() => Promise.reject(new Error('fetch')));
    vi.stubGlobal('fetch', fetched);
    expect(await runDeviceSync()).toBe('ok');
    expect(bodies.length).toBe(1);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('does not upload saved rows after the account changes during the send', async () => {
    let sent = 0;
    setSyncContext(() => ({
      http: {
        get: () => Promise.resolve({ status: 0, url: '', text: '' }),
        post: () => Promise.resolve({ status: 0, url: '', text: '' }),
        postJson: () => {
          sent += 1;
          return Promise.resolve({ status: 200, url: '', text: '{"ok":true,"records":[],"nextSeq":1}' });
        },
        clearCookies: () => Promise.resolve(),
      },
      client: null,
    }));
    const pending = runDeviceSync();
    saveBillingSession({ token: 'tok2', paidUntil: Date.now() + 60000, id: 'acc-2' });
    expect(await pending).toBe('switched');
    expect(sent).toBe(0);
  });
});
