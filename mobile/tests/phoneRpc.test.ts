import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { native } from '../src/platform/native';
import { monitorNative } from '../src/monitor/native';
import { tvs } from '../src/tv/tvStore';
import { tvSearchOn, initPhoneRpc, phoneParam, setTvSearch, TV_SEARCH_KEY } from '../src/tv/phoneRpc';

const INFO = { running: true, ip: '192.168.1.20', port: 8097, token: 'c'.repeat(32), name: 'Pixel' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('phoneRpc', () => {
  it('an Android TV alone does not turn it on: no prompt and no service', async () => {
    vi.resetModules();
    const nat = await import('../src/platform/native');
    const mon = await import('../src/monitor/native');
    const store = await import('../src/tv/tvStore');
    const rpc = await import('../src/tv/phoneRpc');
    const set = vi.spyOn(nat.native, 'rpcSetEnabled').mockResolvedValue(INFO);
    const perm = vi.spyOn(mon.monitorNative, 'notifyPermission').mockResolvedValue('prompt');
    const ask = vi.spyOn(mon.monitorNative, 'requestNotifyPermission').mockResolvedValue('granted');
    store.tvs.value = [{ ip: '192.168.1.60', name: 'Sony', kind: 'atv', token: 'd'.repeat(32) }];
    expect(rpc.tvSearchOn.value).toBe(false);
    rpc.initPhoneRpc();
    await flush();
    expect(set.mock.calls.every((c) => c[0] === false)).toBe(true);
    expect(perm).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(rpc.phoneParam()).toBeNull();
    // an LG next to it turns it on
    store.tvs.value = store.tvs.value.concat([{ ip: '192.168.1.50', name: 'LG' }]);
    expect(rpc.tvSearchOn.value).toBe(true);
    await flush();
    expect(set).toHaveBeenLastCalledWith(true);
  });

  it('defaults to on once a TV is saved and can be turned off', async () => {
    const set = vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue(INFO);
    tvs.value = [];
    expect(tvSearchOn.value).toBe(false);
    tvs.value = [{ ip: '192.168.1.50', name: 'LG' }];
    expect(tvSearchOn.value).toBe(true);
    initPhoneRpc();
    await Promise.resolve();
    expect(set).toHaveBeenLastCalledWith(true);
    expect(phoneParam()).toEqual({ url: 'http://192.168.1.20:8097', token: 'c'.repeat(32), name: 'Pixel' });
    await setTvSearch(false);
    expect(set).toHaveBeenLastCalledWith(false);
    expect(phoneParam()).toBeNull();
    expect(localStorage.getItem(TV_SEARCH_KEY)).toBe('false');
    // the stored choice wins over the saved TVs
    tvs.value = [{ ip: '192.168.1.50', name: 'LG' }, { ip: '192.168.1.51', name: 'LG 2' }];
    expect(tvSearchOn.value).toBe(false);
    await flush();
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('turning on asks for the notification permission and restarts the service once granted', async () => {
    const set = vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue(INFO);
    vi.spyOn(monitorNative, 'notifyPermission').mockResolvedValue('prompt');
    const ask = vi.spyOn(monitorNative, 'requestNotifyPermission').mockResolvedValue('granted');
    await setTvSearch(true);
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(set.mock.calls).toEqual([[true], [true]]);
    expect(phoneParam()).toEqual({ url: 'http://192.168.1.20:8097', token: 'c'.repeat(32), name: 'Pixel' });
  });

  it('does not ask again when notifications are already allowed', async () => {
    vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue(INFO);
    vi.spyOn(monitorNative, 'notifyPermission').mockResolvedValue('granted');
    const ask = vi.spyOn(monitorNative, 'requestNotifyPermission');
    await setTvSearch(true);
    await flush();
    expect(ask).not.toHaveBeenCalled();
  });

  it('has no address without Wi-Fi or when the service fails', async () => {
    vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue({ ...INFO, ip: null });
    await setTvSearch(true);
    expect(phoneParam()).toBeNull();
    vi.spyOn(native, 'rpcSetEnabled').mockRejectedValue(new Error('x'));
    await setTvSearch(true);
    expect(phoneParam()).toBeNull();
  });

  it('re-reads the address when the app comes back', async () => {
    vi.spyOn(native, 'rpcSetEnabled').mockResolvedValue(INFO);
    await setTvSearch(true);
    vi.spyOn(native, 'rpcInfo').mockResolvedValue({ ...INFO, ip: '192.168.1.77' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(phoneParam()!.url).toBe('http://192.168.1.77:8097');
  });
});
