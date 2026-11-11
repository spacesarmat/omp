// Devices the person added by MAC, for Wake-on-LAN when OMP is not installed there.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../../src/store/storage';
import { normalizeMac } from '../tvStore';

export interface ManualDevice {
  mac: string;
  name: string;
  ip?: string;
  broadcast?: string;
}

const KEY = 'tsp.wolManual';
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const MAX_NAME = 40;

export function sanitizeManual(v: unknown): ManualDevice[] {
  if (!Array.isArray(v)) return [];
  const out: ManualDevice[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const mac = normalizeMac(item.mac);
    if (!mac || out.some((d) => d.mac === mac)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, MAX_NAME) : mac;
    const device: ManualDevice = { mac, name };
    if (typeof item.ip === 'string' && IPV4.test(item.ip)) device.ip = item.ip;
    if (typeof item.broadcast === 'string' && IPV4.test(item.broadcast)) device.broadcast = item.broadcast;
    out.push(device);
    if (out.length >= 20) break;
  }
  return out;
}

function load(): ManualDevice[] {
  return sanitizeManual(loadJson<unknown>(KEY, [], Array.isArray));
}

export const manualDevices = signal<ManualDevice[]>(load());

function persist(): void {
  saveJson(KEY, manualDevices.value);
}

export function reloadManual(): void {
  manualDevices.value = load();
}

export function addManual(d: ManualDevice): void {
  const list = sanitizeManual([d].concat(manualDevices.value.filter((x) => x.mac !== d.mac)));
  manualDevices.value = list;
  persist();
}

export function forgetManual(mac: string): void {
  manualDevices.value = manualDevices.value.filter((d) => d.mac !== mac);
  persist();
}
