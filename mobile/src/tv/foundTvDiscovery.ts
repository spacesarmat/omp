// One SSDP/mDNS scan shared by «Каталог», «Пульт» and «Настройки».
// A screen opened while a scan is in flight, or while a successful scan is still fresh, reads the same
// results. A screen opened after the TTL, after an empty scan, or when the phone's network changed,
// searches again. App resume and online/offline do too. Two callers never run two scans at once.
import { signal } from '@preact/signals';
import { native, type FoundOmpTv, type FoundTv } from '../platform/native';

const SEARCH_MS = 4000;
/** A successful scan older than this is searched again the next time a screen opens. */
export const FOUND_TV_TTL_MS = 30_000;

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
type NetReader = () => Promise<string | null>;

let lgDiscover: LgDiscover | null = null;
let atvDiscover: AtvDiscover | null = null;
let nowFn = () => Date.now();
let netReader: NetReader = () => native.localIpv4().catch(() => null);

/** TVs the shared scan has published. A screen opened later reads this on its first render. */
export const foundTvRows = signal<FoundTvRow[]>([]);
/** True from the start of a scan until both the LG and Android TV searches have settled. */
export const foundTvScanning = signal(false);

let generation = 0;
let inflight: Promise<unknown> | null = null;
/** A resume or a network change arrived while a scan was running: search once more when it settles. */
let rerun = false;
let finishedAt = 0;
/** Wi-Fi IPv4 the last scan observed. Undefined until the first read. */
let scanNet: string | null | undefined = undefined;
let netSeq = 0;
/** Screens that have opened, and how many of those `ensureFoundTvScan` has already handled. */
let noted = 0;
let handled = 0;

/** Tests: discovery. Null restores the native search and drops whatever the previous scan cached. */
export function setFoundTvDiscoverer(lg: LgDiscover | null, atv: AtvDiscover | null = null): void {
  lgDiscover = lg;
  atvDiscover = atv;
  resetFoundTvDiscovery();
}

/** Tests: clock for the TTL. Null restores Date.now. */
export function setFoundTvClock(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}

/** Tests: the phone's Wi-Fi IPv4. Null restores the native read. */
export function setFoundTvNetwork(fn: NetReader | null): void {
  netReader = fn ?? (() => native.localIpv4().catch(() => null));
}

/** Drops cached TVs so the next screen may start a scan. An in-flight result from the old scan is ignored. */
export function resetFoundTvDiscovery(): void {
  generation++;
  netSeq++;
  inflight = null;
  rerun = false;
  finishedAt = 0;
  scanNet = undefined;
  noted = 0;
  handled = 0;
  foundTvRows.value = [];
  foundTvScanning.value = false;
  nowFn = () => Date.now();
  netReader = () => native.localIpv4().catch(() => null);
}

/** One call per mount of a screen that shows the list. A later render of that mount is not a new open. */
export function noteFoundTvScreen(): void {
  noted += 1;
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

function rememberNet(): void {
  const seq = ++netSeq;
  void netReader().then((ip) => {
    if (seq !== netSeq) return;
    scanNet = ip;
  });
}

/** A fresh cache on a different Wi-Fi than the one we searched: search that network. */
function considerNetwork(): void {
  const seq = ++netSeq;
  const seen = scanNet;
  void netReader().then((ip) => {
    if (seq !== netSeq) return;
    if (seen === undefined) {
      scanNet = ip;
      return;
    }
    if (ip === seen) return;
    scanNet = ip;
    refreshFoundTvScan();
  });
}

function startScan(): void {
  if (inflight) {
    rerun = true;
    return;
  }
  const token = generation;
  foundTvScanning.value = true;
  rememberNet();
  // keep a list the user can already see until both searches of this scan have settled
  const keep = foundTvRows.peek().length > 0;
  let lg: FoundTv[] | null = null;
  let atv: FoundOmpTv[] | null = null;
  let left = 2;
  const arrived = () => {
    if (token !== generation) return;
    left -= 1;
    if (left > 0 && keep) return;
    foundTvRows.value = toRows(atv || [], lg || []);
    if (left === 0) finishedAt = nowFn();
  };
  const job = Promise.all([
    call(lgDiscover ?? ((ms: number) => native.discoverTvs(ms)), [] as FoundTv[]).then((v) => {
      lg = v;
      arrived();
    }),
    call(atvDiscover ?? ((ms: number) => native.discoverOmpTvs(ms)), [] as FoundOmpTv[]).then((v) => {
      atv = v;
      arrived();
    }),
  ]).finally(() => {
    if (inflight === job) inflight = null;
    if (token !== generation) return;
    if (rerun) {
      rerun = false;
      startScan();
      return;
    }
    foundTvScanning.value = false;
  });
  inflight = job;
}

/**
 * Joins the current scan, or starts one when this screen just opened and the cache is empty, older
 * than {@link FOUND_TV_TTL_MS}, or from another network. A fresh list stays on screen as-is.
 */
export function ensureFoundTvScan(): void {
  const opened = noted !== handled;
  if (opened) handled = noted;
  if (!opened) return;
  if (inflight) return;
  const empty = foundTvRows.peek().length === 0;
  const age = finishedAt === 0 ? Infinity : nowFn() - finishedAt;
  if (finishedAt !== 0 && !empty && age < FOUND_TV_TTL_MS) {
    considerNetwork();
    return;
  }
  startScan();
}

/**
 * Search again now: the app came back to the foreground, or the network changed. A scan already
 * running is not joined by a second one; it is followed by a single extra scan when it settles.
 */
export function refreshFoundTvScan(): void {
  if (inflight) {
    rerun = true;
    return;
  }
  startScan();
}

/** Online/offline, and a Network Information change when the browser exposes one. */
export function installFoundTvWatchers(target: Window = window): () => void {
  const refresh = () => refreshFoundTvScan();
  target.addEventListener('online', refresh);
  target.addEventListener('offline', refresh);
  const conn = (target.navigator as Navigator & { connection?: EventTarget }).connection;
  if (conn) conn.addEventListener('change', refresh);
  return () => {
    target.removeEventListener('online', refresh);
    target.removeEventListener('offline', refresh);
    if (conn) conn.removeEventListener('change', refresh);
  };
}
