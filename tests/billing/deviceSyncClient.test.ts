import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBillingSession } from '../../src/billing/session';
import { runDeviceSync } from '../../src/billing/deviceSyncClient';
import { putDeviceRecords, resetDeviceDb } from '../../src/store/deviceDb';

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
});
