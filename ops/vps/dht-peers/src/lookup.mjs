// One DHT node, created on the first lookup and destroyed after idleMs with no lookup in flight.
// It answers get_peers only. It does not announce, and it does not keep a database.
// While the socket is open the process replies to routing pings. After idle it sends nothing.
//
// Bootstrap (phase 2): the public routers listen on UDP 6881, which the ISP filters above the NUC,
// so an ephemeral node never fills its routing table. DHT_BOOTSTRAP_NODES adds reachable host:port
// nodes (on the NUC, the LAN bitmagnet DHT port) on top of the public routers; no address is hardcoded
// here. bittorrent-dht emits 'ready' when populate times out even with an empty table, so a ready
// node with zero routing entries is reported not_ready, never a false "0 peers" success.
import DHT from 'bittorrent-dht';
import { estimateBloom, mergeBloom, parseScrapeFilters } from './bloom.mjs';
import { peerTotal, rememberPeer, waitForReady } from './peers.mjs';

// The library's own public bootstrap routers. Env nodes are added to these, not replacing them.
const DEFAULT_BOOTSTRAP = ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881'];
const MAX_BOOTSTRAP_NODES = 32;

/**
 * Parse a DHT_BOOTSTRAP_NODES list (comma/whitespace/semicolon separated host:port) into valid
 * `host:port` strings. Bad ports, empty hosts and duplicates are dropped. Empty input gives [].
 */
export function parseBootstrapNodes(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const out = [];
  const seen = Object.create(null);
  const parts = text.split(/[\s,;]+/);
  for (let i = 0; i < parts.length && out.length < MAX_BOOTSTRAP_NODES; i++) {
    const item = parts[i].trim();
    if (!item) continue;
    const idx = item.lastIndexOf(':');
    if (idx <= 0) continue;
    const host = item.slice(0, idx).trim();
    const port = Number(item.slice(idx + 1));
    if (!host || host.length > 253 || /[\s/\\]/.test(host)) continue;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = host.toLowerCase() + ':' + port;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(host + ':' + port);
  }
  return out;
}

/**
 * Routing-table size of a bittorrent-dht node, or null when the node does not expose the table
 * (a test double). null means "cannot verify", so the caller falls back to the ready flag alone.
 */
export function routingTableSize(node) {
  const table = node && node.nodes;
  if (!table || typeof table.toArray !== 'function') return null;
  try {
    const rows = table.toArray();
    return Array.isArray(rows) ? rows.length : null;
  } catch (e) {
    return null;
  }
}

function sampleResult(failed, dht, seen, seeds, peersF, scraped) {
  if (failed) return { ok: false, error: 'down' };
  const peers = peerTotal(seen);
  if (peers === 0 && scraped === 0 && !dht.ready) return { ok: false, error: 'not_ready' };
  return {
    ok: true,
    peers: peers,
    seedsEstimate: seeds ? estimateBloom(seeds) || 0 : 0,
    peerEstimate: peersF ? estimateBloom(peersF) || 0 : 0,
    scraped: scraped > 0,
  };
}

function rememberValues(seen, values, maxPeers) {
  const list = values || [];
  for (let i = 0; i < list.length; i++) rememberPeer(seen, list[i], maxPeers);
}

/** get_peers with scrape=1. Bloom filters from every reply are OR-merged, then estimated once. */
function collectScrape(dht, hash, timeoutMs, maxPeers, schedule, clearTimer) {
  const set = schedule || ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer || ((timer) => clearTimeout(timer));
  return new Promise((resolve) => {
    const seen = Object.create(null);
    let seeds = null;
    let peersF = null;
    let scraped = 0;
    let settled = false;
    const finish = (failed) => {
      if (settled) return;
      settled = true;
      clear(timer);
      resolve(sampleResult(failed, dht, seen, seeds, peersF, scraped));
    };
    const timer = set(() => finish(false), timeoutMs);
    try {
      const infoHash = Buffer.from(hash, 'hex');
      dht._closest(
        infoHash,
        {
          q: 'get_peers',
          a: {
            id: dht._rpc.id,
            info_hash: infoHash,
            scrape: 1,
          },
        },
        (message) => {
          if (settled) return false;
          const r = message && message.r;
          if (r && r.values) rememberValues(seen, r.values, maxPeers);
          const filters = parseScrapeFilters(message);
          if (filters && (filters.seeds || filters.peers)) {
            if (filters.seeds) seeds = mergeBloom(seeds, filters.seeds);
            if (filters.peers) peersF = mergeBloom(peersF, filters.peers);
            scraped++;
          }
          return true;
        },
        () => finish(false),
      );
    } catch (e) {
      finish(true);
    }
  });
}

