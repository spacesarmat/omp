// Saved TVs (IP, name, pairing key or token, kind) and the active one.
import { signal, computed } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';

export interface SavedTv {
  ip: string;
  name: string;
  /** Name from discovery / manual entry; `name` differs from it once the user renames the TV. */
  defaultName?: string;
  clientKey?: string;
  /** SSAP port that opened last time (ws 3000 / wss 3001). */
  port?: 3000 | 3001;
  /** Wi-Fi/Ethernet MAC for Wake-on-LAN, lower-case colon form. */
  mac?: string;
  /** Absent = LG webOS (SSAP); 'atv' = Android TV with OMP (HTTP control server). */
  kind?: TvKind;
  /** Android TV: bearer token from pairing (32 hex). */
  token?: string;
  /** Android TV: control server port (default 8095); `port` stays the SSAP one. */
  ctlPort?: number;
}

export type TvKind = 'lg' | 'atv';

/** Control server port of OMP on Android TV. */
export const ATV_PORT = 8095;
const TOKEN = /^[0-9a-f]{32}$/;

export function isAtv(tv: SavedTv | null | undefined): boolean {
  return !!tv && tv.kind === 'atv';
}

function validPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536;
}

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/** "AA-BB-CC-DD-EE-FF" / "aabbccddeeff" / "aa:bb:..." -> "aa:bb:cc:dd:ee:ff"; undefined when it is not a MAC. */
export function normalizeMac(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const hex = v.trim().replace(/[:\-.]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return undefined;
  const mac = hex.match(/../g)!.join(':');
  return MAC.test(mac) ? mac : undefined;
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
    if (t.kind === 'atv') {
      tv.kind = 'atv';
      if (typeof t.token === 'string' && TOKEN.test(t.token)) tv.token = t.token;
      if (validPort(t.ctlPort)) tv.ctlPort = t.ctlPort;
    } else {
      if (typeof t.clientKey === 'string' && t.clientKey) tv.clientKey = t.clientKey;
      if (t.port === 3000 || t.port === 3001) tv.port = t.port;
      if (typeof t.mac === 'string' && MAC.test(t.mac)) tv.mac = t.mac;
    }
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

/**
 * Adds or updates a TV by IP; a known key and a user-given name are kept. The first TV becomes active unless
 * `keepActive` (install assistant inspecting a TV).
 */
export function saveTv(tv: SavedTv, opts: { keepActive?: boolean } = {}): void {
  const existing = tvs.value.find((t) => t.ip === tv.ip);
  const renamed = !!existing && existing.defaultName !== undefined && existing.name !== existing.defaultName;
  const name = renamed ? existing!.name : tv.name;
  const next: SavedTv = { ip: tv.ip, name, defaultName: renamed ? existing!.defaultName : tv.name };
  const kind = tv.kind ?? existing?.kind;
  if (kind === 'atv') {
    next.kind = 'atv';
    const token = tv.token || existing?.token;
    if (token) next.token = token;
    const ctlPort = tv.ctlPort ?? existing?.ctlPort;
    if (ctlPort) next.ctlPort = ctlPort;
  } else {
    const clientKey = tv.clientKey || existing?.clientKey;
    if (clientKey) next.clientKey = clientKey;
    const port = tv.port ?? existing?.port;
    if (port) next.port = port;
    const mac = tv.mac ?? existing?.mac;
    if (mac) next.mac = mac;
  }
  tvs.value = existing ? tvs.value.map((t) => (t.ip === tv.ip ? next : t)) : tvs.value.concat(next);
  if (!activeTv.value && !opts.keepActive) activeTvIp.value = tv.ip;
  persist();
}

/** Android TV: drops a token the TV no longer accepts (only while it is still `token`), so the next tap asks for a code. */
export function clearTvToken(ip: string, token?: string): void {
  const cur = tvs.value.find((t) => t.ip === ip);
  if (!cur || !cur.token || (token !== undefined && cur.token !== token)) return;
  tvs.value = tvs.value.map((t) => {
    if (t.ip !== ip) return t;
    const next = { ...t };
    delete next.token;
    return next;
  });
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
