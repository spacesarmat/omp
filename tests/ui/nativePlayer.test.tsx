import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { NativePlayerScreen } from '../../src/screens/NativePlayer';
import { DialogHost } from '../../src/ui/dialog';
import { routeStack, resetTo, navigate } from '../../src/ui/nav';
import { servers, activeServerId } from '../../src/store/servers';
import { saveProgress, reloadProgress, getLocalProgress } from '../../src/store/progress';
import { attachPhone, detachPhone, setLinkTransport } from '../../src/phone/link';
import type { PlayItem } from '../../src/player/types';

const H = 'b'.repeat(40);
const queue: PlayItem[] = [{ url: 'http://h:1/stream/f.mkv?link=' + H + '&index=3&play', title: 'Фильм', hash: H, fileIndex: 3 }];
const w = window as unknown as { Capacitor?: unknown };

/** window.Capacitor with a fake Plugins.OmpNative (the APK's injected bridge). */
function fakeCapacitor() {
  const listeners: { [e: string]: ((d: any) => void)[] } = {};
  const plugin = {
    localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
    downloadAndInstallApk: vi.fn(),
    playNative: vi.fn((_o: any) => Promise.resolve()),
    nativePlayerCommand: vi.fn((_o: any) => Promise.resolve()),
    addListener: vi.fn((e: string, cb: (d: any) => void) => {
      (listeners[e] = listeners[e] || []).push(cb);
      return Promise.resolve({ remove: () => { listeners[e] = listeners[e].filter((x) => x !== cb); } });
    }),
  };
  w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
  const fake = { plugin, emit: (e: string, d: any) => (listeners[e] || []).slice().forEach((cb) => cb(d)), listeners };
  fakes.push(fake);
  return fake;
}
const fakes: { emit: (e: string, d: any) => void }[] = [];

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

/** Unmounts and lets deferred effect cleanups (final progress save) run before the next test. */
async function unmount(host: HTMLElement) {
  render(null, host);
  await new Promise((r) => setTimeout(r, 60)); // Preact 11 runs unmount cleanups after paint (≤ 35 ms)
}

function mount(node: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(node, host);
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  reloadProgress();
  servers.value = [];
  activeServerId.value = null;
  resetTo({ name: 'library' });
  navigate({ name: 'player', queue, index: 0 });
});
afterEach(() => {
  // the native player closes: runs still listening (detached screens) end
  fakes.splice(0).forEach((f) => f.emit('nativePlayerClosed', { index: 0, time: 0, duration: 0 }));
  delete w.Capacitor;
  detachPhone();
  setLinkTransport(null);
});

