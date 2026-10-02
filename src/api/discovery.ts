import { lunaCall } from '../platform/luna';

export interface FoundServer {
  url: string;
  version: string;
}

export const DEFAULT_PORTS = [8090, 5665];

export function subnetOf(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return m ? m[1] : null;
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
  /** Max probes in flight (default 24). A slot is freed only when the probe promise settles. */
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
  const urls: string[] = [];
  o.subnets.forEach((sn) => {
    for (let i = 1; i <= 254; i++) ports.forEach((p) => urls.push('http://' + sn + '.' + i + ':' + p));
  });
  const probe = o.probe || probeEcho;
  const timeout = o.timeoutMs || 1200;
  const conc = o.concurrency || 24;
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

export function getLocalIp(): Promise<string | null> {
  return lunaCall<any>('luna://com.webos.service.connectionmanager/getStatus', {}, 2000).then(
    (r) => (r.wired && r.wired.ipAddress) || (r.wifi && r.wifi.ipAddress) || null,
    () => null,
  );
}
