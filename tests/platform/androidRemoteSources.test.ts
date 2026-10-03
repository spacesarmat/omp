import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installAndroidRemote, applyRemoteSourcesEvent } from '../../src/platform/androidRemote';
import { nativePlugin } from '../../src/platform/androidNative';
import { isSourceOn, reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { lastTransfer } from '../../src/sources/transfer';
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
});