describe('NativePlayerScreen (Android TV)', () => {
  it('opens the native player, shows the placeholder and goes back on close', async () => {
    const f = fakeCapacitor();
    const host = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    const arg = f.plugin.playNative.mock.calls[0][0];
    expect(arg.startAt).toBe(0);
    expect(arg.index).toBe(0);
    expect(arg.seekStep).toBe(10);
    expect(arg.queue[0].url).toBe(queue[0].url);
    await until(() => (host.textContent || '').indexOf('Плеер открыт на телевизоре') >= 0);
    f.emit('nativePlayerClosed', { index: 0, time: 600, duration: 1200 });
    expect(getLocalProgress(H, 3)!.time).toBe(600);
    expect(routeStack.value.length).toBe(1);
    expect(routeStack.value[0].name).toBe('library');
    await unmount(host);
  });

  it('asks «Продолжить просмотр?» in the TV UI before launching', async () => {
    saveProgress(H, 3, 300, 1200);
    const f = fakeCapacitor();
    const dlg = mount(h(DialogHost, {}));
    const host = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => dlg.querySelectorAll('.dialog-option').length === 2);
    expect(dlg.textContent).toContain('Продолжить просмотр?');
    expect(f.plugin.playNative).not.toHaveBeenCalled();
    (dlg.querySelectorAll('.dialog-option')[0] as HTMLElement).click();
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    expect(f.plugin.playNative.mock.calls[0][0].startAt).toBe(300);
    await unmount(host);
    await unmount(dlg);
  });

  it('an explicit startAt skips the question', async () => {
    saveProgress(H, 3, 300, 1200);
    const f = fakeCapacitor();
    const host = mount(h(NativePlayerScreen, { queue, index: 0, startAt: 42 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    expect(f.plugin.playNative.mock.calls[0][0].startAt).toBe(42);
    await unmount(host);
  });

  it('bridges the phone: snapshot from native state, commands to nativePlayerCommand', async () => {
    const f = fakeCapacitor();
    const bodies: string[] = [];
    let reply = '{"cmds":[]}';
    setLinkTransport((_u, body) => { bodies.push(body); const r = reply; reply = '{"cmds":[]}'; return Promise.resolve(r); });
    const host = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    attachPhone('http://phone:1/r');
    reply = '{"cmds":[{"id":1,"type":"pause"}]}';
    f.emit('nativePlayerState', {
      index: 0, time: 12, duration: 1200, paused: false, buffering: false,
      audio: { list: ['Русский'], sel: 0 }, subs: { list: [{ label: 'Выкл', value: 'off' }], sel: 'off' },
    });
    await until(() => bodies.some((b) => { const s = JSON.parse(b).state; return !!s && s.time === 12; }));
    const st = JSON.parse(bodies.filter((b) => JSON.parse(b).state)[0]).state;
    expect(st.hash).toBe(H);
    expect(st.audio).toEqual({ list: ['Русский'], sel: 0 });
    // the phone command (segments of the item go the same way, without a server: no chapters)
    const phoneCmds = () => f.plugin.nativePlayerCommand.mock.calls.map((c: any[]) => c[0].cmd).filter((c: any) => c.type !== 'segments');
    await until(() => phoneCmds().length === 1);
    expect(phoneCmds()[0]).toEqual({ id: 1, type: 'pause' });
    await unmount(host);
  });

  it('every native state event posts to the phone (page timers are throttled under the player)', async () => {
    const f = fakeCapacitor();
    const bodies: string[] = [];
    setLinkTransport((_u, body) => { bodies.push(body); return Promise.resolve('{"cmds":[]}'); });
    const host = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    attachPhone('http://phone:1/r');
    const times = (): number[] => bodies.map((b) => JSON.parse(b).state).filter((s) => !!s).map((s) => s.time);
    for (const t of [10, 11, 12]) {
      // only the time moves: the interval (500 ms) has not fired yet, so each post comes from the event
      f.emit('nativePlayerState', {
        index: 0, time: t, duration: 1200, paused: false, buffering: false,
        audio: { list: ['Русский'], sel: 0 }, subs: { list: [{ label: 'Выкл', value: 'off' }], sel: 'off' },
      });
      await new Promise((r) => setTimeout(r, 40));
      expect(times()).toContain(t);
    }
    expect(bodies.length).toBe(3);
    await unmount(host);
  });

  it('Back on the placeholder while launching keeps saving until the player closes', async () => {
    const f = fakeCapacitor();
    let launched: () => void = () => undefined;
    f.plugin.playNative.mockImplementation(() => new Promise<void>((r) => { launched = r; }));
    const host = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    await unmount(host);
    launched();
    const session = f.plugin.playNative.mock.calls[0][0].session;
    f.emit('nativePlayerClosed', { session, index: 0, time: 700, duration: 1200 });
    expect(getLocalProgress(H, 3)!.time).toBe(700);
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'player']);
  });

  it('a launch while the native player is open does not ask and continues from the saved position', async () => {
    const f = fakeCapacitor();
    const dlg = mount(h(DialogHost, {}));
    const first = mount(h(NativePlayerScreen, { queue, index: 0, startAt: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 1);
    saveProgress(H, 3, 300, 1200);
    await unmount(first);
    const second = mount(h(NativePlayerScreen, { queue, index: 0 }));
    await until(() => f.plugin.playNative.mock.calls.length === 2);
    expect(dlg.querySelectorAll('.dialog-option').length).toBe(0);
    expect(f.plugin.playNative.mock.calls[1][0].startAt).toBe(300);
    expect(f.plugin.playNative.mock.calls[1][0].queue[0].resume).toBe(300);
    await unmount(second);
    await unmount(dlg);
  });

  it('a launch failure shows the native message and leaves', async () => {
    const f = fakeCapacitor();
    f.plugin.playNative.mockImplementation(() => Promise.reject({ message: 'Не удалось запустить плеер' }));
    const host = mount(h(NativePlayerScreen, { queue, index: 0, startAt: 0 }));
    await until(() => routeStack.value.length === 1);
    expect(f.listeners.nativePlayerState.length).toBe(0);
    await unmount(host);
  });
});
