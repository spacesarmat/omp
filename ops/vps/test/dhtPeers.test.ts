import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain module
import { createDhtApp } from '../dht-peers/src/http.mjs';
// @ts-ignore plain module
import { countPeerKeys, createPeerCache, parseCompactPeer, peerKey, waitForReady } from '../dht-peers/src/peers.mjs';
// @ts-ignore plain module
import { createDhtLookup } from '../dht-peers/src/lookup.mjs';
import { EventEmitter } from 'node:events';

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
    expect(JSON.parse(health.body)).toEqual({ ok: true, dht: 'idle' });
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

function controlledNode() {
  const node = new EventEmitter() as EventEmitter & {
    ready: boolean;
    destroyed: boolean;
    listen: () => void;
    destroy: () => void;
    announce: () => void;
    lookup: (hash: string, cb: () => void) => () => void;
  };
  const calls = {
    opts: null as { maxTables: number; maxValues: number; maxPeers: number; maxAge: number } | null,
    listen: 0,
    destroy: 0,
    announce: 0,
    lookups: [] as string[],
    aborts: 0,
    finish: null as null | (() => void),
  };
  node.ready = false;
  node.destroyed = false;
  node.listen = () => {
    calls.listen++;
  };
  node.destroy = () => {
    node.destroyed = true;
    calls.destroy++;
  };
  node.announce = () => {
    calls.announce++;
  };
  node.lookup = (hash, cb) => {
    calls.lookups.push(hash);
    calls.finish = () => cb();
    return () => {
      calls.aborts++;
    };
  };
  return { node, calls };
}

describe('createDhtLookup limits', () => {
  const hash = 'ab'.repeat(20);

  function harness(extra?: { lookupMs?: number; idleMs?: number; maxPeers?: number; ready?: boolean }) {
    const clk = manualClock();
    const made = controlledNode();
    if (extra && extra.ready) made.node.ready = true;
    const lookup = createDhtLookup({
      lookupMs: extra && extra.lookupMs !== undefined ? extra.lookupMs : 5000,
      idleMs: extra && extra.idleMs !== undefined ? extra.idleMs : 1000,
      maxPeers: extra && extra.maxPeers !== undefined ? extra.maxPeers : 300,
      now: clk.now,
      schedule: clk.schedule,
      clearTimer: clk.clear,
      createNode: (opts: { maxTables: number; maxValues: number; maxPeers: number; maxAge: number }) => {
        made.calls.opts = opts;
        return made.node;
      },
    });
    return { clk, made, lookup };
  }

  it('builds a capped node, collects unique peers for this hash, and does not announce', async () => {
    const { made, lookup } = harness({ ready: true, maxPeers: 2 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    expect(made.calls.opts).toEqual({ maxTables: 4, maxValues: 8, maxPeers: 200, maxAge: 10 * 60 * 1000 });
    expect(made.calls.listen).toBe(1);
    expect(made.calls.announce).toBe(0);
    expect(made.calls.lookups).toEqual([hash]);
    expect(lookup.busy()).toBe(true);
    made.node.emit('peer', { host: '1.1.1.1', port: 1 }, Buffer.from(hash, 'hex'));
    made.node.emit('peer', { host: '1.1.1.1', port: 1 }, Buffer.from(hash, 'hex'));
    made.node.emit('peer', { host: '2.2.2.2', port: 1 }, Buffer.from(hash, 'hex'));
    made.node.emit('peer', { host: '3.3.3.3', port: 1 }, Buffer.from(hash, 'hex'));
    made.node.emit('peer', { host: '9.9.9.9', port: 1 }, Buffer.from('b'.repeat(40), 'hex'));
    made.calls.finish!();
    expect(await pending).toEqual({ ok: true, peers: 2 });
    expect(lookup.busy()).toBe(false);
  });

  it('does not search until the node is ready, and gives up inside the budget', async () => {
    const { clk, made, lookup } = harness({ lookupMs: 4000 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    expect(lookup.busy()).toBe(true);
    expect(made.calls.lookups).toEqual([]);
    clk.flush(4000);
    expect(await pending).toEqual({ ok: false, error: 'not_ready' });
    expect(made.calls.lookups).toEqual([]);
    expect(lookup.busy()).toBe(false);
    expect(lookup.state()).toBe('up');
  });

  it('cancels a lookup that outlives the remaining budget', async () => {
    const { clk, made, lookup } = harness({ ready: true, lookupMs: 2500 });
    const pending = lookup.lookup(hash);
    await Promise.resolve();
    expect(made.calls.lookups).toEqual([hash]);
    clk.flush(2500);
    expect(made.calls.aborts).toBe(1);
    expect(await pending).toEqual({ ok: true, peers: 0 });
  });

  it('closes the node after idle, and keeps it while another lookup is running', async () => {
    const { clk, made, lookup } = harness({ ready: true, lookupMs: 5000, idleMs: 1000 });
    const first = lookup.lookup(hash);
    await Promise.resolve();
    made.calls.finish!();
    expect((await first).ok).toBe(true);
    expect(made.calls.destroy).toBe(0);
    clk.flush(999);
    expect(made.calls.destroy).toBe(0);
    expect(lookup.state()).toBe('up');
    const second = lookup.lookup(hash);
    await Promise.resolve();
    expect(lookup.busy()).toBe(true);
    expect(made.calls.listen).toBe(1);
    clk.flush(1);
    expect(made.calls.destroy).toBe(0);
    made.calls.finish!();
    await second;
    clk.flush(1000);
    expect(made.calls.destroy).toBe(1);
    expect(lookup.state()).toBe('idle');
  });
});
