// Wake-on-LAN: the magic packet and where it is sent. No sockets here.
import { normalizeMac } from '../tvStore';

export interface WakeTarget {
  host: string;
  port: number;
}

export type UdpSend = (packet: Uint8Array, host: string, port: number) => Promise<void>;

const GLOBAL = '255.255.255.255';

function ipv4(v: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v.trim());
  if (!m) return null;
  const n = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (n.some((x) => x > 255)) return null;
  return n;
}

/** 6 x 0xFF and the MAC repeated 16 times. Null when `mac` is not a MAC. */
export function magicPacket(mac: string): Uint8Array | null {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  const parts = norm.split(':').map((h) => parseInt(h, 16));
  const out = new Uint8Array(102);
  out.fill(0xff, 0, 6);
  for (let r = 0; r < 16; r++) for (let i = 0; i < 6; i++) out[6 + r * 6 + i] = parts[i];
  return out;
}

/** Directed broadcast of `ip` under `netmask`. Null when either address is bad or the mask is not contiguous. */
export function broadcastAddress(ip: string, netmask: string): string | null {
  const a = ipv4(ip);
  const mask = ipv4(netmask);
  if (!a || !mask) return null;
  const bits = ((mask[0] << 24) | (mask[1] << 16) | (mask[2] << 8) | mask[3]) >>> 0;
  const inv = (~bits) >>> 0;
  if ((inv & ((inv + 1) >>> 0)) !== 0) return null;
  return a.map((b, i) => (b | (mask[i] ^ 255)) & 255).join('.');
}

function slash24(ip: string): string | null {
  const a = ipv4(ip);
  if (!a) return null;
  return a[0] + '.' + a[1] + '.' + a[2] + '.255';
}

/** UDP 9 and 7 on the global broadcast and on the subnet broadcast (reported, else the /24 of `ip`). */
export function wakeTargets(ip: string, broadcast?: string): WakeTarget[] {
  const reported = broadcast && ipv4(broadcast) ? broadcast : null;
  const sub = reported || slash24(ip);
  const hosts = [GLOBAL];
  if (sub && sub !== GLOBAL) hosts.push(sub);
  const out: WakeTarget[] = [];
  for (let h = 0; h < hosts.length; h++) {
    out.push({ host: hosts[h], port: 9 });
    out.push({ host: hosts[h], port: 7 });
  }
  return out;
}

/** MAC and broadcast from what a paired device reports. A netmask fills in a missing broadcast. */
export function netFromReport(v: unknown): { mac?: string; broadcast?: string } {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const mac = normalizeMac(o.mac);
  let broadcast: string | null = null;
  if (typeof o.broadcast === 'string' && ipv4(o.broadcast)) broadcast = o.broadcast.trim();
  if (!broadcast && typeof o.ip === 'string' && typeof o.netmask === 'string') broadcast = broadcastAddress(o.ip, o.netmask);
  const out: { mac?: string; broadcast?: string } = {};
  if (mac) out.mac = mac;
  if (broadcast) out.broadcast = broadcast;
  return out;
}

/** Three copies of the packet, to every target. Throws before any send when the MAC is bad. */
export async function sendWake(mac: string, ip: string, broadcast: string | undefined, send: UdpSend): Promise<void> {
  const packet = magicPacket(mac);
  if (!packet) throw new Error('bad MAC');
  const targets = wakeTargets(ip, broadcast);
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < targets.length; i++) await send(packet, targets[i].host, targets[i].port);
  }
}

interface ChromeUdp {
  create: (props: object, cb: (info: { socketId: number }) => void) => void;
  send: (socketId: number, data: ArrayBuffer, address: string, port: number, cb: (r: { resultCode?: number }) => void) => void;
  close?: (socketId: number, cb: () => void) => void;
}

/** A browser can send UDP only through chrome.sockets.udp (Chrome apps). Otherwise null. */
export function browserUdpSend(): UdpSend | null {
  const chrome = (globalThis as { chrome?: { sockets?: { udp?: ChromeUdp } } }).chrome;
  const udp = chrome && chrome.sockets && chrome.sockets.udp;
  if (!udp || typeof udp.create !== 'function' || typeof udp.send !== 'function') return null;
  return (packet, host, port) =>
    new Promise<void>((resolve, reject) => {
      udp.create({}, (info) => {
        if (!info || typeof info.socketId !== 'number') {
          reject(new Error('udp'));
          return;
        }
        const copy = packet.slice().buffer;
        const finish = (err?: Error) => {
          const done = () => (err ? reject(err) : resolve());
          if (typeof udp.close === 'function') udp.close(info.socketId, done);
          else done();
        };
        udp.send(info.socketId, copy, host, port, (r) => {
          if (r && typeof r.resultCode === 'number' && r.resultCode < 0) finish(new Error('udp'));
          else finish();
        });
      });
    });
}
