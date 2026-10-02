// Saved TVs (IP, name, pairing key) and the active one.
import { signal, computed } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';

export interface SavedTv {
  ip: string;
  name: string;
  /** Name from discovery / manual entry; `name` differs from it once the user renames the TV. */
  defaultName?: string;
  clientKey?: string;
}

export const MAX_NAME = 40;

const KEY = 'tsp.tvs';
const ACTIVE_KEY = 'tsp.activeTv';
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function sanitizeTvs(v: unknown): SavedTv[] {
  if (!Array.isArray(v)) return [];
  const out: SavedTv[] = [];
  for (const t of v) {
    if (!isObject(t) || typeof t.ip !== 'string' || !IPV4.test(t.ip) || typeof t.name !== 'string') continue;
    if (out.some((o) => o.ip === t.ip)) continue;
    const tv: SavedTv = { ip: t.ip, name: t.name };
    if (typeof t.defaultName === 'string' && t.defaultName) tv.defaultName = t.defaultName;
    if (typeof t.clientKey === 'string' && t.clientKey) tv.clientKey = t.clientKey;
    out.push(tv);
  }
  return out;
}

function loadTvs(): SavedTv[] {
  return sanitizeTvs(loadJson<unknown>(KEY, [], Array.isArray));
}

function loadActive(): string | null {
  return loadJson<string | null>(ACTIVE_KEY, null, (v) => v === null || typeof v === 'string');
}

export const tvs = signal<SavedTv[]>(loadTvs());
export const activeTvIp = signal<string | null>(loadActive());
export const activeTv = computed(() => tvs.value.find((t) => t.ip === activeTvIp.value) || null);

function persist() {
  saveJson(KEY, tvs.value);
  saveJson(ACTIVE_KEY, activeTvIp.value);
}

export function reloadTvs(): void {
  tvs.value = loadTvs();
  activeTvIp.value = loadActive();
}

/** Adds or updates a TV by IP; a known key and a user-given name are kept. The first TV becomes active. */
export function saveTv(tv: SavedTv): void {
  const existing = tvs.value.find((t) => t.ip === tv.ip);
  const clientKey = tv.clientKey || existing?.clientKey;
  const renamed = !!existing && existing.defaultName !== undefined && existing.name !== existing.defaultName;
  const name = renamed ? existing!.name : tv.name;
  const next: SavedTv = { ip: tv.ip, name, defaultName: renamed ? existing!.defaultName : tv.name };
  if (clientKey) next.clientKey = clientKey;
  tvs.value = existing ? tvs.value.map((t) => (t.ip === tv.ip ? next : t)) : tvs.value.concat(next);
  if (!activeTv.value) activeTvIp.value = tv.ip;
  persist();
}

/** Gives a saved TV a user name (trimmed, max 40); blank restores the discovered one. */
export function renameTv(ip: string, name: string): void {
  const cur = tvs.value.find((t) => t.ip === ip);
  if (!cur) return;
  const def = cur.defaultName ?? cur.name;
  const next = name.trim().slice(0, MAX_NAME).trim() || def;
  tvs.value = tvs.value.map((t) => (t.ip === ip ? { ...t, name: next, defaultName: def } : t));
  persist();
}

export function setActiveTv(ip: string): void {
  if (!tvs.value.some((t) => t.ip === ip)) return;
  activeTvIp.value = ip;
  persist();
}

export function forgetTv(ip: string): void {
  tvs.value = tvs.value.filter((t) => t.ip !== ip);
  if (activeTvIp.value === ip || !activeTv.value) activeTvIp.value = tvs.value[0]?.ip ?? null;
  persist();
}
