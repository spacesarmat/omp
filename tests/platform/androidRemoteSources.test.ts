import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installAndroidRemote, applyRemoteSourcesEvent, resetRemoteSources } from '../../src/platform/androidRemote';
import { nativePlugin } from '../../src/platform/androidNative';
import { isSourceOn, reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { lastTransfer, onTransferApplied } from '../../src/sources/transfer';
import { logEntries, clearLog } from '../../src/lib/log';
import type { Source, SourceContext } from '../../src/sources/types';

const w = window as unknown as { Capacitor?: unknown };
const flush = () => new Promise((r) => setTimeout(r, 0));
// test-only value
const PASSWORD = 'pa55-test-only';

function src(id: string): Source {
  return { id, name: id, kind: 'builtin', search: () => Promise.resolve([]) };
}

const noCtx = (): SourceContext => ({
  http: { get: () => Promise.reject(new Error('net')), post: () => Promise.reject(new Error('net')), clearCookies: () => Promise.resolve() },
  client: null,
});

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  resetRemoteSources();
});
afterEach(() => {
  delete w.Capacitor;
});

describe('remoteSources on Android TV', () => {
  it('applies the switches and answers the native side with the id', async () => {
    const done = vi.fn(() => Promise.resolve());
    await applyRemoteSourcesEvent({ id: 's7', sources: { rutor: false }, rutracker: false, phone: 'Pixel' }, { remoteSourcesDone: done }, () => [src('rutor')], noCtx);
    expect(done).toHaveBeenCalledWith({ id: 's7' });
    expect(isSourceOn(src('rutor'))).toBe(false);
    expect(lastTransfer()!.phone).toBe('Pixel');
    expect(logEntries().some((e) => e.x.indexOf('Источники переданы с телефона') >= 0)).toBe(true);
  });

  it('says «failed» for a malformed event with an id and stays silent without one', async () => {
    const done = vi.fn(() => Promise.resolve());
    await applyRemoteSourcesEvent({ id: 's8', sources: 'x' }, { remoteSourcesDone: done });
    expect(done).toHaveBeenCalledWith({ id: 's8', failed: true });
    done.mockClear();
    await applyRemoteSourcesEvent({ sources: { rutor: true } }, { remoteSourcesDone: done });
    expect(done).not.toHaveBeenCalled();
  });

  it('reports the rutracker result and never logs secrets', async () => {
    const done = vi.fn(() => Promise.resolve());
    const rt: Source = { ...src('rutracker'), needsLogin: true };
    const ctx = (): SourceContext => ({
      ...noCtx(),
      secrets: {
        get: (k) => Promise.resolve(k === 'rutracker.username' ? 'test-user' : PASSWORD),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    await applyRemoteSourcesEvent({ id: 's9', sources: { rutracker: true }, rutracker: true, phone: 'Pixel' }, { remoteSourcesDone: done }, () => [rt], ctx);
    expect(done).toHaveBeenCalledWith({ id: 's9', rutracker: 'error' });
    const text = JSON.stringify(logEntries());
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('test-user');
  });

  it('is wired to the plugin event', async () => {
    const listeners: { [e: string]: ((d: any) => void)[] } = {};
    const plugin = {
      localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
      remoteSourcesDone: vi.fn(() => Promise.resolve()),
      remoteSourcesPending: vi.fn(() => Promise.resolve({ event: null })),
      addListener: vi.fn((e: string, cb: (d: any) => void) => {
        (listeners[e] = listeners[e] || []).push(cb);
        return Promise.resolve({ remove: () => undefined });
      }),
    };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
    const off = installAndroidRemote(nativePlugin());
    await flush();
    listeners.remoteSources[0]({ id: 's10', sources: { 'ts-rutor': false }, rutracker: false, phone: 'Pixel' });
    await flush();
    await flush();
    expect(plugin.remoteSourcesDone).toHaveBeenCalledWith({ id: 's10' });
    off();
  });

  it('applies a transfer once and drops one the phone has already given up on', async () => {
    const done = vi.fn(() => Promise.resolve());
    const ev = { id: 's11', sources: { rutor: false }, rutracker: false, phone: 'Pixel', at: 1_000 };
    await applyRemoteSourcesEvent(ev, { remoteSourcesDone: done }, () => [src('rutor')], noCtx, () => 2_000);
    await applyRemoteSourcesEvent(ev, { remoteSourcesDone: done }, () => [src('rutor')], noCtx, () => 2_000);
    expect(done).toHaveBeenCalledTimes(1);
    // older than the phone's 45 s wait: not applied, no answer (the native side has timed out already)
    const old = { id: 's12', sources: { rutor: true }, rutracker: false, phone: 'Pixel', at: 1_000 };
    await applyRemoteSourcesEvent(old, { remoteSourcesDone: done }, () => [src('rutor')], noCtx, () => 1_000 + 45_001);
    expect(done).toHaveBeenCalledTimes(1);
    expect(isSourceOn(src('rutor'))).toBe(false);
  });

  it('tells the screen again once the native side answered (a promoted login)', async () => {
    let heard = 0;
    const off = onTransferApplied(() => heard++);
    let answered = false;
    const done = vi.fn(() => { answered = true; return Promise.resolve(); });
    const before = () => heard;
    await applyRemoteSourcesEvent({ id: 's13', sources: { rutor: true }, rutracker: false, phone: 'P' }, { remoteSourcesDone: done }, () => [src('rutor')], noCtx);
    off();
    expect(answered).toBe(true);
    // switches, record, and once more after the answer
    expect(before()).toBeGreaterThanOrEqual(3);
  });

  it('a page that starts listening asks for the waiting transfer', async () => {
    const listeners: { [e: string]: ((d: any) => void)[] } = {};
    const plugin = {
      localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
      remoteSourcesDone: vi.fn(() => Promise.resolve()),
      remoteSourcesPending: vi.fn(() => Promise.resolve({ event: { id: 's14', sources: { 'ts-rutor': false }, rutracker: false, phone: 'Pixel', at: Date.now() } })),
      addListener: vi.fn((e: string, cb: (d: any) => void) => {
        (listeners[e] = listeners[e] || []).push(cb);
        return Promise.resolve({ remove: () => undefined });
      }),
    };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
    const off = installAndroidRemote(nativePlugin());
    for (let i = 0; i < 4; i++) await flush();
    expect(plugin.remoteSourcesPending).toHaveBeenCalledTimes(1);
    expect(plugin.remoteSourcesDone).toHaveBeenCalledWith({ id: 's14' });
    // the same transfer arriving live as well is not applied twice
    listeners.remoteSources[0]({ id: 's14', sources: { 'ts-rutor': false }, rutracker: false, phone: 'Pixel', at: Date.now() });
    for (let i = 0; i < 3; i++) await flush();
    expect(plugin.remoteSourcesDone).toHaveBeenCalledTimes(1);
    off();
  });
});
