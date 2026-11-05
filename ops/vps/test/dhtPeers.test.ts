import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore plain module
import { createDhtApp } from '../dht-peers/src/http.mjs';
// @ts-ignore plain module
import { countPeerKeys, createPeerCache, parseCompactPeer, peerKey, waitForReady } from '../dht-peers/src/peers.mjs';
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
  });
});
