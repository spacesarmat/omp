import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// Hoisted above the adapter import. The root suite does not install ops/vps/dht-peers dependencies.
const dhtMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  type NodeOpts = { maxTables: number; maxValues: number; maxPeers: number; maxAge: number };
  const bag = {
    startReady: false,
    instances: [] as FakeDht[],
  };
  class FakeDht {
    ready: boolean;
    destroyed = false;
    opts: NodeOpts;
    listened = 0;
    destroys = 0;
    announces = 0;
    lookups: string[] = [];
    aborts = 0;
    finish: (() => void) | null = null;
    private listeners: { [ev: string]: Listener[] } = {};
    constructor(opts: NodeOpts) {
      this.opts = opts;
      this.ready = bag.startReady;
      bag.instances.push(this);
    }
    on(ev: string, fn: Listener) {
      if (!this.listeners[ev]) this.listeners[ev] = [];
      this.listeners[ev].push(fn);
    }
    removeListener(ev: string, fn: Listener) {
      const list = this.listeners[ev] || [];
      this.listeners[ev] = list.filter((item) => item !== fn);
    }
    emit(ev: string, ...args: unknown[]) {
      const list = this.listeners[ev] || [];
      for (let i = 0; i < list.length; i++) list[i](...args);
    }
    listen() {
      this.listened++;
    }
    destroy() {
      this.destroyed = true;
      this.destroys++;
    }
    announce() {
      this.announces++;
    }
    lookup(hash: string, cb: () => void) {
      this.lookups.push(hash);
      this.finish = () => cb();
      return () => {
        this.aborts++;
      };
    }
  }
  return { FakeDht, bag };
});

vi.mock('bittorrent-dht', () => ({ default: dhtMock.FakeDht }));

// @ts-ignore plain module
import { createDhtApp } from '../dht-peers/src/http.mjs';
// @ts-ignore plain module
import { countPeerKeys, createPeerCache, parseCompactPeer, peerKey, waitForReady } from '../dht-peers/src/peers.mjs';
// @ts-ignore plain module
import { createDhtLookup } from '../dht-peers/src/lookup.mjs';

const TOKEN = 'ab'.repeat(16);
const HASH = 'cd'.repeat(20);

