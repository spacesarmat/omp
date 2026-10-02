import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

type Listener = (st: { isActive: boolean }) => void;
const hoisted = vi.hoisted(() => ({ listeners: {} as Record<string, (...a: any[]) => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (name: string, cb: (...a: any[]) => void) => {
      hoisted.listeners[name] = cb;
      return { remove: async () => {} };
    },
    exitApp: async () => {},
  },
}));

import { App } from '../src/app';
import { setTransport, cancelWarmUp, tvState, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv, setActiveTv } from '../src/tv/tvStore';
import { native } from '../src/platform/native';
import { resetTo } from '../src/nav';

let el: HTMLElement;
let connects: string[];
const transport: TvTransport = {
  tvConnect: async (ip) => {
    connects.push(ip);
    throw new Error('no route');
  },
  tvSend: async () => {},
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: async () => {},
  pointerSend: async () => {},
  tvDisconnect: async () => {},
};

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  reloadTvs();
  connects = [];
  hoisted.listeners = {};
  setTransport(transport);
  resetTo({ name: 'library' });
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
});

afterEach(() => {
  act(() => render(null, el));
  cancelWarmUp();
  setTransport(native);
  tvState.value = 'idle';
  vi.useRealTimers();
});

describe('app TV warm-up wiring', () => {
  it('does not connect at start without a TV', async () => {
    act(() => render(<App />, el));
    await tick();
    expect(connects).toEqual([]);
  });

  it('warms up at start with an active TV, stops in background and resumes in foreground', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG' });
    setActiveTv('192.168.1.5');
    act(() => render(<App />, el));
    await tick();
    expect(connects).toHaveLength(1);

    const onState = hoisted.listeners.appStateChange as Listener;
    onState({ isActive: false });
    await vi.advanceTimersByTimeAsync(10000);
    expect(connects).toHaveLength(1);

    onState({ isActive: true });
    await tick();
    expect(connects).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(connects).toHaveLength(3);
  });
});
