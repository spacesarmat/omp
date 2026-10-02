import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../src/app';
import { native } from '../src/platform/native';
import { currentRoute, resetTo, afterConnectRoute } from '../src/nav';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';

let el: HTMLElement;

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => {
    render(<App />, el);
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  afterConnectRoute();
  resetTo({ name: 'library' });
});
afterEach(() => {
  act(() => render(null, el));
  vi.restoreAllMocks();
});

describe('magnet intake', () => {
  it('opens «Добавить» with a pending magnet on start', async () => {
    vi.spyOn(native, 'takePendingMagnet').mockResolvedValue('magnet:?xt=urn:btih:abc');
    vi.spyOn(native, 'onMagnet').mockReturnValue(() => {});
    await mount();
    expect(currentRoute.value).toEqual({ name: 'add', link: 'magnet:?xt=urn:btih:abc' });
  });

  it('follows magnets that arrive while running and unsubscribes on unmount', async () => {
    const off = vi.fn();
    let cb: (l: string) => void = () => {};
    vi.spyOn(native, 'takePendingMagnet').mockResolvedValue(null);
    vi.spyOn(native, 'onMagnet').mockImplementation((c) => ((cb = c), off));
    await mount();
    expect(currentRoute.value.name).toBe('library');
    act(() => cb('magnet:?xt=urn:btih:def'));
    expect(currentRoute.value).toEqual({ name: 'add', link: 'magnet:?xt=urn:btih:def' });
    act(() => render(null, el));
    expect(off).toHaveBeenCalled();
  });

  it('is a no-op when the native layer is unavailable', async () => {
    vi.spyOn(native, 'takePendingMagnet').mockRejectedValue(new Error('n/a'));
    await mount();
    expect(currentRoute.value.name).toBe('library');
  });

  it('without a server keeps «connect» and opens «Добавить» after the connect', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    resetTo({ name: 'connect' });
    vi.spyOn(native, 'takePendingMagnet').mockResolvedValue('magnet:?xt=urn:btih:abc');
    vi.spyOn(native, 'onMagnet').mockReturnValue(() => {});
    await mount();
    expect(currentRoute.value.name).toBe('connect');
    expect(afterConnectRoute()).toEqual({ name: 'add', link: 'magnet:?xt=urn:btih:abc' });
    expect(afterConnectRoute()).toEqual({ name: 'library' });
  });
});
