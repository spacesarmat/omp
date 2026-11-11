import { describe, expect, it } from 'vitest';
import { broadcastAddress, browserUdpSend, magicPacket, netFromReport, sendWake, wakeTargets } from '../src/tv/power/wol';

function bytes(p: Uint8Array): number[] {
  return Array.from(p);
}

describe('Wake-on-LAN packet', () => {
  it('builds the 102-byte magic packet from a MAC', () => {
    const p = magicPacket('AA-BB-CC-DD-EE-FF');
    expect(p).toBeInstanceOf(Uint8Array);
    expect(p).toHaveLength(102);
    expect(bytes(p!.slice(0, 6))).toEqual([255, 255, 255, 255, 255, 255]);
    const mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    for (let i = 0; i < 16; i++) expect(bytes(p!.slice(6 + i * 6, 12 + i * 6))).toEqual(mac);
  });

  it('accepts colon, dash and bare hex, and rejects a bad MAC', () => {
    expect(bytes(magicPacket('aa:bb:cc:dd:ee:ff')!)).toEqual(bytes(magicPacket('aabbccddeeff')!));
    expect(magicPacket('aa:bb:cc:dd:ee')).toBeNull();
    expect(magicPacket('nope')).toBeNull();
    expect(magicPacket('')).toBeNull();
  });

  it('aims UDP 9 and 7 at the global broadcast and the /24 subnet broadcast', () => {
    expect(wakeTargets('192.168.1.5')).toEqual([
      { host: '255.255.255.255', port: 9 },
      { host: '255.255.255.255', port: 7 },
      { host: '192.168.1.255', port: 9 },
      { host: '192.168.1.255', port: 7 },
    ]);
  });

  it('uses the broadcast the device reported instead of assuming /24', () => {
    const hosts = wakeTargets('192.168.1.5', '10.0.0.255').map((t) => t.host);
    expect(hosts).toContain('10.0.0.255');
    expect(hosts).not.toContain('192.168.1.255');
    expect(wakeTargets('192.168.1.5', '10.0.0.255').filter((t) => t.host === '10.0.0.255').map((t) => t.port)).toEqual([9, 7]);
  });

  it('does not duplicate the global broadcast', () => {
    expect(wakeTargets('192.168.1.5', '255.255.255.255')).toEqual([
      { host: '255.255.255.255', port: 9 },
      { host: '255.255.255.255', port: 7 },
    ]);
  });

  it('computes a broadcast from an address and a netmask', () => {
    expect(broadcastAddress('192.168.1.40', '255.255.255.0')).toBe('192.168.1.255');
    expect(broadcastAddress('10.1.2.3', '255.255.0.0')).toBe('10.1.255.255');
    expect(broadcastAddress('bad', '255.255.255.0')).toBeNull();
    expect(broadcastAddress('192.168.1.1', '255.0.255.0')).toBeNull();
  });

  it('reads mac and broadcast from a device report', () => {
    expect(netFromReport({ mac: 'AA-BB-CC-DD-EE-FF', broadcast: '192.168.0.255' })).toEqual({
      mac: 'aa:bb:cc:dd:ee:ff',
      broadcast: '192.168.0.255',
    });
    expect(netFromReport({ mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.9', netmask: '255.255.255.0' })).toEqual({
      mac: 'aa:bb:cc:dd:ee:01',
      broadcast: '192.168.1.255',
    });
    expect(netFromReport({ mac: 'nope' })).toEqual({});
  });

  it('sends the packet three times to every target', async () => {
    const sent: string[] = [];
    await sendWake('aa:bb:cc:dd:ee:ff', '192.168.1.5', undefined, async (packet, host, port) => {
      sent.push(host + ':' + port + ':' + packet.length);
    });
    expect(sent.filter((s) => s === '192.168.1.255:9:102')).toHaveLength(3);
    expect(sent.filter((s) => s === '255.255.255.255:7:102')).toHaveLength(3);
    expect(sent).toHaveLength(12);
  });

  it('refuses a bad MAC before touching the socket', async () => {
    const sent: string[] = [];
    await expect(sendWake('nope', '192.168.1.5', undefined, async () => {
      sent.push('x');
    })).rejects.toThrow(/MAC/);
    expect(sent).toEqual([]);
  });

  it('has no browser UDP transport unless the page exposes one', () => {
    expect(browserUdpSend()).toBeNull();
  });
});
