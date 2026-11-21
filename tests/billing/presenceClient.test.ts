import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPresence,
  resetPresenceClient,
  sendPresence,
  setPresenceContext,
  startPresenceReporting,
  type PresenceInput,
  type PresenceReport,
} from '../../src/billing/presenceClient';
import { saveBillingSession } from '../../src/billing/session';
import { resetDeviceDb } from '../../src/store/deviceDb';

const report: PresenceReport = {
  state: 'playing',
  hash: 'a'.repeat(40),
  fileId: 1,
  title: 'Show',
  episode: 'S01E01',
  positionSec: 10,
  durationSec: 35,
  deviceName: 'Phone',
  platform: 'phone',
};
const full: PresenceInput = { ...report, sessionId: 'session-1', sessionSeq: 1 };

function ok(rows: unknown[] = []) {
  return { status: 200, json: () => Promise.resolve({ ok: true, presences: rows }) };
}

beforeEach(() => {
  localStorage.clear();
  resetDeviceDb();
  resetPresenceClient();
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
});

afterEach(() => {
  resetPresenceClient();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  saveBillingSession(null);
  resetDeviceDb();
});

describe('presence client requests', () => {
  it('uses the native context for update, clear and list', async () => {
    const bodies: string[] = [];
    let gets = 0;
    setPresenceContext(() => ({
      http: {
        get: () => { gets++; return Promise.resolve({ status: 200, url: '', text: '{"ok":true,"presences":[{"deviceId":"tv"}]}' }); },
        post: () => Promise.resolve({ status: 0, url: '', text: '' }),
        postJson: (_url: string, body: string) => {
          bodies.push(body);
          return Promise.resolve({ status: 200, url: '', text: '{"ok":true,"presences":[]}' });
        },
        clearCookies: () => Promise.resolve(),
      },
      client: null,
    }));
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    expect(await sendPresence(full)).toBe(true);
    expect(await sendPresence(null)).toBe(true);
    expect(await fetchPresence()).toEqual([{ deviceId: 'tv' }]);
    expect(JSON.parse(bodies[0])).toEqual({ presence: full });
    expect(JSON.parse(bodies[1])).toEqual({ presence: null });
    expect(gets).toBe(1);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('resolves false without a session or on a network failure', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetched);
    saveBillingSession(null);
    expect(await sendPresence(full)).toBe(false);
    expect(fetched).not.toHaveBeenCalled();
    saveBillingSession({ token: 'tok', paidUntil: Date.now() + 60000, id: 'acc-1' });
    expect(await sendPresence(full)).toBe(false);
    expect(await fetchPresence()).toEqual([]);
  });
});

describe('presence reporting sessions', () => {
  it('estimates a static playing source, clamps duration and sends actual final state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const bodies: PresenceInput[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body).presence);
      return Promise.resolve(ok());
    }));
    const stop = startPresenceReporting(() => report, 'phone-play');
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies[0]).toMatchObject({ positionSec: 10, sessionSeq: 1000000 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(bodies[1]).toMatchObject({ positionSec: 25, sessionId: bodies[0].sessionId });
    await vi.advanceTimersByTimeAsync(15000);
    expect(bodies[2].positionSec).toBe(35);
    stop({ ...report, state: 'paused', positionSec: 33 });
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies[3]).toMatchObject({ state: 'paused', positionSec: 33 });
    expect(bodies[3].sessionSeq).toBeGreaterThan(bodies[0].sessionSeq);
    const count = bodies.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(bodies).toHaveLength(count);
  });

  it('starts a newer session and an old stop cannot clear its replacement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000000);
    const bodies: Array<PresenceInput | null> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body).presence);
      return Promise.resolve(ok());
    }));
    const oldStop = startPresenceReporting(() => report, 'same-key');
    await vi.advanceTimersByTimeAsync(0);
    const nextStop = startPresenceReporting(() => ({ ...report, fileId: 2 }), 'same-key');
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies[1]!.sessionSeq).toBeGreaterThan(bodies[0]!.sessionSeq);
    oldStop();
    nextStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies.filter((row) => row === null)).toHaveLength(1);
  });

  it('does not start requests without authentication', async () => {
    vi.useFakeTimers();
    const fetched = vi.fn(() => Promise.resolve(ok()));
    const source = vi.fn(() => report);
    vi.stubGlobal('fetch', fetched);
    saveBillingSession(null);
    const stop = startPresenceReporting(source, 'phone-play');
    await vi.advanceTimersByTimeAsync(30000);
    stop();
    expect(source).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });
});
