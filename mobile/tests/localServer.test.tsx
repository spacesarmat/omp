import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  localServer,
  localAutostart,
  setLocalServerDeps,
  reloadLocalServerSettings,
  refreshLocalServer,
  startLocal,
  stopLocal,
  setAutostart,
  setupLocal,
  autostartLocal,
  needsDownload,
  canRun,
  downloadSize,
  isDownloadCancelled,
  LOCAL_URL,
} from '../src/server/localServer';
import { logEntries } from '../../src/lib/log';
import { activeServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import type { LocalServerInfo } from '../src/platform/native';

function fakeNative(over: Partial<{ info: LocalServerInfo; startError: string }> = {}) {
  const calls: string[] = [];
  let info: LocalServerInfo = over.info ?? { supported: true, running: false };
  const native = {
    async localServerInfo() {
      calls.push('info');
      return info;
    },
    async startLocalServer() {
      calls.push('start');
      if (over.startError) throw new Error(over.startError);
      info = { supported: true, running: true, version: 'MatriX.145.1', ip: '192.168.1.50' };
      return info;
    },
    async stopLocalServer() {
      calls.push('stop');
      info = { supported: true, running: false };
    },
    onLocalServerState: () => () => {},
  };
  return { native, calls };
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  reloadLocalServerSettings();
  localServer.value = { supported: false, running: false };
});

afterEach(() => setLocalServerDeps(null));

