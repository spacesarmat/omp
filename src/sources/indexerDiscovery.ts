// Where Jackett / Prowlarr connections come from besides typing them: the Torznab addresses (and keys) in the
// TorrServer settings, and a scan of the device's /24 on 9117 (Jackett) and 9696 (Prowlarr) — the TCP part is native
// (OmpNative.scanLan: those two ports only, short timeouts, bounded concurrency), the identification an HTTP probe here.
// The automatic scan runs at most once a day; a tap scans any time. Found addresses (never keys) are kept in
// tsp.indexerScan. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { hostKey, normalizeIndexerUrl, setTorznabHosts } from './indexerStore';
import type { IndexerConn, IndexerKind } from './indexerStore';
import type { SourceHttp } from './types';

export const JACKETT_PORT = 9117;
export const PROWLARR_PORT = 9696;
export const INDEXER_PORTS = [JACKETT_PORT, PROWLARR_PORT];
export const SCAN_EVERY_MS = 24 * 60 * 60 * 1000;
const SCAN_KEY = 'tsp.indexerScan';
const MAX_FOUND = 20;
const PROBE_TIMEOUT_MS = 3000;
const PROBE_CONCURRENCY = 4;

/** An open port the native scan found. */
export interface LanHit {
  ip: string;
  port: number;
}

/** null: the device is not on a home network (mobile data), nothing was scanned. */
export type LanScan = (ports: number[]) => Promise<LanHit[] | null>;

export interface FoundIndexer {
  kind: IndexerKind;
  url: string;
}

// ---- identification ----

function title(text: string): string {
  const m = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(text);
  return m ? m[1] : '';
}

/**
 * Jackett or Prowlarr at `base` by an HTTP probe, null when neither. The start page tells it (Jackett redirects to
 * /UI/Dashboard or /UI/Login, Prowlarr's page and its login page are titled «Prowlarr»); without it, the API answer
 * (401 without a key) together with the usual port.
 */
export function identifyIndexer(base: string, http: SourceHttp): Promise<IndexerKind | null> {
  const opts = { timeoutMs: PROBE_TIMEOUT_MS };
  const port = parseInt(hostKey(base).split(':').pop() || '', 10);
  const miss = () => null;
  return http.get(base + '/', opts).then(
    (r) => {
      const t = title(r.text);
      if (/jackett/i.test(t) || /\/UI\/(Dashboard|Login)/i.test(r.url)) return 'jackett' as IndexerKind;
      if (/prowlarr/i.test(t) || /window\.Prowlarr/.test(r.text.slice(0, 20000))) return 'prowlarr' as IndexerKind;
      if (port === PROWLARR_PORT)
        return http.get(base + '/api/v1/system/status', opts).then((a) => (a.status === 401 ? ('prowlarr' as IndexerKind) : null), miss);
      if (port === JACKETT_PORT)
        return http.get(base + '/api/v2.0/server/config', opts).then((a) => (a.status === 401 || /\/UI\/Login/i.test(a.url) ? ('jackett' as IndexerKind) : null), miss);
      return null;
    },
    miss,
  );
}

/** The kind an address most likely is by its port alone (manual entry with no probe answer). */
export function kindByPort(url: string): IndexerKind | null {
  const port = hostKey(url).split(':').pop();
  if (port === String(JACKETT_PORT)) return 'jackett';
  if (port === String(PROWLARR_PORT)) return 'prowlarr';
  return null;
}

// ---- LAN scan ----

interface ScanRecord {
  at: number;
  found: FoundIndexer[];
}

function sanitizeFound(v: unknown): FoundIndexer[] {
  const out: FoundIndexer[] = [];
  if (!Array.isArray(v)) return out;
  v.forEach((x) => {
    if (out.length >= MAX_FOUND || !isObject(x)) return;
    const kind = x.kind === 'jackett' || x.kind === 'prowlarr' ? x.kind : null;
    const url = normalizeIndexerUrl(x.url);
    if (kind && url && !out.some((f) => hostKey(f.url) === hostKey(url))) out.push({ kind, url });
  });
  return out;
}

export function lastScan(): ScanRecord | null {
  const v = loadJson<unknown>(SCAN_KEY, null, (x) => x === null || isObject(x));
  if (!isObject(v) || typeof v.at !== 'number' || !isFinite(v.at)) return null;
  return { at: v.at, found: sanitizeFound(v.found) };
}

