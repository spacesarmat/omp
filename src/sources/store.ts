// «Источники поиска»: switches in tsp.sources { [id]: { on?, cloudflareBypass? } }, health of the last search in memory.
// cloudflareBypass is the site's «Обходить проверку Cloudflare» (only sites with Source.cloudflare), off by default.
import { loadJson, saveJson, isObject } from '../store/storage';
import type { Source, SourceHealth } from './types';

const KEY = 'tsp.sources';

export interface SourcePref {
  /** The search switch; absent = the default (on unless the source needs a login). */
  on?: boolean;
  /** «Обходить проверку Cloudflare» is on; absent = off. */
  cloudflareBypass?: true;
}

export function sanitizeSourcePrefs(v: unknown): { [id: string]: SourcePref } {
  const out: { [id: string]: SourcePref } = {};
  if (!isObject(v)) return out;
  Object.keys(v).forEach((id) => {
    const p = v[id];
    if (!isObject(p)) return;
    const pref: SourcePref = {};
    if (typeof p.on === 'boolean') pref.on = p.on;
    if (p.cloudflareBypass === true) pref.cloudflareBypass = true;
    if (pref.on !== undefined || pref.cloudflareBypass) out[id] = pref;
  });
  return out;
}

let prefs = sanitizeSourcePrefs(loadJson<unknown>(KEY, {}, isObject));

export function reloadSourcePrefs(): void {
  prefs = sanitizeSourcePrefs(loadJson<unknown>(KEY, {}, isObject));
}

/** Saved switch; by default every source is on except those that need a login. */
export function isSourceOn(source: Pick<Source, 'id' | 'needsLogin'>): boolean {
  const p = prefs[source.id];
  return p && typeof p.on === 'boolean' ? p.on : !source.needsLogin;
}

export function setSourceOn(id: string, on: boolean): void {
  const p = prefs[id];
  prefs[id] = p && p.cloudflareBypass ? { on, cloudflareBypass: true } : { on };
  saveJson(KEY, prefs);
}

let bypassListeners: (() => void)[] = [];

/** The site's «Обходить проверку Cloudflare» (default off). Only a source with `cloudflare: true` can have it on. */
export function isCloudflareBypassOn(source: Pick<Source, 'id' | 'cloudflare'>): boolean {
  const p = prefs[source.id];
  return source.cloudflare === true && !!p && p.cloudflareBypass === true;
}

export function setCloudflareBypass(id: string, on: boolean): void {
  const p = prefs[id] || {};
  const next: SourcePref = {};
  if (typeof p.on === 'boolean') next.on = p.on;
  if (on) next.cloudflareBypass = true;
  if (next.on === undefined && !next.cloudflareBypass) delete prefs[id];
  else prefs[id] = next;
  saveJson(KEY, prefs);
  bypassListeners.slice().forEach((cb) => cb());
}

/** Called after every change of a site's Cloudflare switch; returns the unsubscribe. */
export function onCloudflareBypassChange(cb: () => void): () => void {
  bypassListeners.push(cb);
  return () => {
    bypassListeners = bypassListeners.filter((x) => x !== cb);
  };
}

export function enabledSources(list: Source[]): Source[] {
  return list.filter(isSourceOn);
}

let health: { [id: string]: SourceHealth } = {};
let listeners: ((id: string) => void)[] = [];

export function getHealth(id: string): SourceHealth | null {
  return health[id] || null;
}

export function setHealth(id: string, h: SourceHealth): void {
  health[id] = h;
  listeners.slice().forEach((cb) => cb(id));
}

/** Forgets the health of one source (e.g. after a login: the next search tells the real state). */
export function clearHealth(id: string): void {
  if (!health[id]) return;
  delete health[id];
  listeners.slice().forEach((cb) => cb(id));
}

/** Called with the source id on every health change; returns the unsubscribe. */
export function onHealthChange(cb: (id: string) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((x) => x !== cb);
  };
}

/** Forgets every health record (tests, server change); listeners hear each cleared id. */
export function resetHealth(): void {
  const ids = Object.keys(health);
  health = {};
  ids.forEach((id) => listeners.slice().forEach((cb) => cb(id)));
}