function collectLookup(dht, hash, timeoutMs, maxPeers, schedule, clearTimer) {
  const set = schedule || ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer || ((timer) => clearTimeout(timer));
  return new Promise((resolve) => {
    const seen = Object.create(null);
    let settled = false;
    const onPeer = (peer, infoHash) => {
      if (settled || !infoHash) return;
      if (infoHash.toString('hex') !== hash) return;
      rememberPeer(seen, peer, maxPeers);
    };
    dht.on('peer', onPeer);
    const finish = (failed) => {
      if (settled) return;
      settled = true;
      clear(timer);
      dht.removeListener('peer', onPeer);
      resolve(sampleResult(failed, dht, seen, null, null, 0));
    };
    let abort = () => {};
    const timer = set(() => {
      try {
        abort();
      } catch (e) {
        /* the lookup already ended */
      }
      finish(false);
    }, timeoutMs);
    try {
      const cancel = dht.lookup(hash, () => finish(false));
      if (typeof cancel === 'function') abort = cancel;
    } catch (e) {
      finish(true);
    }
  });
}

function collectPeers(dht, hash, timeoutMs, maxPeers, schedule, clearTimer) {
  if (dht && typeof dht._closest === 'function' && dht._rpc) {
    return collectScrape(dht, hash, timeoutMs, maxPeers, schedule, clearTimer);
  }
  return collectLookup(dht, hash, timeoutMs, maxPeers, schedule, clearTimer);
}

export function createDhtLookup(opts) {
  const o = opts || {};
  const lookupMs = o.lookupMs || 8000;
  const idleMs = o.idleMs || 10 * 60 * 1000;
  const maxPeers = o.maxPeers || 300;
  const now = o.now || (() => Date.now());
  const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((timer) => clearTimeout(timer));
  const createNode = o.createNode || ((nodeOpts) => new DHT(nodeOpts));
  const tableSize = o.tableSize || routingTableSize;
  // Extra reachable bootstrap nodes (DHT_BOOTSTRAP_NODES), added to the public routers. Empty by
  // default so the node options stay exactly as before when no extra node is configured.
  const bootstrap = Array.isArray(o.bootstrap) ? o.bootstrap.filter((n) => typeof n === 'string' && n) : [];
  let node = null;
  let busy = 0;
  let idleTimer = null;

  function armIdle() {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = schedule(() => {
      idleTimer = null;
      if (busy > 0) return armIdle();
      const current = node;
      node = null;
      if (current && !current.destroyed) current.destroy();
    }, idleMs);
    if (idleTimer && idleTimer.unref) idleTimer.unref();
  }

  function ensure() {
    if (node && !node.destroyed) return node;
    const nodeOpts = {
      // Caps so a warm node stays inside the 150 MB container limit.
      maxTables: 4,
      maxValues: 8,
      maxPeers: 200,
      maxAge: 10 * 60 * 1000,
    };
    // Only set bootstrap when extra nodes exist, so the default node options are unchanged.
    if (bootstrap.length) nodeOpts.bootstrap = DEFAULT_BOOTSTRAP.concat(bootstrap);
    const created = createNode(nodeOpts);
    created.on('error', () => {});
    created.on('warning', () => {});
    created.listen();
    node = created;
    return created;
  }

  return {
    state() {
      return node && !node.destroyed ? 'up' : 'idle';
    },
    busy() {
      return busy > 0;
    },
    async lookup(infohash) {
      const hash = String(infohash || '').toLowerCase();
      let dht;
      try {
        dht = ensure();
      } catch (e) {
        return { ok: false, error: 'down' };
      }
      busy++;
      const started = now();
      try {
        // An empty routing table finishes get_peers at once and would look like "0 peers".
        // Wait out the bootstrap inside the same budget, then search with the time left.
        await waitForReady(dht, lookupMs, schedule, clearTimer);
        const left = lookupMs - (now() - started);
        if (!dht.ready || left < 1000) return { ok: false, error: 'not_ready' };
        // 'ready' also fires when populate times out with no answer. A ready node whose routing
        // table is still empty has not bootstrapped: report not_ready, not a false "0 peers".
        // A null size (a node that does not expose the table) falls back to the ready flag alone.
        const size = tableSize(dht);
        if (size !== null && size <= 0) return { ok: false, error: 'not_ready' };
        return await collectPeers(dht, hash, left, maxPeers, schedule, clearTimer);
      } finally {
        busy--;
        armIdle();
      }
    },
  };
}
