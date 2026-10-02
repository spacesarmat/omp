import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { installAndroidKeyBridge, sendKey } from '../../src/platform/androidKeys';
import { installKeyListener, pushKeyHandler } from '../../src/ui/keys';
import { routeStack, resetTo, navigate } from '../../src/ui/nav';
import { unhandledBack } from '../../src/app';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { DialogHost, dialogOpen } from '../../src/ui/dialog';
import type { KeyAction } from '../../src/platform/keys';

const w = window as unknown as { Capacitor?: unknown; __ompKey?: (c: number) => boolean; __ompBack?: () => boolean };
const cleanups: (() => void)[] = [];
beforeAll(() => {
  init({ debug: false, visualDebug: false });
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  delete w.Capacitor;
  document.body.innerHTML = '';
  resetTo({ name: 'connect' });
});

describe('Android TV key bridge', () => {
  it('installs and removes window.__ompKey / __ompBack', () => {
    const off = installAndroidKeyBridge();
    expect(typeof w.__ompKey).toBe('function');
    expect(typeof w.__ompBack).toBe('function');
    off();
    expect(w.__ompKey).toBeUndefined();
    expect(w.__ompBack).toBeUndefined();
  });

  it('media keys run the same handler path as a real keydown', () => {
    cleanups.push(installAndroidKeyBridge());
    cleanups.push(installKeyListener(() => true));
    const seen: KeyAction[] = [];
    cleanups.push(pushKeyHandler((a) => { seen.push(a); return true; }));
    [415, 19, 179, 417, 412, 33, 34, 413].forEach((c) => expect(w.__ompKey!(c)).toBe(true));
    expect(seen).toEqual(['play', 'pause', 'playpause', 'ff', 'rw', 'next', 'prev', 'stop']);
  });

  it('keydown targets the focused element', () => {
    cleanups.push(installAndroidKeyBridge());
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    let target: EventTarget | null = null;
    const h = (e: Event) => { target = e.target; };
    window.addEventListener('keydown', h, true);
    cleanups.push(() => window.removeEventListener('keydown', h, true));
    sendKey(461);
    expect(target).toBe(input);
  });

  it('Back: a screen handler consumes it → true', () => {
    cleanups.push(installAndroidKeyBridge());
    cleanups.push(installKeyListener(unhandledBack));
    cleanups.push(pushKeyHandler((a) => a === 'back'));
    expect(w.__ompBack!()).toBe(true);
  });

  it('Back pops the route stack, at the root on Android TV reports false (Activity closes)', () => {
    w.Capacitor = { getPlatform: () => 'android' };
    cleanups.push(installAndroidKeyBridge());
    cleanups.push(installKeyListener(unhandledBack));
    navigate({ name: 'settings' });
    expect(routeStack.value).toHaveLength(2);
    expect(w.__ompKey!(461)).toBe(true);
    expect(routeStack.value).toHaveLength(1);
    expect(w.__ompKey!(461)).toBe(false);
    expect(routeStack.value).toHaveLength(1);
  });

  it('webOS root Back is still taken by the app (exit confirmation)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { render(h(DialogHost, {}), host); }); // DialogHost registers its key handler in an effect
    cleanups.push(() => render(null, host));
    cleanups.push(installKeyListener(unhandledBack));
    act(() => { expect(sendKey(461)).toBe(true); });
    expect(dialogOpen.value).toBe(true);
    // Back closes the confirmation (DialogHost key handler)
    expect(sendKey(461)).toBe(true);
    expect(dialogOpen.value).toBe(false);
  });
});
