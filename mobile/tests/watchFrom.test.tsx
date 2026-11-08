import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { WatchFrom } from '../src/screens/WatchFrom';
import {
  acceptedSsid,
  classifyWifiRead,
  nextManualSsid,
  readCurrentNetwork,
  removeDecision,
  selectDecision,
  setCurrentNetworkReader,
  type WifiRead,
} from '../src/servers/currentNetwork';
import { loadWifiPrefs, saveWifiPrefs, setWifiManual, setWifiOverride } from '../src/servers/wifiRun';
import { emptyWifiPrefs, rememberProfile } from '../src/servers/wifiSelect';
import { activeServerId, addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { currentRoute, resetTo } from '../src/nav';
import { nowPlaying } from '../src/tv/playerLink';
import { forgetPhoneLink, phoneLink, savePhoneLink } from '../../src/phone/phoneStore';
import { acceptConfirm, declineConfirm, mountConfirmHost, unmountConfirmHost } from './confirmHost';

function mount(): HTMLElement {
  let el = document.getElementById('app');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app';
    document.body.appendChild(el);
  }
  act(() => render(<WatchFrom />, el));
  mountConfirmHost();
  return el;
}

function click(el: HTMLElement, sel: string) {
  const node = el.querySelector<HTMLButtonElement>(sel);
  if (!node) throw new Error('missing ' + sel);
  return act(async () => {
    node.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

const origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  saveWifiPrefs(emptyWifiPrefs());
  setCurrentNetworkReader(null);
  nowPlaying.value = null;
  forgetPhoneLink();
  resetTo({ name: 'watchFrom' });
});

afterEach(() => {
  globalThis.fetch = origFetch;
  setCurrentNetworkReader(null);
  nowPlaying.value = null;
  forgetPhoneLink();
  const el = document.getElementById('app');
  if (el) act(() => render(null, el));
  unmountConfirmHost();
});

describe('current network read', () => {
  it('keeps a real name and refuses every other state', () => {
    expect(classifyWifiRead({ permission: 'granted', location: 'on', transport: 'wifi', ssid: '"Home"' })).toEqual({
      kind: 'ok',
      ssid: 'home',
    });
    const denied = [
      classifyWifiRead(null),
      classifyWifiRead({ unsupported: true, permission: 'granted', ssid: 'Home' }),
      classifyWifiRead({ permission: 'prompt', transport: 'wifi', ssid: 'Home' }),
      classifyWifiRead({ permission: 'denied', transport: 'wifi', ssid: 'Home' }),
      classifyWifiRead({ permission: 'blocked', location: 'on', transport: 'wifi', ssid: 'Home' }),
      classifyWifiRead({ permission: 'granted', location: 'off', transport: 'wifi', ssid: '<unknown ssid>' }),
      classifyWifiRead({ permission: 'granted', location: 'on', transport: 'other', ssid: 'Home' }),
      classifyWifiRead({ permission: 'granted', location: 'on', transport: 'none', ssid: null }),
      classifyWifiRead({ permission: 'granted', location: 'on', transport: 'wifi', ssid: '<unknown ssid>' }),
      classifyWifiRead({ permission: 'granted', location: 'on', transport: 'wifi', ssid: '0x1122' }),
      classifyWifiRead({ permission: 'granted', location: 'off', transport: 'unknown', ssid: '' }),
    ];
    expect(denied.map((r) => r.kind)).toEqual([
      'unsupported',
      'unsupported',
      'prompt',
      'denied',
      'blocked',
      'location',
      'nowifi',
      'nowifi',
      'hidden',
      'hidden',
      'location',
    ]);
    denied.forEach((r) => expect(acceptedSsid(r)).toBeNull());
    expect(nextManualSsid('typed', { kind: 'denied', ssid: null })).toBe('typed');
    expect(nextManualSsid('typed', { kind: 'ok', ssid: 'home' })).toBe('home');
    expect(selectDecision(true)).toBe('defer');
    expect(selectDecision(false)).toBe('apply');
    expect(removeDecision(false)).toBe('cancel');
    expect(removeDecision(true)).toBe('remove');
  });

  it('a browser read is unsupported and does not invent a name', async () => {
    expect(await readCurrentNetwork(false)).toEqual({ kind: 'unsupported', ssid: null });
    expect(await readCurrentNetwork(true)).toEqual({ kind: 'unsupported', ssid: null });
  });

  it('stores a typed name and leaves it when the phone cannot read one', () => {
    setWifiManual('Kitchen');
    expect(loadWifiPrefs().manualSsid).toBe('Kitchen');
    expect(nextManualSsid(loadWifiPrefs().manualSsid, { kind: 'blocked', ssid: null })).toBe('Kitchen');
  });
});

describe('WatchFrom', () => {
  it('uses a granted network name and does not switch while playing', async () => {
    const a = addServer({ url: 'http://10.0.0.2:8090', name: 'Home' });
    const b = addServer({ url: 'http://10.0.0.3:8090', name: 'Other' });
    setActiveServer(a.id);
    savePhoneLink({ url: 'http://tv.local:8090', token: 'tok', name: 'TV' });
    const link = phoneLink.value && phoneLink.value.url;
    setCurrentNetworkReader(async () => ({ kind: 'ok', ssid: 'home-lan' }));
    nowPlaying.value = { hash: 'playing' } as never;
    const el = mount();
    await click(el, '[data-action="current"]');
    expect(loadWifiPrefs().manualSsid).toBe('home-lan');
    expect(el.querySelector('[data-net-note]')!.textContent).toContain('Сервер сменится после остановки');
    expect(activeServerId.value).toBe(a.id);
    expect(phoneLink.value && phoneLink.value.url).toBe(link);
    nowPlaying.value = null;
    await click(el, '[data-select="' + b.id + '"]');
    expect(activeServerId.value).toBe(b.id);
    expect(phoneLink.value && phoneLink.value.url).toBe(link);
  });

  it('asks before the permission and keeps the typed name if the person says no', async () => {
    setWifiManual('typed');
    let asks = 0;
    setCurrentNetworkReader(async (ask) => {
      asks++;
      expect(ask).toBe(false);
      return { kind: 'prompt', ssid: null };
    });
    const el = mount();
    await click(el, '[data-action="current"]');
    expect(document.getElementById('m-confirm-msg')!.textContent).toContain('Android просит разрешение');
    await declineConfirm();
    expect(asks).toBe(1);
    expect(loadWifiPrefs().manualSsid).toBe('typed');
    expect(el.querySelector('[data-net-note]')!.textContent).toContain('Введите его вручную');
  });

  it('reads the name only after the person allows the permission', async () => {
    const seen: boolean[] = [];
    setCurrentNetworkReader(async (ask) => {
      seen.push(ask);
      return ask ? { kind: 'ok', ssid: 'office' } : { kind: 'prompt', ssid: null };
    });
    const el = mount();
    await click(el, '[data-action="current"]');
    await acceptConfirm();
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(seen).toEqual([false, true]);
    expect(loadWifiPrefs().manualSsid).toBe('office');
    expect(el.querySelector('[data-net-note]')!.textContent).toContain('office');
  });

  it('says why a read failed and does not replace the typed name', async () => {
    const cases: { read: WifiRead; text: string }[] = [
      { read: { kind: 'denied', ssid: null }, text: 'Разрешение не дано' },
      { read: { kind: 'blocked', ssid: null }, text: 'настройках Android' },
      { read: { kind: 'location', ssid: null }, text: 'геолокации выключена' },
      { read: { kind: 'nowifi', ssid: null }, text: 'не в сети Wi-Fi' },
      { read: { kind: 'hidden', ssid: null }, text: 'Сеть скрыта' },
      { read: { kind: 'unsupported', ssid: null }, text: 'прочитать нельзя' },
    ];
    for (const c of cases) {
      setWifiManual('typed');
      setCurrentNetworkReader(async (ask) => (c.read.kind === 'denied' && !ask ? { kind: 'denied', ssid: null } : c.read));
      const el = mount();
      await click(el, '[data-action="current"]');
      if (c.read.kind === 'denied') await acceptConfirm();
      await act(async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
      });
      expect(loadWifiPrefs().manualSsid).toBe('typed');
      expect(el.querySelector('[data-net-note]')!.textContent).toContain(c.text);
    }
  });

  it('cancel keeps the server, confirm removes it, check reports a miss', async () => {
    const a = addServer({ url: 'http://10.0.0.8:8090', name: 'Keep' });
    const el = mount();
    await click(el, '[data-remove="' + a.id + '"]');
    await declineConfirm();
    expect(servers.value.some((s) => s.id === a.id)).toBe(true);
    await click(el, '[data-check="' + a.id + '"]');
    expect(el.querySelector('[data-check-line="' + a.id + '"]')!.textContent).toContain('не отвечает');
    await click(el, '[data-remove="' + a.id + '"]');
    await acceptConfirm();
    expect(servers.value.some((s) => s.id === a.id)).toBe(false);
  });

  it('select is deferred while playing, and edit or add leave this screen', async () => {
    const a = addServer({ url: 'http://10.0.0.2:8090', name: 'Home' });
    const b = addServer({ url: 'http://10.0.0.3:8090', name: 'Other' });
    setActiveServer(a.id);
    nowPlaying.value = { hash: 'playing' } as never;
    const el = mount();
    await click(el, '[data-select="' + b.id + '"]');
    expect(activeServerId.value).toBe(a.id);
    expect(el.querySelector('[data-net-note]')!.textContent).toContain('после остановки');
    await click(el, '[data-action="discover"]');
    expect(activeServerId.value).toBe(a.id);
    nowPlaying.value = null;
    await click(el, '[data-edit="' + b.id + '"]');
    expect(currentRoute.value).toEqual({ name: 'serverSettings', url: b.url });
    resetTo({ name: 'watchFrom' });
    await click(el, '[data-action="add"]');
    expect(currentRoute.value.name).toBe('connect');
  });

  it('fallback pick does not switch the active server, always-mode does not follow the network', async () => {
    const a = addServer({ url: 'http://10.0.0.2:8090', name: 'Home' });
    const b = addServer({ url: 'http://10.0.0.3:8090', name: 'Other' });
    setActiveServer(a.id);
    saveWifiPrefs(rememberProfile(emptyWifiPrefs(), 'home', a.id, a.url));
    const el = mount();
    expect(el.querySelector('[data-profile="home"]')).toBeTruthy();
    await click(el, '[data-forget="home"]');
    expect(loadWifiPrefs().profiles).toEqual([]);
    expect(activeServerId.value).toBe(a.id);
    await click(el, '[data-primary="' + b.id + '"]');
    expect(loadWifiPrefs().primaryId).toBe(b.id);
    expect(activeServerId.value).toBe(a.id);
    await click(el, '[data-mode="always"]');
    expect(loadWifiPrefs().overrideId).toBe(a.id);
    setCurrentNetworkReader(async () => ({ kind: 'ok', ssid: 'cafe' }));
    await click(el, '[data-action="current"]');
    expect(loadWifiPrefs().manualSsid).toBe('cafe');
    expect(activeServerId.value).toBe(a.id);
    expect(el.querySelector('[data-net-note]')!.textContent).toContain('всегда один сервер');
    setWifiOverride(null);
  });

  it('does not write the TV link and does not scan for a network list', () => {
    const src = [
      'mobile/src/screens/WatchFrom.tsx',
      'mobile/src/servers/currentNetwork.ts',
      'mobile/src/servers/wifiRun.ts',
    ].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toContain('phoneLink');
    expect(src).not.toContain('phoneStore');
    expect(src).not.toContain('startScan');
    expect(src).not.toContain('getScanResults');
  });
});
