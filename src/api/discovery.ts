import { request } from './http';
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

export function probeEcho(url: string, timeoutMs: number): Promise<string | null> {
  return request<string>(url + '/echo', { responseType: 'text', timeoutMs }).then(
    (t) => {
      const v = (t || '').trim();
      return v && v.length < 64 && v.indexOf('<') < 0 ? v : null;
    },
    () => null,
  );
}

export interface DiscoverOptions {
  subnets: string[];
  ports?: number[];
  concurrency?: number;
  timeoutMs?: number;
  probe?: (url: string, timeoutMs: number) => Promise<string | null>;
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
  const conc = o.concurrency || 32;
  const found: FoundServer[] = [];
  let next = 0;
  let done = 0;
  let active = 0;
  return new Promise((resolve) => {
    if (!urls.length) {
      resolve(found);
      return;
    }
    const launch = () => {
      while (active < conc && next < urls.length) {
        const url = urls[next++];
        active++;
        probe(url, timeout)
          .then((v) => v, () => null)
          .then((version) => {
            active--;
            done++;
            if (version) {
              const s = { url, version };
              found.push(s);
              if (o.onFound) o.onFound(s);
            }
            if (o.onProgress) o.onProgress(done, urls.length);
            if (done === urls.length) resolve(found);
            else launch();
          });
      }
    };
    launch();
  });
}

export function getLocalIp(): Promise<string | null> {
  return lunaCall<any>('luna://com.webos.service.connectionmanager/getStatus', {}, 2000).then(
    (r) => (r.wired && r.wired.ipAddress) || (r.wifi && r.wifi.ipAddress) || null,
    () => null,
  );
}
