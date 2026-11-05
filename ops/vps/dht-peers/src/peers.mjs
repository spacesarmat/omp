// Compact peers from a DHT get_peers reply (BEP 5 / BEP 32) and the small in-memory cache.
// One value is one peer: 6 bytes IPv4 or 18 bytes IPv6. A count is how many unique peers we saw,
// not a seeder/leecher split and not a full census of the swarm.

const MAX_PEERS = 300;

/** One compact peer string, or '' when the buffer is not a single IPv4 or IPv6 peer. */
export function parseCompactPeer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length === 6) {
    const host = b[0] + '.' + b[1] + '.' + b[2] + '.' + b[3];
    const port = b.readUInt16BE(4);
    return peerKey(host, port);
  }
  if (b.length === 18) {
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(b.readUInt16BE(i).toString(16));
    return peerKey(parts.join(':'), b.readUInt16BE(16));
  }
  return '';
}

/** `host:port` for a decoded peer, or '' when the host or port is not usable. */
export function peerKey(host, port) {
  if (typeof host !== 'string') return '';
  const h = host.trim().toLowerCase();
  if (!h || h.length > 64 || h === '0.0.0.0' || h === '::') return '';
  if (/[\s/\\]/.test(h)) return '';
  const p = typeof port === 'number' ? port : parseInt(port, 10);
  if (!Number.isFinite(p) || p !== Math.floor(p) || p < 1 || p > 65535) return '';
  return h + ':' + p;
}

/**
 * Unique peer keys, capped. `items` are keys from peerKey / parseCompactPeer.
 * Duplicate and empty entries do not add to the count.
 */
export function countPeerKeys(items, max) {
  const cap = max === undefined ? MAX_PEERS : max;
  const seen = Object.create(null);
  let n = 0;
  const list = items || [];
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    if (!key || seen[key]) continue;
    seen[key] = 1;
    n++;
    if (n >= cap) break;
  }
  return n;
}

/** Remember one decoded `{ host, port }` or a compact buffer. Returns the key, or ''. */
export function rememberPeer(seen, peer, max) {
  const cap = max === undefined ? MAX_PEERS : max;
  if (Object.keys(seen).length >= cap) return '';
  let key = '';
  if (Buffer.isBuffer(peer)) key = parseCompactPeer(peer);
  else if (peer && typeof peer === 'object') key = peerKey(peer.host, peer.port);
  if (!key || seen[key]) return '';
  seen[key] = 1;
  return key;
}

export function peerTotal(seen) {
  return Object.keys(seen).length;
}

/**
 * Successful counts stay for `ttlMs` (repeat taps do not open another lookup).
 * A real zero stays for `missTtlMs` only. A lookup that never became ready is not stored.
 */
export function createPeerCache(opts) {
  const o = opts || {};
  const ttlMs = o.ttlMs === undefined ? 10 * 60 * 1000 : o.ttlMs;
  const missTtlMs = o.missTtlMs === undefined ? 30 * 1000 : o.missTtlMs;
  const max = o.max === undefined ? 100 : o.max;
  const now = o.now || (() => Date.now());
  const map = new Map();
  return {
    get(hash) {
      const row = map.get(hash);
      if (!row) return null;
      if (now() - row.at >= row.ttl) {
        map.delete(hash);
        return null;
      }
      return row.peers;
    },
    put(hash, peers) {
      map.delete(hash);
      map.set(hash, { peers: peers, at: now(), ttl: peers > 0 ? ttlMs : missTtlMs });
      while (map.size > max) {
        const first = map.keys().next().value;
        map.delete(first);
      }
    },
  };
}

/**
 * Resolves true when `target` emits `ready` (or is already ready), false when `timeoutMs` passes first.
 * One listener, removed on either path.
 */
export function waitForReady(target, timeoutMs, schedule, clearTimer) {
  const set = schedule || ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer || ((timer) => clearTimeout(timer));
  return new Promise((resolve) => {
    if (target.ready) {
      resolve(true);
      return;
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clear(timer);
      target.removeListener('ready', onReady);
      resolve(ok);
    };
    const onReady = () => done(true);
    const timer = set(() => done(false), timeoutMs);
    target.on('ready', onReady);
  });
}

/** Body the app is allowed to see: a count, never peer addresses. */
export function peersBody(peers, cached) {
  return { peers: peers, source: 'dht', approx: true, cached: !!cached };
}
