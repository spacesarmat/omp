import { describe, expect, it } from 'vitest';
import { mergeNet, type NetDevice } from '../src/tv/power/netStore';

const found: NetDevice = { id: 'google:192.168.1.20', kind: 'google', ip: '192.168.1.20', name: 'Box' };

describe('network TV merge', () => {
  it('keeps a MAC typed for a discovered TV when the next scan has none', () => {
    const saved: NetDevice = { ...found, mac: 'aa:bb:cc:dd:ee:ff', broadcast: '192.168.1.255', tokenStored: true };
    const again = mergeNet(saved, { ...found, name: 'Living room' });
    expect(again.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(again.broadcast).toBe('192.168.1.255');
    expect(again.tokenStored).toBe(true);
    expect(again.name).toBe('Living room');
    expect(mergeNet(saved, { ...found, mac: '11:22:33:44:55:66' }).mac).toBe('11:22:33:44:55:66');
    expect(mergeNet(undefined, found)).toEqual(found);
  });
});