function call(port: number, path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(app: (req: IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('compact DHT peers', () => {
  it('reads one IPv4 peer and drops port 0', () => {
    expect(parseCompactPeer(Buffer.from([1, 2, 3, 4, 0x1a, 0xe1]))).toBe('1.2.3.4:6881');
    expect(parseCompactPeer(Buffer.from([1, 2, 3, 4, 0, 0]))).toBe('');
    expect(parseCompactPeer(Buffer.from([0, 0, 0, 0, 0x1a, 0xe1]))).toBe('');
    expect(parseCompactPeer(Buffer.alloc(12))).toBe('');
  });

  it('reads one IPv6 peer', () => {
    const buf = Buffer.alloc(18);
    buf[15] = 1;
    buf.writeUInt16BE(6881, 16);
    expect(parseCompactPeer(buf)).toBe('0:0:0:0:0:0:0:1:6881');
  });

  it('counts unique keys and ignores empties', () => {
    expect(countPeerKeys(['1.2.3.4:1', '1.2.3.4:1', '', '8.8.8.8:9'])).toBe(2);
    expect(peerKey('1.2.3.4', 0)).toBe('');
    expect(peerKey('1.2.3.4', 80)).toBe('1.2.3.4:80');
  });

  it('waits for the node to become ready, and stops at the deadline', async () => {
    const warm = new EventEmitter() as EventEmitter & { ready?: boolean };
    warm.ready = false;
    const pending = waitForReady(warm, 1000);
    setTimeout(() => {
      warm.ready = true;
      warm.emit('ready');
    }, 20);
    expect(await pending).toBe(true);

    const already = new EventEmitter() as EventEmitter & { ready?: boolean };
    already.ready = true;
    expect(await waitForReady(already, 1000)).toBe(true);

    const cold = new EventEmitter() as EventEmitter & { ready?: boolean };
    cold.ready = false;
    expect(await waitForReady(cold, 30)).toBe(false);
    expect(cold.listenerCount('ready')).toBe(0);
  });

  it('keeps a positive count longer than a zero', () => {
    let now = 1_000;
    const cache = createPeerCache({ now: () => now, ttlMs: 100, missTtlMs: 30, max: 2 });
    cache.put(HASH, 4);
    cache.put('aa'.repeat(20), 0);
    now = 1_040;
    expect(cache.get(HASH)).toBe(4);
    expect(cache.get('aa'.repeat(20))).toBe(null);
    cache.put('bb'.repeat(20), 1);
    cache.put('cc'.repeat(20), 2);
    expect(cache.get(HASH)).toBe(null);
  });
});

describe('dht-peers HTTP contract', () => {
  function lookup(peers: number, opts?: { busy?: boolean; fail?: 'not_ready' | 'down' }) {
    let calls = 0;
    return {
      calls: () => calls,
      state: () => 'idle' as const,
      busy: () => !!opts?.busy,
      lookup: async () => {
        calls++;
        if (opts?.fail) return { ok: false as const, error: opts.fail };
        return { ok: true as const, peers };
      },
    };
  }

  it('health does not look up, and a missing token disables the proxy', async () => {
    const found = lookup(3);
    const srv = await listen(createDhtApp({ token: '', lookup: found }));
    const health = await call(srv.port, '/health');
    expect(health.status).toBe(200);
    const healthBody = JSON.parse(health.body);
    expect(healthBody.ok).toBe(true);
    expect(healthBody.dht).toBe('idle');
    expect(typeof healthBody.rss).toBe('number');
    expect(healthBody.rss).toBeGreaterThan(0);
    const peers = await call(srv.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer ' + TOKEN });
    expect(peers.status).toBe(503);
    expect(JSON.parse(peers.body)).toEqual({ error: 'disabled' });
    expect(found.calls()).toBe(0);
    await srv.close();
  });

  it('requires the bearer, rejects a bad hash, and returns only the count', async () => {
    const found = lookup(9);
    const srv = await listen(createDhtApp({ token: TOKEN, lookup: found }));
    expect((await call(srv.port, '/v1/peers?infohash=' + HASH)).status).toBe(401);
    expect((await call(srv.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer wrong-token-value!!' })).status).toBe(401);
    const bad = await call(srv.port, '/v1/peers?infohash=zzzz', { authorization: 'Bearer ' + TOKEN });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: 'bad_infohash' });
    const ok = await call(srv.port, '/v1/peers?infohash=' + HASH.toUpperCase(), { authorization: 'Bearer ' + TOKEN });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ peers: 9, source: 'dht', approx: true, cached: false });
    const again = await call(srv.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer ' + TOKEN });
    expect(JSON.parse(again.body).cached).toBe(true);
    expect(found.calls()).toBe(1);
    await srv.close();
  });

  it('does not cache a node that is not ready, and refuses a second lookup while one runs', async () => {
    const cold = lookup(0, { fail: 'not_ready' });
    const srv = await listen(createDhtApp({ token: TOKEN, lookup: cold }));
    const first = await call(srv.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer ' + TOKEN });
    expect(first.status).toBe(503);
    await call(srv.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer ' + TOKEN });
    expect(cold.calls()).toBe(2);
    await srv.close();

    const busy = lookup(1, { busy: true });
    const srv2 = await listen(createDhtApp({ token: TOKEN, lookup: busy }));
    const limited = await call(srv2.port, '/v1/peers?infohash=' + HASH, { authorization: 'Bearer ' + TOKEN });
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body).error).toBe('rate');
    expect(busy.calls()).toBe(0);
    await srv2.close();
  });
});

describe('compose bounds for dht-peers', () => {
  const base = readFileSync('ops/vps/docker-compose.yml', 'utf8');
  const nuc = readFileSync('ops/vps/docker-compose.nuc.yml', 'utf8');

  it('stays off the default up, publishes nothing, and caps memory', () => {
    const start = base.indexOf('\n  dht-peers:\n');
    expect(start).toBeGreaterThan(0);
    const block = base.slice(start, base.indexOf('\nnetworks:', start));
    expect(block).toContain('profiles: ["dht"]');
    expect(block).toContain('container_name: omp-dht-peers');
    expect(block).toContain('mem_limit: 150m');
    expect(block).toContain('memswap_limit: 150m');
    expect(block).toContain('DHT_TOKEN: ${DHT_PEERS_TOKEN:-}');
    expect(block).toContain('cap_drop:');
    expect(block).not.toMatch(/^\s+ports:/m);
    expect(base).toContain('BILLING_DHT_URL: ${BILLING_DHT_URL:-http://dht-peers:8788}');
    expect(base).toContain('BILLING_DHT_TOKEN: ${DHT_PEERS_TOKEN:-}');
    expect(base).toMatch(/NO_PROXY:.*\bdht-peers\b/);
    expect(nuc).toMatch(/NO_PROXY:.*\bdht-peers\b/);
    expect(base).not.toContain('- dht-peers');
    expect(readFileSync('ops/vps/README.md', 'utf8')).toContain('/opt/omp-vps/dht-peers');
  });
});

function manualClock() {
  let now = 0;
  const items: { at: number; fn: () => void; dead: boolean }[] = [];
  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const item = { at: now + ms, fn, dead: false };
      items.push(item);
      return item;
    },
    clear(item: { dead: boolean }) {
      item.dead = true;
    },
    flush(ms: number) {
      const end = now + ms;
      for (;;) {
        let next: { at: number; fn: () => void; dead: boolean } | null = null;
        for (let i = 0; i < items.length; i++) {
          const t = items[i];
          if (t.dead || t.at > end) continue;
          if (!next || t.at < next.at) next = t;
        }
        if (!next) break;
        now = next.at;
        next.dead = true;
        next.fn();
      }
      now = end;
    },
  };
}

describe('createDhtLookup limits', () => {
  const hash = 'ab'.repeat(20);

  function harness(extra?: { lookupMs?: number; idleMs?: number; maxPeers?: number; ready?: boolean }) {
    const clk = manualClock();
    dhtMock.bag.instances.length = 0;
    dhtMock.bag.startReady = !!(extra && extra.ready);
    const lookup = createDhtLookup({
      lookupMs: extra && extra.lookupMs !== undefined ? extra.lookupMs : 5000,
      idleMs: extra && extra.idleMs !== undefined ? extra.idleMs : 1000,
      maxPeers: extra && extra.maxPeers !== undefined ? extra.maxPeers : 300,
      now: clk.now,
      schedule: clk.schedule,
      clearTimer: clk.clear,
    });
    return { clk, lookup, node: () => dhtMock.bag.instances[dhtMock.bag.instances.length - 1] };
  }

  it('builds a capped node, collects unique peers for this hash, and does not announce', async () => {
    const { lookup, node } = harness({ ready: true, maxPeers: 2 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    const made = node();
    expect(made.opts).toEqual({ maxTables: 4, maxValues: 8, maxPeers: 200, maxAge: 10 * 60 * 1000 });
    expect(made.listened).toBe(1);
    expect(made.announces).toBe(0);
    expect(made.lookups).toEqual([hash]);
    expect(lookup.busy()).toBe(true);
    made.emit('peer', { host: '1.1.1.1', port: 1 }, Buffer.from(hash, 'hex'));
    made.emit('peer', { host: '1.1.1.1', port: 1 }, Buffer.from(hash, 'hex'));
    made.emit('peer', { host: '2.2.2.2', port: 1 }, Buffer.from(hash, 'hex'));
    made.emit('peer', { host: '3.3.3.3', port: 1 }, Buffer.from(hash, 'hex'));
    made.emit('peer', { host: '9.9.9.9', port: 1 }, Buffer.from('b'.repeat(40), 'hex'));
    made.finish!();
    expect(await pending).toEqual({ ok: true, peers: 2 });
    expect(lookup.busy()).toBe(false);
  });

  it('does not search until the node is ready, and gives up inside the budget', async () => {
    const { clk, lookup, node } = harness({ lookupMs: 4000 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    const made = node();
    expect(lookup.busy()).toBe(true);
    expect(made.lookups).toEqual([]);
    clk.flush(4000);
    expect(await pending).toEqual({ ok: false, error: 'not_ready' });
    expect(made.lookups).toEqual([]);
    expect(lookup.busy()).toBe(false);
    expect(lookup.state()).toBe('up');
  });

  it('cancels a lookup that outlives the remaining budget', async () => {
    const { clk, lookup, node } = harness({ ready: true, lookupMs: 2500 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    const made = node();
    expect(made.lookups).toEqual([hash]);
    clk.flush(2500);
    expect(made.aborts).toBe(1);
    expect(await pending).toEqual({ ok: true, peers: 0 });
  });

  it('closes the node after idle, and keeps it while another lookup is running', async () => {
    const { clk, lookup, node } = harness({ ready: true, lookupMs: 5000, idleMs: 1000 });
    const first = lookup.lookup(hash);
    await Promise.resolve();
    const made = node();
    made.finish!();
    expect((await first).ok).toBe(true);
    expect(made.destroys).toBe(0);
    clk.flush(999);
    expect(made.destroys).toBe(0);
    expect(lookup.state()).toBe('up');
    const second = lookup.lookup(hash);
    await Promise.resolve();
    expect(lookup.busy()).toBe(true);
    expect(made.listened).toBe(1);
    expect(dhtMock.bag.instances).toHaveLength(1);
    clk.flush(1);
    expect(made.destroys).toBe(0);
    made.finish!();
    await second;
    clk.flush(1000);
    expect(made.destroys).toBe(1);
    expect(lookup.state()).toBe('idle');
  });
});
