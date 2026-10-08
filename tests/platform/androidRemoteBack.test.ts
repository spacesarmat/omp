import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyRemoteKey } from '../../src/platform/androidRemote';

const w = window as unknown as { Capacitor?: unknown };

function fakePlugin() {
  const plugin = {
    localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
    addListener: vi.fn(() => Promise.resolve({ remove: () => undefined })),
    appBack: vi.fn(() => Promise.resolve()),
  };
  w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
  return plugin;
}

let off: (() => void) | null = null;
afterEach(() => {
  if (off) off();
  off = null;
  delete w.Capacitor;
});

describe('phone remote Back on Android TV', () => {
  it('closes the app when no screen takes Back (the library root)', () => {
    const p = fakePlugin();
    applyRemoteKey({ name: 'BACK' });
    expect(p.appBack).toHaveBeenCalledTimes(1);
  });

  it('leaves the app open when a screen handles Back', () => {
    const p = fakePlugin();
    const take = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', take);
    off = () => document.removeEventListener('keydown', take);
    applyRemoteKey({ name: 'BACK' });
    expect(p.appBack).not.toHaveBeenCalled();
  });

  it('other keys never close the app', () => {
    const p = fakePlugin();
    applyRemoteKey({ name: 'UP' });
    expect(p.appBack).not.toHaveBeenCalled();
  });
});
