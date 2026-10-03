// Install assistant: finding TVs. LG over SSDP, Android TV / Google TV over NSD `_googlecast._tcp`, Android TVs that
// already run OMP over NSD `_omp._tcp`, plus the saved TVs. Merged into one list, one entry per IP.
import { native, type FoundTv, type FoundCastTv, type FoundOmpTv, type OmpNativeApi } from '../platform/native';
import { tvs, type SavedTv } from '../tv/tvStore';
import { log } from '../../../src/lib/log';

export type InstallNative = Pick<OmpNativeApi, 'discoverTvs' | 'discoverCastTvs' | 'discoverOmpTvs' | 'probePorts' | 'stopDiscovery'>;

let impl: InstallNative = native;

/** Replaces the native discovery and port probe (tests); null restores the real plugin. */
export function setInstallNative(n: InstallNative | null): void {
  impl = n ?? native;
}

export function installNative(): InstallNative {
  return impl;
}

/** 'samsung' only from the manual entry: the plan says it is not supported yet. */
export type InstallDeviceKind = 'lg' | 'atv' | 'samsung';

export interface InstallDevice {
  ip: string;
  name: string;
  kind: InstallDeviceKind;
  model?: string;
  /** Android TV found by cast: 'chromecast' = a Chromecast that cannot install apps. */
  cast?: 'tv' | 'chromecast';
  /** OMP version announced over `_omp._tcp` (Android TV with OMP running). */
  ompVersion?: string;
  /** OMP control server port from `_omp._tcp`. */
  ompPort?: number;
  /** A TV saved on this phone (paired before). */
  saved?: boolean;
  /** Seen in this search (false for a saved TV that did not answer). */
  online: boolean;
}

/** Cast devices: speakers and groups are not TVs; a Chromecast Ultra cannot install apps. */
export function castKind(model: string | undefined): 'tv' | 'chromecast' | 'speaker' {
  const m = (model || '').trim();
  if (/google home|home mini|nest (audio|mini|hub|wifi)|cast group|chromecast audio|speaker|soundbar/i.test(m)) return 'speaker';
  if (/^chromecast ultra$/i.test(m)) return 'chromecast';
  return 'tv';
}

export interface Found {
  lg?: FoundTv[];
  cast?: FoundCastTv[];
  omp?: FoundOmpTv[];
}

/** One entry per IP: LG over cast, cast name/model with the OMP version from `_omp._tcp`, then saved TVs not seen. */
export function mergeDevices(found: Found, saved: SavedTv[]): InstallDevice[] {
  const out: InstallDevice[] = [];
  const at = (ip: string) => out.find((d) => d.ip === ip);
  const savedAt = (ip: string) => saved.find((t) => t.ip === ip);
  for (const t of found.lg || []) {
    if (at(t.ip)) continue;
    const s = savedAt(t.ip);
    const d: InstallDevice = { ip: t.ip, name: s?.name || t.name, kind: 'lg', online: true };
    if (t.model) d.model = t.model;
    if (s) d.saved = true;
    out.push(d);
  }
  for (const t of found.cast || []) {
    if (at(t.ip)) continue;
    const kind = castKind(t.model);
    if (kind === 'speaker') continue;
    const s = savedAt(t.ip);
    const d: InstallDevice = { ip: t.ip, name: s?.name || t.name, kind: 'atv', cast: kind, online: true };
    if (t.model) d.model = t.model;
    if (s) d.saved = true;
    out.push(d);
  }
  for (const t of found.omp || []) {
    const cur = at(t.ip);
    if (cur) {
      if (cur.kind === 'atv') {
        if (t.version) cur.ompVersion = t.version;
        cur.ompPort = t.port;
      }
      continue;
    }
    const s = savedAt(t.ip);
    const d: InstallDevice = { ip: t.ip, name: s?.name || t.name, kind: 'atv', online: true, ompPort: t.port };
    if (t.version) d.ompVersion = t.version;
    if (s) d.saved = true;
    out.push(d);
  }
  for (const s of saved) {
    if (at(s.ip)) continue;
    out.push({ ip: s.ip, name: s.name, kind: s.kind === 'atv' ? 'atv' : 'lg', saved: true, online: false });
  }
  return out;
}

/** Devices of the last search and manual entries, by IP: the steps screen looks its device up here. */
const known = new Map<string, InstallDevice>();

export function rememberDevice(d: InstallDevice): void {
  known.set(d.ip, d);
}

export const KIND_NAME: { [k in InstallDeviceKind]: string } = { lg: 'LG', atv: 'Android TV', samsung: 'Samsung' };

/** The device for the steps screen: from the last search, else a saved TV, else a bare one of `kind`. */
export function deviceFor(ip: string, kind?: InstallDeviceKind): InstallDevice {
  const k = known.get(ip);
  if (k && (!kind || k.kind === kind)) return k;
  const s = tvs.value.find((t) => t.ip === ip);
  const savedKind: InstallDeviceKind = s?.kind === 'atv' ? 'atv' : 'lg';
  if (s && (!kind || kind === savedKind)) return { ip, name: s.name, kind: savedKind, saved: true, online: false };
  const k2: InstallDeviceKind = kind || 'lg';
  return { ip, name: KIND_NAME[k2] + ' ' + ip, kind: k2, online: false };
}

export const SEARCH_MS = 4000;

/**
 * Runs the three searches in parallel; `onUpdate` gets the merged list each time one of them finishes. Failures are
 * logged without addresses or names and count as «nothing found» for that search. Resolves when all are done.
 */
export function searchDevices(onUpdate: (list: InstallDevice[]) => void, timeoutMs = SEARCH_MS): Promise<InstallDevice[]> {
  const found: Found = {};
  const n = impl;
  const emit = () => {
    const list = mergeDevices(found, tvs.value);
    for (const d of list) rememberDevice(d);
    onUpdate(list);
    return list;
  };
  const run = <T>(p: () => Promise<T[]>, what: string, put: (v: T[]) => void) =>
    p().then(
      (v) => {
        put(v);
        emit();
      },
      () => log('warn', 'install', 'Поиск ' + what + ' не удался'),
    );
  return Promise.all([
    run(() => n.discoverTvs(timeoutMs), 'LG', (v) => (found.lg = v)),
    run(() => n.discoverCastTvs(timeoutMs), 'Android TV', (v) => (found.cast = v)),
    run(() => n.discoverOmpTvs(timeoutMs), 'OMP на Android TV', (v) => (found.omp = v)),
  ]).then(emit);
}
