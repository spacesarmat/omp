import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { installAndroidRemote, applyRemoteText } from '../../src/platform/androidRemote';
import { nativePlugin } from '../../src/platform/androidNative';
import { detachPhone, phoneAttached, setLinkTransport } from '../../src/phone/link';
import { currentRoute, resetTo } from '../../src/ui/nav';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { settings, resetSettings } from '../../src/store/settings';
import { lang } from '../../src/i18n';

const w = window as unknown as { Capacitor?: unknown };

/** window.Capacitor with a fake Plugins.OmpNative that records listeners. */
function fakePlugin() {
  const listeners: { [e: string]: ((d: any) => void)[] } = {};
  const plugin = {
    localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
    addListener: vi.fn((e: string, cb: (d: any) => void) => {
      (listeners[e] = listeners[e] || []).push(cb);
      return Promise.resolve({ remove: () => { listeners[e] = listeners[e].filter((x) => x !== cb); } });
    }),
  };
  w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
  return { plugin, listeners, emit: (e: string, d: any) => (listeners[e] || []).slice().forEach((cb) => cb(d)) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
let uninstall: (() => void) | null = null;

async function install() {
  const f = fakePlugin();
  uninstall = installAndroidRemote(nativePlugin());
  await flush();
  return f;
}

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  resetTo({ name: 'connect' });
});
afterEach(() => {
  // a language a test stored (remoteAttach lang) must not leak into the next one
  resetSettings();
  if (uninstall) uninstall();
  uninstall = null;
  delete w.Capacitor;
  detachPhone();
  setLinkTransport(null);
  document.body.innerHTML = '';
});

function keyLog() {
  const codes: number[] = [];
  const l = (e: KeyboardEvent) => codes.push(e.keyCode);
  window.addEventListener('keydown', l, true);
  return { codes, stop: () => window.removeEventListener('keydown', l, true) };
}

describe('installAndroidRemote', () => {
  it('is a no-op without the plugin', () => {
    expect(() => installAndroidRemote(null)()).not.toThrow();
  });

  it('runs launch params from the phone', async () => {
    const f = await install();
    f.emit('remoteLaunch', { params: { play: 'http://10.0.0.2:8090/stream/a.mkv', title: 'Фильм' } });
    expect(currentRoute.value.name).toBe('player');
    const r = currentRoute.value as { queue: { url: string; title: string }[] };
    expect(r.queue[0]).toEqual({ url: 'http://10.0.0.2:8090/stream/a.mkv', title: 'Фильм' });
  });

  it('accepts launch params as a JSON string too', async () => {
    const s = addServer({ url: '192.168.1.5:8090' });
    setActiveServer(s.id);
    const f = await install();
    f.emit('remoteLaunch', { params: JSON.stringify({ torrent: 'a'.repeat(40) }) });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'a'.repeat(40) });
  });

  it('attaches the phone link only for a valid report url', async () => {
    setLinkTransport(() => new Promise<string>(() => {}));
    const f = await install();
    f.emit('remoteAttach', { report: 'https://10.0.0.3:4000/omp/x' });
    f.emit('remoteAttach', { report: 'http://10.0.0.3/' + 'x'.repeat(200) });
    f.emit('remoteAttach', {});
    expect(phoneAttached.value).toBe(false);
    f.emit('remoteAttach', { report: ' http://10.0.0.3:4000/omp/x ' });
    expect(phoneAttached.value).toBe(true);
    expect(currentRoute.value.name).toBe('connect');
  });

  it('remoteAttach with lang stores the phone language; an unknown one is ignored', async () => {
    setLinkTransport(() => new Promise<string>(() => {}));
    const f = await install();
    f.emit('remoteAttach', { report: 'http://10.0.0.3:4000/omp/x', lang: 'de' });
    expect(settings.value.language).toBe('system');
    f.emit('remoteAttach', { report: 'http://10.0.0.3:4000/omp/x', lang: 'en' });
    expect(settings.value.language).toBe('en');
    expect(lang.value).toBe('en');
  });

  it('turns remote keys into webOS key codes', async () => {
    const f = await install();
    const log = keyLog();
    try {
      for (const name of ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'POWER', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'MENU']) f.emit('remoteKey', { name });
    } finally {
      log.stop();
    }
    expect(log.codes).toEqual([38, 40, 37, 39, 13, 461, 403, 404, 405, 406, 457]);
  });

  it('CATALOG resets to the library (connect without a server)', async () => {
    const f = await install();
    f.emit('remoteKey', { name: 'CATALOG' });
    expect(currentRoute.value.name).toBe('connect');
    const s = addServer({ url: '192.168.1.5:8090' });
    setActiveServer(s.id);
    resetTo({ name: 'settings' });
    f.emit('remoteKey', { name: 'CATALOG' });
    expect(currentRoute.value.name).toBe('library');
  });

  it('stops listening once uninstalled', async () => {
    const f = await install();
    uninstall!();
    uninstall = null;
    expect(Object.keys(f.listeners).every((k) => f.listeners[k].length === 0)).toBe(true);
  });
});

describe('remote text', () => {
  function field(value = '') {
    const input = document.createElement('input');
    input.value = value;
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    document.body.appendChild(input);
    return { input, seen };
  }

  it('types into the focused input at the caret and fires input events', async () => {
    const f = await install();
    const { input, seen } = field('ад');
    input.focus();
    input.setSelectionRange(1, 1);
    f.emit('remoteText', { text: 'мери' });
    expect(input.value).toBe('америд');
    expect(input.selectionStart).toBe(5);
    f.emit('remoteText', { delete: 2 });
    expect(input.value).toBe('амед');
    expect(seen).toEqual(['америд', 'амед']);
  });

  it('replaces a selection and joins lines in a single-line input', () => {
    const { input } = field('hello');
    input.focus();
    input.setSelectionRange(1, 4);
    applyRemoteText({ text: 'a\nb' });
    expect(input.value).toBe('ha bo');
  });

  it('uses the input of the focused TextInput row when nothing has DOM focus', () => {
    const row = document.createElement('div');
    row.className = 'focusable text-input focused';
    const { input } = field('Матр');
    row.appendChild(input);
    document.body.appendChild(row);
    applyRemoteText({ text: 'ица' });
    expect(input.value).toBe('Матрица');
    applyRemoteText({ delete: 100 });
    expect(input.value).toBe('');
  });

  it('Enter goes to the field as keyCode 13', () => {
    const { input } = field('x');
    input.focus();
    const codes: number[] = [];
    input.addEventListener('keydown', (e) => codes.push(e.keyCode));
    applyRemoteText({ enter: true });
    expect(codes).toEqual([13]);
  });

  it('ignores text without a field and malformed payloads', () => {
    expect(() => applyRemoteText({ text: 'abc' })).not.toThrow();
    const { input } = field('abc');
    input.focus();
    applyRemoteText({ delete: 'x' });
    applyRemoteText(null);
    applyRemoteText({ text: '' });
    expect(input.value).toBe('abc');
  });

  it('does not type into a read-only field', () => {
    const { input } = field('abc');
    input.readOnly = true;
    input.focus();
    applyRemoteText({ text: 'd' });
    expect(input.value).toBe('abc');
  });
});

