// Wire messages for LG webOS, Samsung Tizen and Android TV Remote v2. No sockets.
import { registerMessage, requestMessage } from '../ssap';

export function lgPowerOff(id: string): object {
  return requestMessage(id, 'ssap://system/turnOff');
}

export function lgVolume(id: string, dir: 'up' | 'down'): { type: string; id: string; uri: string; payload: object } {
  return requestMessage(id, dir === 'up' ? 'ssap://audio/volumeUp' : 'ssap://audio/volumeDown') as {
    type: string;
    id: string;
    uri: string;
    payload: object;
  };
}

export function lgSwitchInput(id: string, inputId: string): object {
  return requestMessage(id, 'ssap://tv/switchInput', { inputId });
}

export function lgRegister(id: string, clientKey?: string): object {
  return registerMessage(id, clientKey);
}

export interface SamsungKey {
  method: 'ms.remote.control';
  params: { Cmd: 'Click'; DataOfCmd: string; Option: 'false'; TypeOfRemote: 'SendRemoteKey' };
}

/** A key click on the Samsung remote websocket. */
export function samsungKey(key: string): SamsungKey {
  return {
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  };
}

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Path of the Samsung remote websocket. The name is base64, the token is escaped. */
export function samsungSocketPath(name: string, token?: string): string {
  let path = '/api/v2/channels/samsung.remote.control?name=' + utf8Base64(name);
  if (token) path += '&token=' + encodeURIComponent(token);
  return path;
}

const TOKEN = /^[A-Za-z0-9+/=_-]{1,128}$/;

/** Token from `ms.channel.connect`. Null when the TV did not send a usable one. */
export function samsungToken(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as { event?: unknown; data?: { token?: unknown } };
  if (m.event !== 'ms.channel.connect') return null;
  const token = m.data && m.data.token;
  return typeof token === 'string' && TOKEN.test(token) ? token : null;
}

/** The TV closed the old pairing. The saved token must be dropped. */
export function samsungRejected(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  return (message as { event?: unknown }).event === 'ms.channel.unauthorized';
}

/**
 * What the phone does with a Samsung hello.
 * `retry` drops the saved token and opens the socket again without it.
 * `stop` means the TV still refuses, so the user has to allow the phone on the screen.
 */
export function samsungPlan(hadToken: boolean, message: unknown): 'retry' | 'stop' | 'save' | 'ok' {
  if (samsungRejected(message)) return hadToken ? 'retry' : 'stop';
  if (samsungToken(message)) return 'save';
  return 'ok';
}

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (v > 127) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function field(num: number, wire: number): number[] {
  return varint((num << 3) | wire);
}

function intField(num: number, value: number): number[] {
  return field(num, 0).concat(varint(value));
}

function bytesField(num: number, data: number[]): number[] {
  return field(num, 2).concat(varint(data.length), data);
}

function strField(num: number, s: string): number[] {
  return bytesField(num, Array.from(new TextEncoder().encode(s)));
}

/** PairingMessage: version 2, status 200, pairing_request { service_name, client_name }. */
export function atvPairingRequest(clientName: string): Uint8Array {
  const inner = strField(1, 'atvremote').concat(strField(2, clientName));
  return Uint8Array.from(intField(1, 2).concat(intField(2, 200), bytesField(10, inner)));
}

/** RemoteMessage remote_key_inject { key_code, direction }. Direction 3 is a short press. */
export function atvKeyInject(keyCode: number, direction: number): Uint8Array {
  return Uint8Array.from(bytesField(10, intField(1, keyCode).concat(intField(2, direction))));
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** SSDP ST of a TV we can drive. Cast is found elsewhere and is not this label. */
export function kindFromSt(st: string | undefined): 'lg' | 'samsung' | 'google' | null {
  const s = (st || '').trim().toLowerCase();
  if (s === 'urn:lge-com:service:webos-second-screen:1') return 'lg';
  if (s === 'urn:samsung.com:device:remotecontrolreceiver:1') return 'samsung';
  if (s === 'urn:dial-multiscreen-org:service:dial:1') return 'google';
  return null;
}

/** mDNS service type, trailing dots ignored. */
export function kindFromMdns(type: string): 'google' | 'learner' | null {
  const s = type.trim().toLowerCase().replace(/\.+$/, '');
  if (s === '_androidtvremote2._tcp') return 'google';
  if (s === '_omp-ir._tcp') return 'learner';
  return null;
}
