import { lunaCall } from '../platform/luna';
import { platformKind } from '../platform/env';
import { nativeLocalIp } from '../platform/androidNative';

export interface FoundServer {
  url: string;
  version: string;
}

export const DEFAULT_PORTS = [8090, 5665];

/**
 * Probes in flight at once. webOS Chromium 53 frees sockets slowly, so the shared default stays here.
 * A slot is freed only when the probe promise settles.
 */
export const DEFAULT_CONCURRENCY = 24;

/**
 * Per-probe wait. A lost SYN on Wi-Fi is retransmitted at about a second, so this stays above that.
 * Dead hosts on a home LAN often consume the whole wait (nothing refuses the port); that is what makes
 * a full /24 take tens of seconds, and shortening it would skip a live server on a noisy network.
 */
export const DEFAULT_TIMEOUT_MS = 1200;

/**
 * Phone WebView (current Chromium) allows 256 sockets per pool, and each probe is a different host, so 48
 * at once fits without filling the pool or flooding a small access point. webOS keeps DEFAULT_CONCURRENCY.
 */
export const PHONE_CONCURRENCY = 48;

/** Gateway and the addresses a TorrServer is usually pinned to, tried before the rest of the /24. */
export const LIKELY_HOSTS = [1, 2, 10, 20, 50, 100, 101, 150, 200, 254];

export function subnetOf(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return m ? m[1] : null;
}

/**
 * The 254 host octets: likely ones first, then the low, middle and high thirds of the /24 in round-robin.
 * Ascending .1–.254 left a server at .191 behind ~380 probes (~15 s at the old pace).
 */
export function scanHosts(): number[] {
  const used: boolean[] = [];
  const out: number[] = [];
  const push = (h: number) => {
    if (h < 1 || h > 254 || used[h]) return;
    used[h] = true;
    out.push(h);
  };
  LIKELY_HOSTS.forEach(push);
  const bands: number[][] = [[], [], []];
  for (let h = 1; h <= 254; h++) {
    if (used[h]) continue;
    bands[h < 85 ? 0 : h < 170 ? 1 : 2].push(h);
  }
  const n = Math.max(bands[0].length, bands[1].length, bands[2].length);
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < 3; b++) if (bands[b].length > i) push(bands[b][i]);
  }
  return out;
}

/** «http://192.168.1.191:5665» from a saved URL; null when it is not an IPv4 host. */
function canonicalProbeUrl(raw: string): string | null {
  const m = /^(https?):\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})(?:\/.*)?$/i.exec((raw || '').trim());
  if (!m) return null;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return null;
  const octets = m[2].split('.');
  for (let i = 0; i < octets.length; i++) if (Number(octets[i]) > 255) return null;
  return m[1].toLowerCase() + '://' + m[2] + ':' + port;
}

/**
 * Probe order: `prefer` (saved / last-known) first, then likely hosts, then the rest of each subnet.
 * One URL once. A preferred address on another subnet is still probed; it is not part of the sweep.
 */
export function probeUrls(subnets: string[], ports: number[], prefer?: string[]): string[] {
  const urls: string[] = [];
  const seen: Record<string, boolean> = {};
  const add = (u: string) => {
    if (!u || seen[u]) return;
    seen[u] = true;
    urls.push(u);
  };
  (prefer || []).forEach((raw) => {
    const u = canonicalProbeUrl(raw);
    if (u) add(u);
  });
  const hosts = scanHosts();
  subnets.forEach((sn) => {
    hosts.forEach((h) => {
      ports.forEach((p) => add('http://' + sn + '.' + h + ':' + p));
    });
  });
  return urls;
}

export function candidateSubnets(localIp: string | null, knownUrls: string[]): string[] {
  const out: string[] = [];
  const add = (s: string | null) => { if (s && out.indexOf(s) < 0) out.push(s); };
  add(localIp ? subnetOf(localIp) : null);
  knownUrls.forEach((u) => {
    const m = /^https?:\/\/([\d.]+)(?::\d+)?/.exec(u);
    add(m ? subnetOf(m[1]) : null);
  });
  add('192.168.1');
  add('192.168.0');
  return out;
}

