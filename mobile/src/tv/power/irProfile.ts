// Learned IR buttons, one list per device. Timings are not secrets.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../../src/store/storage';
import type { IrSignal } from './irCodes';

export interface LearnedButton extends IrSignal {
  id: string;
  name: string;
}

export interface IrProfile {
  deviceId: string;
  buttons: LearnedButton[];
}

const MAX_NAME = 40;
const MAX_BUTTONS = 40;
/** A device can already hold a full list under its IP and another under its MAC. Joining them must not drop either. */
const MAX_STORED = MAX_BUTTONS * 2;

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME);
}

/** Adds or replaces a button (same id) on `deviceId`. Other devices stay put. */
export function addLearned(list: IrProfile[], deviceId: string, button: LearnedButton): IrProfile[] {
  const name = cleanName(button.name) || 'Button';
  const next: LearnedButton = { id: button.id, name, frequency: button.frequency, pulses: button.pulses.slice() };
  const idx = list.findIndex((p) => p.deviceId === deviceId);
  if (idx < 0) return list.concat({ deviceId, buttons: [next] });
  const existing = list[idx].buttons;
  const replacing = existing.some((b) => b.id === button.id);
  if (!replacing && existing.length >= MAX_BUTTONS) return list;
  const buttons = existing.filter((b) => b.id !== button.id).concat(next);
  return list.map((p, i) => (i === idx ? { deviceId, buttons } : p));
}

/** Buttons learned before the MAC was known follow the device. The IP profile is removed. Every saved button is kept. */
export function moveLearned(list: IrProfile[], fromId: string, toId: string): IrProfile[] {
  if (!fromId || !toId || fromId === toId) return list;
  const fromIdx = list.findIndex((p) => p.deviceId === fromId);
  if (fromIdx < 0) return list;
  const toIdx = list.findIndex((p) => p.deviceId === toId);
  let buttons = list[fromIdx].buttons;
  if (toIdx >= 0) {
    const kept = new Set(list[toIdx].buttons.map((b) => b.id));
    buttons = list[toIdx].buttons.concat(buttons.filter((b) => !kept.has(b.id)));
  }
  return list.filter((_, i) => i !== fromIdx && i !== toIdx).concat({ deviceId: toId, buttons });
}

/** Renames a button. A blank name leaves the list unchanged. */
export function renameLearned(list: IrProfile[], deviceId: string, id: string, name: string): IrProfile[] {
  const next = cleanName(name);
  if (!next) return list;
  return list.map((p) => {
    if (p.deviceId !== deviceId) return p;
    return { deviceId, buttons: p.buttons.map((b) => (b.id === id ? { ...b, name: next } : b)) };
  });
}

/** Drops a button. A device with no buttons left is dropped too. */
export function deleteLearned(list: IrProfile[], deviceId: string, id: string): IrProfile[] {
  return list
    .map((p) => (p.deviceId === deviceId ? { deviceId, buttons: p.buttons.filter((b) => b.id !== id) } : p))
    .filter((p) => p.buttons.length > 0);
}

const KEY = 'tsp.irProfiles';

function pulseOk(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 20 && n <= 200000;
}

/** Drops broken buttons. A profile with none left is dropped. */
export function sanitizeProfiles(v: unknown): IrProfile[] {
  if (!Array.isArray(v)) return [];
  const out: IrProfile[] = [];
  for (const item of v) {
    if (!isObject(item) || typeof item.deviceId !== 'string' || !item.deviceId || item.deviceId.length > 80) continue;
    if (out.some((p) => p.deviceId === item.deviceId) || !Array.isArray(item.buttons)) continue;
    const buttons: LearnedButton[] = [];
    for (const raw of item.buttons) {
      if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.pulses)) continue;
      if (raw.pulses.length < 2 || raw.pulses.length > 512 || raw.pulses.some((n) => !pulseOk(n))) continue;
      const frequency = raw.frequency === 0 ? 0 : raw.frequency;
      if (typeof frequency !== 'number' || (frequency !== 0 && (frequency < 20000 || frequency > 60000))) continue;
      buttons.push({
        id: raw.id.slice(0, 40),
        name: raw.name.trim().slice(0, MAX_NAME) || 'Button',
        frequency,
        pulses: raw.pulses.slice(),
      });
      if (buttons.length >= MAX_STORED) break;
    }
    if (buttons.length) out.push({ deviceId: item.deviceId, buttons });
    if (out.length >= 20) break;
  }
  return out;
}

function load(): IrProfile[] {
  return sanitizeProfiles(loadJson<unknown>(KEY, [], Array.isArray));
}

export const irProfiles = signal<IrProfile[]>(load());

function persist(): void {
  saveJson(KEY, irProfiles.value);
}

export function reloadProfiles(): void {
  irProfiles.value = load();
}

/** False when the device already has 40 buttons and this one is new. */
export function rememberButton(deviceId: string, button: LearnedButton): boolean {
  const next = addLearned(irProfiles.value, deviceId, button);
  if (next === irProfiles.value) return false;
  irProfiles.value = next;
  persist();
  return true;
}

/** Moves a profile from an IP to a MAC once the TV reports the MAC. */
export function adoptProfile(fromId: string, toId: string): void {
  const next = moveLearned(irProfiles.value, fromId, toId);
  if (next === irProfiles.value) return;
  irProfiles.value = next;
  persist();
}

export function renameRemembered(deviceId: string, id: string, name: string): void {
  irProfiles.value = renameLearned(irProfiles.value, deviceId, id, name);
  persist();
}

export function forgetButton(deviceId: string, id: string): void {
  irProfiles.value = deleteLearned(irProfiles.value, deviceId, id);
  persist();
}
