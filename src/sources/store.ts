// «Источники поиска»: switches in tsp.sources { [id]: { on } }, health of the last search in memory.
import { loadJson, saveJson, isObject } from '../store/storage';
import type { Source, SourceHealth } from './types';

const KEY = 'tsp.sources';

export interface SourcePref {
  on: boolean;
}

export function sanitizeSourcePrefs(v: unknown): { [id: string]: SourcePref } {
  const out: { [id: string]: SourcePref } = {};
  if (!isObject(v)) return out;
  Object.keys(v).forEach((id) => {
    const p = v[id];
    if (isObject(p) && typeof p.on === 'boolean') out[id] = { on: p.on };
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
  return p ? p.on : !source.needsLogin;
}

export function setSourceOn(id: string, on: boolean): void {
  prefs[id] = { on };
  saveJson(KEY, prefs);
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

/** Called with the source id on every health change; returns the unsubscribe. */
export function onHealthChange(cb: (id: string) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((x) => x !== cb);
  };
}

/** Forgets every health record (tests, server change). */
export function resetHealth(): void {
  health = {};
}