export type RegisterAbort = (abort: () => void) => void;
export type Probe = (url: string, timeoutMs: number, register?: RegisterAbort) => Promise<string | null>;

/**
 * GET <url>/echo through XMLHttpRequest. Unlike fetch (no AbortController in Chromium 53) the native
 * xhr.timeout / abort() really close the socket, so a LAN scan cannot exhaust the browser socket pool.
 */
export const probeEcho: Probe = (url, timeoutMs, register) =>
  new Promise<string | null>((resolve) => {
    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', url + '/echo', true);
      xhr.responseType = 'text';
      xhr.timeout = timeoutMs;
    } catch (_e) {
      resolve(null);
      return;
    }
    const miss = () => resolve(null);
    xhr.onerror = miss;
    xhr.ontimeout = miss;
    xhr.onabort = miss;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return resolve(null);
      const v = String(xhr.responseText || '').trim();
      resolve(v && v.length < 64 && v.indexOf('<') < 0 ? v : null);
    };
    if (register) register(() => { try { xhr.abort(); } catch (_e) { /* ignore */ } });
    try {
      xhr.send();
    } catch (_e) {
      resolve(null);
    }
  });

export interface DiscoverOptions {
  subnets: string[];
  ports?: number[];
  /** Saved or last-known server URLs. Probed before the sweep and not repeated inside it. */
  prefer?: string[];
  /** Max probes in flight (default DEFAULT_CONCURRENCY). A slot is freed only when the probe promise settles. */
  concurrency?: number;
  timeoutMs?: number;
  probe?: Probe;
  /**
   * Polled (every 50 ms and on each launch). Once true: no new probes are launched, in-flight probes
   * are aborted through their registered abort hook and discover resolves immediately with the hits so far.
   */
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  onFound?: (s: FoundServer) => void;
}

export function discover(o: DiscoverOptions): Promise<FoundServer[]> {
  const ports = o.ports || DEFAULT_PORTS;
  const urls = probeUrls(o.subnets, ports, o.prefer);
  const probe = o.probe || probeEcho;
  const timeout = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const conc = o.concurrency || DEFAULT_CONCURRENCY;
  const found: FoundServer[] = [];
  let next = 0;
  let done = 0;
  let active = 0;
  return new Promise((resolve) => {
    if (!urls.length) {
      resolve(found);
      return;
    }
    let finished = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const aborts: Array<() => void> = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      resolve(found);
    };
    const cancelled = () => {
      if (finished) return true;
      if (!o.isCancelled || !o.isCancelled()) return false;
      finished = true;
      if (timer) clearInterval(timer);
      aborts.splice(0).forEach((a) => { try { a(); } catch (_e) { /* ignore */ } });
      resolve(found);
      return true;
    };
    const launch = () => {
      while (active < conc && next < urls.length) {
        if (cancelled()) return;
        const url = urls[next++];
        active++;
        let abort: (() => void) | null = null;
        const register: RegisterAbort = (fn) => { abort = fn; aborts.push(fn); };
        let p: Promise<string | null>;
        try {
          p = probe(url, timeout, register);
        } catch (_e) {
          p = Promise.resolve(null);
        }
        p.then((v) => v, () => null).then((version) => {
          active--;
          if (abort) {
            const i = aborts.indexOf(abort);
            if (i >= 0) aborts.splice(i, 1);
          }
          if (finished) return;
          done++;
          if (version) {
            const s = { url, version };
            found.push(s);
            if (o.onFound) o.onFound(s);
          }
          if (o.onProgress) o.onProgress(done, urls.length);
          if (done === urls.length) finish();
          else launch();
        });
      }
    };
    if (o.isCancelled) timer = setInterval(cancelled, 50);
    launch();
  });
}

/** IPv4 of the TV: luna connectionmanager on webOS, the native plugin on Android TV. */
export function getLocalIp(): Promise<string | null> {
  if (platformKind() === 'androidtv') return nativeLocalIp();
  return lunaCall<any>('luna://com.webos.service.connectionmanager/getStatus', {}, 2000).then(
    (r) => (r.wired && r.wired.ipAddress) || (r.wifi && r.wifi.ipAddress) || null,
    () => null,
  );
}
