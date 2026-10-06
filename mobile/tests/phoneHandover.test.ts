// The phone hands a changed search address (token, port, Wi-Fi IP) to a connected LG that shows OMP.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { RpcInfo } from '../src/platform/native';

const OMP = 'com.spacesarmat.torrplayer';
const INFO: RpcInfo = { running: true, ip: '192.168.1.20', port: 8097, token: 'c'.repeat(32), name: 'Pixel' };
const url = (i: RpcInfo) => 'http://' + i.ip + ':' + i.port;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface Launch {
  report?: string;
  phone: { url: string; token: string; name: string } | null;
}

async function setup(o: { connected?: boolean; first?: RpcInfo; gate?: Promise<void> } = {}) {
  vi.resetModules();
  localStorage.clear();
  const nat = await import('../src/platform/native');
  const store = await import('../src/tv/tvStore');
  const rpc = await import('../src/tv/phoneRpc');
  const link = await import('../src/tv/playerLink');
  store.tvs.value = [{ ip: '192.168.1.50', name: 'LG' }];
  const set = vi.spyOn(nat.native, 'rpcSetEnabled').mockResolvedValue(o.first || INFO);
  const info = vi.spyOn(nat.native, 'rpcInfo').mockResolvedValue(INFO);
  const launches: Launch[] = [];
  let gate = o.gate || null;
  link.setPlayerLinkDeps({
    now: () => 1000,
    tvIp: () => '192.168.1.50',
    tvFailed: () => false,
    tvKind: () => 'lg',
    foregroundAppId: async () => OMP,
    // as tvClient.launchOnTv: reads the address when the launch starts, marks it sent once the TV answered
    launchOnTv: async (p: object) => {
      const phone = rpc.phoneParam();
      if (gate) {
        const g = gate;
        gate = null;
        await g;
      }
      launches.push({ ...(p as { report?: string }), phone });
      rpc.markPhoneSent(phone);
    },
    native: {
      startPlayerServer: async () => 'http://192.168.1.2:8123/',
      queuePlayerCommands: async () => {},
      onPlayerMessage: () => () => {},
    } as any,
  });
  const connected = o.connected !== false;
  return { rpc, link, set, info, launches, init: () => rpc.initPhoneRpc({ lgConnected: () => connected, reattach: link.attachIfOmpForeground }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('phone address hand-over', () => {
  it('a new token after the switch goes off and on reaches the LG', async () => {
    const s = await setup();
    s.init();
    await flush();
    expect(s.launches.map((l) => l.phone && l.phone.token)).toEqual([INFO.token]);
    expect(s.launches[0].report).toBe('http://192.168.1.2:8123/');
    await s.rpc.setTvSearch(false);
    await flush();
    expect(s.launches).toHaveLength(1);
    s.set.mockResolvedValue({ ...INFO, token: 'd'.repeat(32) });
    await s.rpc.setTvSearch(true);
    await flush();
    expect(s.launches.map((l) => l.phone && l.phone.token)).toEqual([INFO.token, 'd'.repeat(32)]);
  });

  it('a service that binds late on a fallback port is handed over once it runs', async () => {
    vi.useFakeTimers();
    const s = await setup({ first: { ...INFO, running: false } });
    s.info.mockResolvedValue({ ...INFO, port: 40123 });
    s.init();
    await flush();
    expect(s.rpc.phoneParam()).toBeNull();
    expect(s.launches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(s.rpc.STARTING_RETRY_MS);
    await flush();
    expect(s.launches.map((l) => l.phone && l.phone.url)).toEqual(['http://192.168.1.20:40123']);
  });

  it('a new Wi-Fi address read on resume reaches the LG; the same one is not sent again', async () => {
    const s = await setup();
    s.init();
    await flush();
    expect(s.launches).toHaveLength(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(s.launches).toHaveLength(1);
    const moved = { ...INFO, ip: '192.168.1.77' };
    s.info.mockResolvedValue(moved);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(s.launches.map((l) => l.phone && l.phone.url)).toEqual([url(INFO), url(moved)]);
  });

  it('cold start: an attach already on its way without the address is followed by one with it', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const s = await setup({ gate });
    // the connect-time attach starts before the service answered
    const first = s.link.attachIfOmpForeground();
    await flush();
    s.init();
    await flush();
    open();
    await first;
    await flush();
    expect(s.launches.map((l) => l.phone && l.phone.token)).toEqual([null, INFO.token]);
  });

  it('nothing is sent while no LG is connected', async () => {
    const s = await setup({ connected: false });
    s.init();
    await flush();
    expect(s.launches).toHaveLength(0);
    expect(s.rpc.phoneParam()).not.toBeNull();
  });
});
