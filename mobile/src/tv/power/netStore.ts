// Samsung and Google TVs the phone can power on. The pairing token is not stored here.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../../src/store/storage';
import { normalizeMac } from '../tvStore';

export type NetKind = 'samsung' | 'google';

export interface NetDevice {
  id: string;
  kind: NetKind;
  ip: string;
  name: string;
  mac?: string;
  broadcast?: string;
  tokenStored?: boolean;
}

const KEY = 'tsp.netTvs';
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function netId(kind: NetKind, ip: string): string {
  return kind + ':' + ip;
}

export function sanitizeNet(v: unknown): NetDevice[] {
  if (!Array.isArray(v)) return [];
  const out: NetDevice[] = [];
  for (const item of v) {
    if (!isObject(item) || (item.kind !== 'samsung' && item.kind !== 'google')) continue;
    if (typeof item.ip !== 'string' || !IPV4.test(item.ip)) continue;
    const id = netId(item.kind, item.ip);
    if (out.some((d) => d.id === id)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 40) : item.ip;
    const device: NetDevice = { id, kind: item.kind, ip: item.ip, name };
    const mac = normalizeMac(item.mac);
    if (mac) device.mac = mac;
    if (typeof item.broadcast === 'string' && IPV4.test(item.broadcast)) device.broadcast = item.broadcast;
    if (item.tokenStored === true) device.tokenStored = true;
    out.push(device);
    if (out.length >= 20) break;
  }
  return out;
}

function load(): NetDevice[] {
  return sanitizeNet(loadJson<unknown>(KEY, [], Array.isArray));
}

export const netTvs = signal<NetDevice[]>(load());

function persist(): void {
  saveJson(KEY, netTvs.value);
}

export function reloadNet(): void {
  netTvs.value = load();
}

export function saveNet(d: NetDevice): void {
  const next = sanitizeNet([d].concat(netTvs.value.filter((x) => x.id !== d.id)));
  netTvs.value = next;
  persist();
}

export function markNetToken(id: string): void {
  netTvs.value = netTvs.value.map((d) => (d.id === id ? { ...d, tokenStored: true } : d));
  persist();
}

export function clearNetToken(id: string): void {
  netTvs.value = netTvs.value.map((d) => (d.id === id ? { ...d, tokenStored: false } : d));
  persist();
}
