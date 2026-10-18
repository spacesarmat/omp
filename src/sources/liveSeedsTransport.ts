// How this device asks a tracker. Phone and Android TV: native HTTP and UDP (BEP 15).
// webOS: HTTP only. JS cannot open a UDP socket, and the Luna services this app uses
// (connectionmanager, settings, media, applicationManager, hbchannel) do not either.
// There is no stock Luna call for an arbitrary datagram. TorrServer's peer counts exist
// only after a torrent is added, so they are not used to count a search row.
import { nativePlugin } from '../platform/androidNative';
import { latin1FromBuffer, noopTransport, type ScrapeCounts, type ScrapeTransport } from './liveSeeds';

const MAX_BODY = 262144;
let seq = 0;

function nextId(): string {
  seq = (seq + 1) % 1000000;
  return 's' + seq.toString(36) + Date.now().toString(36);
}

interface NativeScrape {
  trackerScrape?(o: { kind: string; url?: string; host?: string; port?: number; infohash?: string; timeoutMs?: number; id?: string }): Promise<{ text?: unknown; seeders?: unknown; leechers?: unknown }>;
  trackerScrapeCancel?(o: { id: string }): Promise<unknown>;
}

function nativeTransport(p: NativeScrape): ScrapeTransport {
  const call = p.trackerScrape!;
  const cancelCall = p.trackerScrapeCancel;
  return {
    http(url, timeoutMs) {
      const id = nextId();
      const promise = call({ kind: 'http', url: url, timeoutMs: timeoutMs, id: id }).then(
        (r) => (r && typeof r.text === 'string' ? r.text : null),
        () => null,
      );
      return {
        promise: promise,
        cancel() {
          if (cancelCall) cancelCall({ id: id }).then(() => undefined, () => undefined);
        },
      };
    },
    udp(host, port, infohash, timeoutMs) {
      const id = nextId();
      const promise = call({ kind: 'udp', host: host, port: port, infohash: infohash, timeoutMs: timeoutMs, id: id }).then(
        (r): ScrapeCounts | null => {
          if (!r || typeof r.seeders !== 'number' || typeof r.leechers !== 'number') return null;
          if (r.seeders < 0 || r.leechers < 0) return null;
          return { seeders: r.seeders, leechers: r.leechers };
        },
        () => null,
      );
      return {
        promise: promise,
        cancel() {
          if (cancelCall) cancelCall({ id: id }).then(() => undefined, () => undefined);
        },
      };
    },
  };
}

/** HTTP scrape from the webOS app (and a desktop preview). Cross-origin XHR is how the TV already talks to TorrServer. */
export function xhrTransport(): ScrapeTransport {
  return {
    http(url, timeoutMs) {
      let xhr: XMLHttpRequest | null = null;
      const promise = new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (v: string | null) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        try {
          const x = new XMLHttpRequest();
          xhr = x;
          x.open('GET', url, true);
          x.responseType = 'arraybuffer';
          x.timeout = timeoutMs;
          x.onload = () => {
            if (x.status < 200 || x.status >= 300) return finish(null);
            const buf = x.response;
            if (!buf || typeof (buf as ArrayBuffer).byteLength !== 'number') return finish(null);
            finish(latin1FromBuffer(buf as ArrayBuffer, MAX_BODY));
          };
          x.onerror = () => finish(null);
          x.ontimeout = () => finish(null);
          x.onabort = () => finish(null);
          x.send();
        } catch (e) {
          finish(null);
        }
      });
      return {
        promise: promise,
        cancel() {
          try {
            if (xhr) xhr.abort();
          } catch (e) {
            // already finished
          }
        },
      };
    },
    udp() {
      return { promise: Promise.resolve(null), cancel() {} };
    },
  };
}

/** Native scrape on Android (HTTP and UDP). Elsewhere, HTTP via XHR. No UDP on webOS. */
export function platformTransport(): ScrapeTransport {
  const p = nativePlugin() as NativeScrape | null;
  if (p && typeof p.trackerScrape === 'function') return nativeTransport(p);
  if (typeof XMLHttpRequest !== 'undefined') return xhrTransport();
  return noopTransport();
}
