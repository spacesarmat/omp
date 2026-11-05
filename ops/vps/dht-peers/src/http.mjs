// Internal HTTP API. No published port: billing is the only caller, and only with DHT_TOKEN.
// An empty or short token refuses every lookup (503), so a compose file without the secret is not an open proxy.
import { timingSafeEqual } from 'node:crypto';
import { createPeerCache, peersBody } from './peers.mjs';

const MIN_TOKEN = 16;

export function tokenConfigured(token) {
  return typeof token === 'string' && token.length >= MIN_TOKEN;
}

/** True when `Authorization` is exactly `Bearer <token>`. A length mismatch is a refusal, not a compare. */
export function bearerOk(header, token) {
  if (!tokenConfigured(token)) return false;
  const raw = String(header || '');
  if (raw.slice(0, 7).toLowerCase() !== 'bearer ') return false;
  const got = raw.slice(7).trim();
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function sendJson(res, status, body, extra) {
  const buf = Buffer.from(JSON.stringify(body));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length };
  if (extra) {
    const names = Object.keys(extra);
    for (let i = 0; i < names.length; i++) headers[names[i]] = extra[names[i]];
  }
  res.writeHead(status, headers);
  res.end(buf);
}

/**
 * `lookup(infohash) -> Promise<{ ok: true, peers: number } | { ok: false, error: 'not_ready' | 'down' }>`.
 * `lookup.busy()` is true while a lookup is already running (one at a time, so RAM stays bounded).
 * `lookup.state()` is 'idle' or 'up' for /health and does not open a socket.
 */
export function createDhtApp(opts) {
  const o = opts || {};
  const token = String(o.token || '');
  const lookup = o.lookup;
  const cache = o.cache || createPeerCache(o);
  return function onRequest(req, res) {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch(() => {
        if (!res.headersSent) sendJson(res, 502, { error: 'down' });
      });
  };

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method' });
    if (url.pathname === '/health') {
      const state = lookup && typeof lookup.state === 'function' ? lookup.state() : 'idle';
      const mem = process.memoryUsage();
      const rss = mem && typeof mem.rss === 'number' && mem.rss >= 0 ? Math.floor(mem.rss) : 0;
      return sendJson(res, 200, { ok: true, dht: state === 'up' ? 'up' : 'idle', rss });
    }
    if (url.pathname !== '/v1/peers') return sendJson(res, 404, { error: 'not_found' });
    if (!tokenConfigured(token)) return sendJson(res, 503, { error: 'disabled' });
    if (!bearerOk(req.headers.authorization, token)) return sendJson(res, 401, { error: 'bad_token' });
    const hash = String(url.searchParams.get('infohash') || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash)) return sendJson(res, 400, { error: 'bad_infohash' });
    const hit = cache.get(hash);
    if (hit !== null) return sendJson(res, 200, peersBody(hit, true));
    if (lookup && typeof lookup.busy === 'function' && lookup.busy()) {
      return sendJson(res, 429, { error: 'rate', retryAfter: 2 }, { 'retry-after': '2' });
    }
    const found = await lookup.lookup(hash);
    if (!found || !found.ok) {
      if (found && found.error === 'not_ready') return sendJson(res, 503, { error: 'down' });
      return sendJson(res, 502, { error: 'down' });
    }
    const peers = found.peers > 0 ? Math.floor(found.peers) : 0;
    cache.put(hash, peers);
    return sendJson(res, 200, peersBody(peers, false));
  }
}
