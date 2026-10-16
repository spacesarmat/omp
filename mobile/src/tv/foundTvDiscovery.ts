// One SSDP/mDNS scan shared by «Каталог», «Пульт» and «Настройки».
// Each of those screens used to start its own search on mount, so a TV already found on one
// stayed hidden on the next until that screen's scan finished.
import { signal } from '@preact/signals';
import { native, type FoundOmpTv, type FoundTv } from '../platform/native';

const SEARCH_MS = 4000;

export interface FoundTvRow {
  ip: string;
  name: string;
  meta: string;
  kind: 'lg' | 'atv';
  lg?: FoundTv;
  atv?: FoundOmpTv;
}

type LgDiscover = (ms: number) => Promise<FoundTv[]>;
type AtvDiscover = (ms: number) => Promise<FoundOmpTv[]>;

let lgDiscover: LgDiscover | null = null;
let atvDiscover: AtvDiscover | null = null;

/** TVs the shared scan has published. A screen opened later reads this on its first render. */
export const foundTvRows = signal<FoundTvRow[]>([]);
/** True from the start of the shared scan until both the LG and Android TV searches have settled. */
export const foundTvScanning = signal(false);

let started = false;
let generation = 0;

/** Tests: discovery. Null restores the native search and drops whatever the previous scan cached. */
export function setFoundTvDiscoverer(lg: LgDiscover | null, atv: AtvDiscover | null = null): void {
  lgDiscover = lg;
  atvDiscover = atv;
  resetFoundTvDiscovery();
}

/** Drops cached TVs so the next screen may start a scan. An in-flight result from the old scan is ignored. */
export function resetFoundTvDiscovery(): void {
  generation++;
  started = false;
  foundTvRows.value = [];
  foundTvScanning.value = false;
}

function call<T>(fn: (ms: number) => Promise<T>, empty: T): Promise<T> {
  try {
    return Promise.resolve(fn(SEARCH_MS)).then((v) => (Array.isArray(v) ? v : empty), () => empty);
  } catch {
    return Promise.resolve(empty);
  }
}

function toRows(foundAtv: FoundOmpTv[], foundLg: FoundTv[]): FoundTvRow[] {
  const next: FoundTvRow[] = [];
  for (const f of foundAtv) {
    if (next.some((r) => r.ip === f.ip)) continue;
    next.push({ ip: f.ip, name: f.name, meta: f.ip + (f.version ? ' · OMP ' + f.version : ''), kind: 'atv', atv: f });
  }
  for (const f of foundLg) {
    if (next.some((r) => r.ip === f.ip)) continue;
    next.push({ ip: f.ip, name: f.name, meta: f.ip + (f.model ? ' · ' + f.model : ''), kind: 'lg', lg: f });
  }
  return next;
}

/**
 * Starts the shared scan once. Later callers do not search again: they read `foundTvRows` and
 * `foundTvScanning`, and the list updates when this scan publishes (LG and Android TV each as it arrives).
 */
export function ensureFoundTvScan(): void {
  if (started) return;
  started = true;
  const token = generation;
  foundTvScanning.value = true;
  let lg: FoundTv[] | null = null;
  let atv: FoundOmpTv[] | null = null;
  let left = 2;
  const arrived = () => {
    if (token !== generation) return;
    foundTvRows.value = toRows(atv || [], lg || []);
    left -= 1;
    if (left === 0) foundTvScanning.value = false;
  };
  call(lgDiscover ?? ((ms: number) => native.discoverTvs(ms)), [] as FoundTv[]).then((v) => {
    lg = v;
    arrived();
  });
  call(atvDiscover ?? ((ms: number) => native.discoverOmpTvs(ms)), [] as FoundOmpTv[]).then((v) => {
    atv = v;
    arrived();
  });
}