describe('local server store', () => {
  it('refresh copies the plugin state', async () => {
    const f = fakeNative({ info: { supported: true, running: true, version: 'v', ip: '10.0.0.2' } });
    setLocalServerDeps({ native: f.native as any });
    await refreshLocalServer();
    expect(localServer.value).toEqual({ supported: true, running: true, version: 'v', ip: '10.0.0.2' });
  });

  it('refresh keeps the vpn flag', async () => {
    const f = fakeNative({ info: { supported: true, running: true, ip: '10.0.0.2', vpn: true } });
    setLocalServerDeps({ native: f.native as any });
    await refreshLocalServer();
    expect(localServer.value.vpn).toBe(true);
  });

  it('startLocal starts and refreshes; a failure lands in the store', async () => {
    const f = fakeNative();
    setLocalServerDeps({ native: f.native as any });
    await startLocal();
    expect(localServer.value.running).toBe(true);
    const bad = fakeNative({ startError: 'Не запустился' });
    setLocalServerDeps({ native: bad.native as any });
    localServer.value = { supported: true, running: false };
    await startLocal();
    expect(localServer.value).toMatchObject({ running: false, error: 'Не запустился' });
  });

  it('stopLocal stops and refreshes', async () => {
    const f = fakeNative();
    setLocalServerDeps({ native: f.native as any });
    await startLocal();
    await stopLocal();
    expect(localServer.value.running).toBe(false);
  });

  it('autostart persists in tsp.localServer', () => {
    expect(localAutostart.value).toBe(false);
    setAutostart(true);
    expect(JSON.parse(localStorage.getItem('tsp.localServer')!)).toEqual({ autostart: true });
    localAutostart.value = false;
    reloadLocalServerSettings();
    expect(localAutostart.value).toBe(true);
  });

  it('ignores a corrupt autostart value', () => {
    localStorage.setItem('tsp.localServer', '{"autostart":"yes"}');
    reloadLocalServerSettings();
    expect(localAutostart.value).toBe(false);
  });

  it('setupLocal runs the four steps, saves «Этот телефон», activates it and turns autostart on', async () => {
    const f = fakeNative();
    const echoed: string[] = [];
    setLocalServerDeps({ native: f.native as any, echo: async (u) => (echoed.push(u), 'MatriX.145.1') });
    const steps: number[] = [];
    await setupLocal((i) => steps.push(i));
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    expect(f.calls).toContain('start');
    expect(echoed).toEqual([LOCAL_URL]);
    expect(servers.value).toHaveLength(1);
    expect(servers.value[0]).toMatchObject({ name: 'Этот телефон', url: 'http://127.0.0.1:8090' });
    expect(activeServer.value?.url).toBe(LOCAL_URL);
    expect(localAutostart.value).toBe(true);
  });

  it('setupLocal keeps an explicit autostart=false', async () => {
    setAutostart(false);
    const f = fakeNative();
    setLocalServerDeps({ native: f.native as any, echo: async () => 'x' });
    await setupLocal(() => {});
    expect(localAutostart.value).toBe(false);
  });

  it('startLocal turns autostart on the first time and keeps an explicit off', async () => {
    const f = fakeNative();
    setLocalServerDeps({ native: f.native as any });
    await startLocal();
    expect(localAutostart.value).toBe(true);
    setAutostart(false);
    await startLocal();
    expect(localAutostart.value).toBe(false);
  });

  it('setupLocal stops at the failing step', async () => {
    const f = fakeNative();
    setLocalServerDeps({
      native: f.native as any,
      echo: async () => {
        throw new Error('нет связи');
      },
    });
    const steps: number[] = [];
    await expect(setupLocal((i) => steps.push(i))).rejects.toThrow('нет связи');
    expect(steps).toEqual([0, 1, 2]);
    expect(servers.value).toHaveLength(0);
  });

  it('setupLocal rejects when the phone is not supported', async () => {
    const f = fakeNative({ info: { supported: false, running: false } });
    setLocalServerDeps({ native: f.native as any });
    await expect(setupLocal(() => {})).rejects.toThrow();
    expect(f.calls).not.toContain('start');
  });

  it('autostart starts silently only when enabled, supported and stopped', async () => {
    const f = fakeNative();
    setLocalServerDeps({ native: f.native as any });
    await autostartLocal();
    expect(f.calls).not.toContain('start');
    setAutostart(true);
    await autostartLocal();
    expect(f.calls).toContain('start');
    const g = fakeNative({ info: { supported: false, running: false } });
    setLocalServerDeps({ native: g.native as any });
    await autostartLocal();
    expect(g.calls).not.toContain('start');
    const h = fakeNative({ info: { supported: true, running: true } });
    setLocalServerDeps({ native: h.native as any });
    await autostartLocal();
    expect(h.calls).not.toContain('start');
  });

  it('reads the binary state', () => {
    expect(needsDownload({ supported: true, running: false, binary: 'missing' })).toBe(true);
    expect(needsDownload({ supported: true, running: false, binary: 'outdated' })).toBe(true);
    expect(needsDownload({ supported: true, running: false, binary: 'ready' })).toBe(false);
    expect(needsDownload({ supported: false, running: false, binary: 'missing' })).toBe(false);
    expect(canRun({ supported: true, running: false, binary: 'outdated' })).toBe(true);
    expect(canRun({ supported: true, running: false, binary: 'missing' })).toBe(false);
    expect(canRun({ supported: true, running: false })).toBe(true);
    expect(downloadSize({ supported: true, running: false, downloadBytes: 64174032 })).toBe('~61 МБ');
    expect(downloadSize({ supported: true, running: false })).toBe('');
    expect(isDownloadCancelled(Object.assign(new Error('x'), { code: 'cancelled' }))).toBe(true);
    expect(isDownloadCancelled(new Error('x'))).toBe(false);
  });

  function withBinary(binary: 'missing' | 'outdated', running = false) {
    const f = fakeNative({ info: { supported: true, running, binary, pinVersion: 'MatriX.146', ...(running ? { version: 'MatriX.145.1' } : {}) } });
    const native: any = {
      ...f.native,
      async downloadLocalServer(cb: (p: any) => void) {
        f.calls.push('download');
        cb({ phase: 'download', percent: 50 });
        cb({ phase: 'verify' });
        return { supported: true, running, binary: 'ready' };
      },
    };
    return { native, calls: f.calls };
  }

  it('setupLocal downloads a missing binary in the first step, logs generically, then starts', async () => {
    const f = withBinary('missing');
    setLocalServerDeps({ native: f.native, echo: async () => 'MatriX.146' });
    const steps: Array<[number, string]> = [];
    const progress: any[] = [];
    await setupLocal((i, v) => steps.push([i, v]), (p) => progress.push(p));
    expect(f.calls).toEqual(['info', 'download', 'start', 'info']);
    expect(progress).toEqual([{ phase: 'download', percent: 50 }, { phase: 'verify' }]);
    expect(steps[0]).toEqual([0, 'MatriX.146']);
    expect(steps.map((s) => s[0])).toEqual([0, 0, 1, 2, 3, 4]);
    const texts = logEntries().filter((e) => e.a === 'server').map((e) => e.l + ':' + e.x);
    expect(texts).toContain('info:Скачивание встроенного TorrServer');
    expect(texts).toContain('info:Встроенный TorrServer скачан и проверен');
  });

  it('setupLocal restarts a running outdated server on the new binary, or skips the update when asked', async () => {
    const f = withBinary('outdated', true);
    setLocalServerDeps({ native: f.native, echo: async () => 'MatriX.146' });
    await setupLocal(() => {});
    expect(f.calls).toEqual(['info', 'download', 'stop', 'start', 'info']);
    const g = withBinary('outdated');
    setLocalServerDeps({ native: g.native, echo: async () => 'x' });
    await setupLocal(() => {}, () => {}, false);
    expect(g.calls).not.toContain('download');
    expect(g.calls).toContain('start');
    // a missing binary is downloaded even then
    const h = withBinary('missing');
    setLocalServerDeps({ native: h.native, echo: async () => 'x' });
    await setupLocal(() => {}, () => {}, false);
    expect(h.calls).toContain('download');
  });

  it('a failed download is logged as a warning without details and stops before the start', async () => {
    const f = withBinary('missing');
    f.native.downloadLocalServer = async () => {
      throw Object.assign(new Error('Не удалось скачать TorrServer: нет связи с GitHub. Проверьте интернет и повторите.'), { code: 'network' });
    };
    setLocalServerDeps({ native: f.native });
    await expect(setupLocal(() => {})).rejects.toThrow('Проверьте интернет');
    expect(f.calls).not.toContain('start');
    expect(logEntries().some((e) => e.a === 'server' && e.l === 'warn' && e.x === 'Не удалось скачать TorrServer')).toBe(true);
  });

  it('autostart never downloads: a missing binary is not started, an outdated one is', async () => {
    setAutostart(true);
    const f = withBinary('missing');
    setLocalServerDeps({ native: f.native });
    await autostartLocal();
    expect(f.calls).toEqual(['info']);
    const g = withBinary('outdated');
    setLocalServerDeps({ native: g.native });
    await autostartLocal();
    expect(g.calls).toContain('start');
    expect(g.calls).not.toContain('download');
  });

  it('autostart swallows a start error into the store', async () => {
    setAutostart(true);
    const f = fakeNative({ startError: 'плохо' });
    setLocalServerDeps({ native: f.native as any });
    await autostartLocal();
    expect(localServer.value.error).toBe('плохо');
  });
});
