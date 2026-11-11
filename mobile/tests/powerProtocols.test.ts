import { describe, expect, it } from 'vitest';
import {
  atvKeyInject,
  atvPairingRequest,
  bytesToHex,
  kindFromMdns,
  kindFromSt,
  lgPowerOff,
  lgRegister,
  lgSwitchInput,
  lgVolume,
  samsungKey,
  samsungSocketPath,
  samsungToken,
} from '../src/tv/power/protocols';

describe('LG SSAP power messages', () => {
  it('turns the TV off, changes volume and switches an input', () => {
    expect(lgPowerOff('1')).toEqual({ type: 'request', id: '1', uri: 'ssap://system/turnOff', payload: {} });
    expect(lgVolume('2', 'up')).toEqual({ type: 'request', id: '2', uri: 'ssap://audio/volumeUp', payload: {} });
    expect(lgVolume('3', 'down').uri).toBe('ssap://audio/volumeDown');
    expect(lgSwitchInput('4', 'HDMI_1')).toEqual({
      type: 'request',
      id: '4',
      uri: 'ssap://tv/switchInput',
      payload: { inputId: 'HDMI_1' },
    });
  });

  it('registers with a prompt pairing, and keeps a saved client key', () => {
    const fresh = lgRegister('5') as { payload: { pairingType: string; 'client-key'?: string } };
    expect(fresh.payload.pairingType).toBe('PROMPT');
    expect(fresh.payload['client-key']).toBeUndefined();
    const again = lgRegister('6', 'saved-key') as { payload: { 'client-key': string } };
    expect(again.payload['client-key']).toBe('saved-key');
  });
});

describe('Samsung remote messages', () => {
  it('sends KEY_POWER as a click', () => {
    expect(samsungKey('KEY_POWER')).toEqual({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: 'KEY_POWER',
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    });
    expect(samsungKey('KEY_VOLUP').params.DataOfCmd).toBe('KEY_VOLUP');
  });

  it('builds the websocket path and reads the pairing token', () => {
    expect(samsungSocketPath('OMP')).toBe('/api/v2/channels/samsung.remote.control?name=T01Q');
    expect(samsungSocketPath('OMP', 'a+b')).toBe('/api/v2/channels/samsung.remote.control?name=T01Q&token=a%2Bb');
    expect(samsungToken({ event: 'ms.channel.connect', data: { token: 'abc' } })).toBe('abc');
    expect(samsungToken({ event: 'ms.channel.unauthorized' })).toBeNull();
    expect(samsungToken({ event: 'ms.channel.connect', data: { token: 'bad token' } })).toBeNull();
  });
});

describe('Android TV Remote v2 bytes', () => {
  it('matches the known pairing request and the power key', () => {
    expect(bytesToHex(atvPairingRequest('S21'))).toBe('080210c80152100a0961747672656d6f74651203533231');
    // key 26 (POWER), direction 3 (short)
    expect(bytesToHex(atvKeyInject(26, 3))).toBe('5204081a1003');
    // the same layout the box channel already sends for DPAD_UP
    expect(bytesToHex(atvKeyInject(19, 3))).toBe('520408131003');
  });
});

describe('LAN discovery labels', () => {
  it('classifies SSDP and mDNS names', () => {
    expect(kindFromSt('urn:lge-com:service:webos-second-screen:1')).toBe('lg');
    expect(kindFromSt('urn:samsung.com:device:RemoteControlReceiver:1')).toBe('samsung');
    expect(kindFromSt('urn:dial-multiscreen-org:service:dial:1')).toBe('google');
    expect(kindFromSt('upnp:rootdevice')).toBeNull();
    expect(kindFromMdns('_androidtvremote2._tcp.')).toBe('google');
    expect(kindFromMdns('_omp-ir._tcp')).toBe('learner');
    expect(kindFromMdns('_googlecast._tcp')).toBeNull();
  });
});
