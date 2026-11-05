// One DHT node, created on the first lookup and destroyed after idleMs with no lookup in flight.
// It answers get_peers only. It does not announce, and it does not keep a database.
// While the socket is open the process replies to routing pings. After idle it sends nothing.
// bittorrent-dht is loaded by main.mjs and passed as createNode. This file stays free of that
// import so the app test runner can load it without the sidecar's node_modules.
import { peerTotal, rememberPeer, waitForReady } from './peers.mjs';

function collectPeers(dht, hash, timeoutMs, maxPeers, schedule, clearTimer) {
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
      if (failed) return resolve({ ok: false, error: 'down' });
      const peers = peerTotal(seen);
      if (peers === 0 && !dht.ready) return resolve({ ok: false, error: 'not_ready' });
      resolve({ ok: true, peers: peers });
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

export function createDhtLookup(opts) {
  const o = opts || {};
  const lookupMs = o.lookupMs || 8000;
  const idleMs = o.idleMs || 10 * 60 * 1000;
  const maxPeers = o.maxPeers || 300;
  const now = o.now || (() => Date.now());
  const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((timer) => clearTimeout(timer));
  const createNode = o.createNode;
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
    if (!createNode) throw new Error('dht node factory is required');
    const created = createNode({
      // Caps so a warm node stays inside the 150 MB container limit.
      maxTables: 4,
      maxValues: 8,
      maxPeers: 200,
      maxAge: 10 * 60 * 1000,
    });
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
        return await collectPeers(dht, hash, left, maxPeers, schedule, clearTimer);
      } finally {
        busy--;
        armIdle();
      }
    },
  };
}