/** The automatic scan is due: never ran, or more than a day ago (or the clock went back). */
export function scanDue(now: number): boolean {
  const s = lastScan();
  return !s || now - s.at >= SCAN_EVERY_MS || now < s.at;
}

function isPrivateIp(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (!m) return false;
  const a = +m[1];
  const b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Scans the LAN and identifies what answers; saves the result with the time. Hits outside the home ranges or on other
 * ports are ignored; at most a few probes run at once. Off the home network (mobile data) or when the native scan
 * fails, nothing is saved: earlier finds stay and the next automatic scan is not delayed.
 */
export function scanIndexers(scan: LanScan, http: SourceHttp, now: () => number = Date.now): Promise<FoundIndexer[]> {
  const previous = (): FoundIndexer[] => {
    const prev = lastScan();
    return prev ? prev.found : [];
  };
  return scan(INDEXER_PORTS.slice()).then(
    (hits) => {
      if (hits === null) return previous();
      const list: LanHit[] = [];
      (Array.isArray(hits) ? hits : []).forEach((h) => {
        if (!h || typeof h.ip !== 'string' || INDEXER_PORTS.indexOf(h.port) < 0 || !isPrivateIp(h.ip)) return;
        if (list.length < 64 && !list.some((x) => x.ip === h.ip && x.port === h.port)) list.push({ ip: h.ip, port: h.port });
      });
      const found: FoundIndexer[] = [];
      let next = 0;
      const worker = (): Promise<void> => {
        if (next >= list.length) return Promise.resolve();
        const h = list[next++];
        const url = 'http://' + h.ip + ':' + h.port;
        return identifyIndexer(url, http).then((kind) => {
          if (kind && found.length < MAX_FOUND) found.push({ kind, url });
          return worker();
        });
      };
      const workers: Promise<void>[] = [];
      for (let i = 0; i < PROBE_CONCURRENCY; i++) workers.push(worker());
      return Promise.all(workers).then(() => {
        found.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
        saveJson(SCAN_KEY, { at: now(), found });
        return found;
      });
    },
    () => previous(),
  );
}

// ---- TorrServer settings ----

/** A Torznab address from the TorrServer settings. The key stays in memory (it is offered for import only). */
export interface TorznabImport {
  url: string;
  kind: IndexerKind | null;
  key: string;
}

const KEY_RE = /^[\x21-\x7e]{1,200}$/;

const LOOPBACK = /^(https?:\/\/)(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i;

/** Host name of an http(s) address ('' when none); IPv6 kept in brackets. */
export function hostName(url: string): string {
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:?#@]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * A TorrServer Torznab address on loopback (Jackett on the TorrServer box: http://127.0.0.1:9117) points at the
 * TorrServer machine, not at this device: its host becomes `serverHost` (the TorrServer's own host). Nothing changes
 * when the TorrServer itself is on loopback (the phone's embedded server) or unknown.
 */
export function fromServerView(raw: string, serverHost?: string): string {
  if (!serverHost || LOOPBACK.test('http://' + serverHost)) return raw;
  return raw.trim().replace(LOOPBACK, (_m, scheme: string) => scheme + serverHost);
}

/**
 * Jackett/Prowlarr behind a TorrServer Torznab host: «http://h:9117/api/v2.0/indexers/all/results/torznab» → Jackett
 * at http://h:9117; «http://h:9696/1/api» → Prowlarr at http://h:9696; a bare address → by port, else unknown.
 */
export function torznabBase(raw: string, serverHost?: string): { url: string; kind: IndexerKind | null } | null {
  const full = normalizeIndexerUrl(fromServerView(raw, serverHost));
  if (!full) return null;
  const m = /^(https?:\/\/[^/]+)(\/.*)?$/.exec(full);
  if (!m) return null;
  const origin = m[1];
  const path = m[2] || '';
  const j = path.toLowerCase().indexOf('/api/v2.0/');
  if (j >= 0) return { url: origin + path.slice(0, j), kind: 'jackett' };
  if (/^(\/\d+)(\/api)?\/?$/i.test(path)) return { url: origin, kind: 'prowlarr' };
  const byPort = kindByPort(origin);
  return { url: full, kind: byPort };
}

/**
 * The TorrServer settings' Torznab list (BTSets.TorznabUrls [{ Host, Key, Name? }], MatriX): entries with an address,
 * and the host:port of each for the path selection. `enabled` false when Torznab search is off there.
 */
export function torznabFromSettings(settings: unknown, serverHost?: string): { enabled: boolean; hosts: string[]; imports: TorznabImport[] } | null {
  if (!isObject(settings) || !Array.isArray(settings.TorznabUrls)) return null;
  const enabled = settings.EnableTorznabSearch !== false;
  const hosts: string[] = [];
  const imports: TorznabImport[] = [];
  settings.TorznabUrls.slice(0, MAX_FOUND).forEach((x) => {
    if (!isObject(x) || typeof x.Host !== 'string') return;
    const b = torznabBase(x.Host, serverHost);
    if (!b) return;
    const h = hostKey(b.url);
    if (hosts.indexOf(h) < 0) hosts.push(h);
    const key = typeof x.Key === 'string' && KEY_RE.test(x.Key.trim()) ? x.Key.trim() : '';
    if (!imports.some((i) => hostKey(i.url) === h)) imports.push({ url: b.url, kind: b.kind, key });
  });
  return { enabled, hosts: enabled ? hosts : [], imports: enabled ? imports : [] };
}

/**
 * Reads the TorrServer settings, records their Torznab hosts for the path selection and returns the imports. A server
 * whose settings say nothing about Torznab (older TorrServer) leaves the hosts unknown.
 */
export function readTorznabImports(read: (() => Promise<unknown>) | null, serverHost?: string): Promise<TorznabImport[]> {
  if (!read) return Promise.resolve([]);
  return read().then(
    (s) => {
      const t = torznabFromSettings(s, serverHost);
      if (!t) return [];
      setTorznabHosts(t.hosts);
      return t.imports;
    },
    () => [],
  );
}

// ---- merge ----

export interface IndexerCandidate {
  kind: IndexerKind | null;
  url: string;
  /** host:port, the dedupe key. */
  host: string;
  network: boolean;
  torrserver: boolean;
  /** Key from the TorrServer settings (memory only). */
  tsKey?: string;
  /** Id of the saved connection to the same host:port. */
  connId?: string;
}

/**
 * Saved connections, TorrServer imports and LAN finds as one list, deduplicated by host:port (a saved connection wins
 * the address and kind, a TorrServer entry the key, a LAN probe the kind when nothing else knows it).
 */
export function mergeCandidates(conns: IndexerConn[], found: FoundIndexer[], imports: TorznabImport[]): IndexerCandidate[] {
  const out: IndexerCandidate[] = [];
  const at = (host: string) => {
    for (let i = 0; i < out.length; i++) if (out[i].host === host) return out[i];
    return null;
  };
  conns.forEach((c) => {
    const host = hostKey(c.url);
    if (!host || at(host)) return;
    out.push({ kind: c.kind, url: c.url, host, network: false, torrserver: false, connId: c.id });
  });
  imports.forEach((i) => {
    const host = hostKey(i.url);
    if (!host) return;
    const c = at(host);
    if (c) {
      c.torrserver = true;
      if (!c.kind) c.kind = i.kind;
      if (i.key && !c.tsKey) c.tsKey = i.key;
      return;
    }
    const n: IndexerCandidate = { kind: i.kind, url: i.url, host, network: false, torrserver: true };
    if (i.key) n.tsKey = i.key;
    out.push(n);
  });
  found.forEach((f) => {
    const host = hostKey(f.url);
    if (!host) return;
    const c = at(host);
    if (c) {
      c.network = true;
      if (!c.kind) c.kind = f.kind;
      return;
    }
    out.push({ kind: f.kind, url: f.url, host, network: true, torrserver: false });
  });
  return out;
}

/** «192.168.1.191:9117 · ключ из TorrServer» / «… · найден в сети». */
export function candidateWhere(c: IndexerCandidate): string {
  const where = c.torrserver ? (c.tsKey ? 'ключ из TorrServer' : 'в настройках TorrServer') : c.network ? 'найден в сети' : 'добавлен вручную';
  return c.host.replace(/:(80|443)$/, '') + ' · ' + where;
}

// ---- plain http warning ----

/** Home network or this device: 10/8, 172.16/12, 192.168/16, 127/8, localhost, *.local. */
export function isLanHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || /\.local$/.test(h)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return isPrivateIp(h);
}

export const INSECURE_KEY = 'Адрес не в домашней сети и без https: ключ передаётся без шифрования';

/** The warning for an http:// address outside the home network, '' otherwise. */
export function plainHttpWarning(url: string): string {
  const m = /^http:\/\/([^/:?#]+)/i.exec((url || '').trim());
  return m && !isLanHost(m[1]) ? INSECURE_KEY : '';
}
