import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncLeader, type SyncLeader } from '../../src/billing/syncLeader';

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(name: string) {
    this.name = name;
    if (!FakeBroadcastChannel.channels.has(name)) FakeBroadcastChannel.channels.set(name, new Set());
    FakeBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (other === this) continue;
      queueMicrotask(() => other.onmessage && other.onmessage({ data }));
    }
  }
  close() { FakeBroadcastChannel.channels.get(this.name)?.delete(this); }
  static reset() { FakeBroadcastChannel.channels.clear(); }
}

let leaders: SyncLeader[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  FakeBroadcastChannel.reset();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});
afterEach(() => {
  for (const leader of leaders) leader.stop();
  leaders = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make(run: () => unknown) {
  const leader = createSyncLeader({ deviceId: 'device-a', run, publish: () => {} });
  leaders.push(leader);
  return leader;
}

describe('sync V2 leader', () => {
  it('elects one leader and forwards follower requests', async () => {
    const runA = vi.fn();
    const runB = vi.fn();
    const a = make(runA);
    const b = make(runB);
    a.start();
    b.start();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    b.request();
    await vi.waitFor(() => expect(runA).toHaveBeenCalledTimes(1));
    expect(runB).not.toHaveBeenCalled();
  });

  it('takes over an expired or released lease', async () => {
    const a = make(() => {});
    const b = make(() => {});
    a.start();
    b.start();
    a.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.isLeader()).toBe(true);
  });

  it('uses storage events without BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const runA = vi.fn();
    const a = make(runA);
    const b = make(() => {});
    a.start();
    b.start();
    b.request();
    const key = 'omp.syncV2Bus:device-a';
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }));
    await vi.waitFor(() => expect(runA).toHaveBeenCalledTimes(1));
  });
});


describe('sync leader errors', () => {
  it('publishes a leader failure to followers', async () => {
    const a = createSyncLeader({ deviceId: 'device-a', run: () => Promise.reject(new Error('offline')), publish: () => {} });
    const seen = vi.fn();
    const b = createSyncLeader({ deviceId: 'device-a', run: () => {}, publish: seen });
    leaders.push(a, b);
    a.start();
    b.start();
    b.request();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('error'));
  });
});
