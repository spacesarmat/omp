import { describe, it, expect, afterEach, vi } from 'vitest';
import { readLaunchParams, onRelaunch } from '../../src/platform/launch';

afterEach(() => { delete (window as any).PalmSystem; });

describe('launch params', () => {
  it('reads PalmSystem.launchParams', () => {
    expect(readLaunchParams()).toBeNull();
    (window as any).PalmSystem = { launchParams: '{"play":"https://a/b"}' };
    expect(readLaunchParams()).toBe('{"play":"https://a/b"}');
    (window as any).PalmSystem = { launchParams: '' };
    expect(readLaunchParams()).toBeNull();
  });
  it('fires on webOSRelaunch until unsubscribed', () => {
    const cb = vi.fn();
    const off = onRelaunch(cb);
    (window as any).PalmSystem = { launchParams: '{"torrent":"x"}' };
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(cb).toHaveBeenCalledWith('{"torrent":"x"}');
    off();
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('activates the window on relaunch before calling back, tolerating a throwing activate', () => {
    const order: string[] = [];
    (window as any).PalmSystem = { launchParams: '{}', activate: () => order.push('activate') };
    const off = onRelaunch(() => order.push('cb'));
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(order).toEqual(['activate', 'cb']);
    (window as any).PalmSystem = { launchParams: '{}', activate: () => { throw new Error('x'); } };
    document.dispatchEvent(new Event('webOSRelaunch'));
    expect(order).toEqual(['activate', 'cb', 'cb']);
    off();
  });
});
