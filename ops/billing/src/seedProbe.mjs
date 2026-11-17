// Fresh seeder counts for the top search rows. The app sends infohashes and announce URLs.
// This process scrapes those trackers (HTTP BEP 48, UDP BEP 15) from the NUC address, with a
// shared cap so one search cannot stampede a tracker. When the sidecar is configured, DHT covers
// every stale hash with no tracker address (not just one): capped-concurrency lookups inside one
// shared budget, merged per hash. The sidecar serves one lookup at a time and rate-limits the rest.
// BEP 33 seed estimates are labeled estimates. The get_peers address count is not a seed count.
// `completed` is the tracker's snatched count (BEP 48 `downloaded`, BEP 15 downloaded), not seeds.
// When a bitmagnet source is passed, hashes left without a tracker measurement (samples = 0, the
// tracker-less magnets) also get its DHT-derived counts as an estimate in the answer only: never
// live, never verified, never stored - seed_probes keeps tracker-verified measurements alone.
// The background refresh of popular hashes lives in seedRefresh.mjs: one hash a minute, same gate.
import { isIP } from 'node:net';
import { isPublicAddress } from './monitorHttp.mjs';
import { mergeBitmagnetCounts } from './bitmagnetSource.mjs';

export const SEED_TOP_N = 30;
export const SEED_MAX_TRACKERS = 2;
// Per-job scrape budget. Phase 2 raised it from 1200: the direct ISP path answers in ~200 ms, but
// an http->https redirect chain (up to 3 hops, each re-gated) needs room, and the old 1200 ms cut
// working chains short. The batch deadline below still bounds the whole scrape phase.
export const SEED_TRACKER_TIMEOUT_MS = 4500;
export const SEED_BATCH_DEADLINE_MS = 5000;
export const SEED_MAX_IN_FLIGHT = 6;
export const SEED_PER_HOST_GAP_MS = 500;
export const SEED_WINDOW_MS = 10 * 1000;
export const SEED_WINDOW_MAX = 24;
export const SEED_DEVICE_MAX = 8;
export const SEED_DEVICE_WINDOW_MS = 60 * 1000;
export const TTL_POPULAR_MS = 20 * 60 * 1000;
export const TTL_RARE_MS = 4 * 60 * 60 * 1000;
export const TTL_MISS_MS = 10 * 60 * 1000;
/**
 * Every background attempt (success or failure) stamps refreshed_at; selection skips the row for
 * this long afterwards. Half the popular TTL - the same cadence as the due threshold - so a dead
 * tracker cannot block the queue: while one row backs off, the next tick takes another hash.
 */
export const REFRESH_BACKOFF_MS = Math.floor(TTL_POPULAR_MS / 2);
export const POPULAR_SEEDS = 15;
export const POPULAR_HITS = 3;
export const COUNT_CAP = 1000000;
// Shared budget for the batch's DHT lookups. Phase 2 raised it from 1500: the sidecar needs
// ~2300-5000 ms to bootstrap and answer (BEP 33), so the old 1500 ms race discarded working replies.
const DHT_WAIT_MS = 6000;
// Concurrent sidecar lookups per batch. The sidecar answers one at a time and 429s the rest; the
// cap keeps the fan-out bounded while every stale hash still gets a chance inside the budget.
const DHT_MAX_IN_FLIGHT = 4;
// Short answer cache over the bitmagnet source: one GraphQL batch per hash per minute, not per
// request. A miss (the crawler does not know the hash) is cached for the same window.
export const BITMAGNET_CACHE_TTL_MS = 60 * 1000;
const BITMAGNET_CACHE_MAX = 2048;

function capCount(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0 || n !== Math.floor(n)) return null;
  if (n > COUNT_CAP) return COUNT_CAP;
  return n;
}

/** A scrape dict is a few levels deep. Deeper input is refused so a small body cannot blow the stack. */
const BDECODE_MAX_DEPTH = 32;

/** Bencode value, or null when the input is truncated, too deep, or not one whole value. */
export function bdecode(input) {
  try {
    const s = String(input || '');
    const r = bdecodeAt(s, 0, 0);
    if (!r || r.i !== s.length) return null;
    return r.v;
  } catch (e) {
    return null;
  }
}

function bdecodeAt(s, i, depth) {
  if (depth > BDECODE_MAX_DEPTH || i >= s.length) return null;
  const c = s.charAt(i);
  if (c === 'i') return bdecodeInt(s, i);
  if (c === 'l') return bdecodeList(s, i, depth);
  if (c === 'd') return bdecodeDict(s, i, depth);
  if (c >= '0' && c <= '9') return bdecodeStr(s, i);
  return null;
}

function bdecodeInt(s, i) {
  let j = i + 1;
  let neg = false;
  if (s.charAt(j) === '-') {
    neg = true;
    j++;
  }
  const start = j;
  while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
  if (j === start || s.charAt(j) !== 'e') return null;
  if (s.charAt(start) === '0' && (j - start > 1 || neg)) return null;
  const n = parseInt(s.substring(i + 1, j), 10);
  if (!isFinite(n)) return null;
  return { v: n, i: j + 1 };
}

function bdecodeStr(s, i) {
  let j = i;
  while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
  if (j === i || s.charAt(j) !== ':') return null;
  if (s.charAt(i) === '0' && j - i > 1) return null;
  const len = parseInt(s.substring(i, j), 10);
  if (!isFinite(len) || len < 0) return null;
  const start = j + 1;
  const end = start + len;
  if (end > s.length) return null;
  return { v: s.substring(start, end), i: end };
}

function bdecodeList(s, i, depth) {
  const out = [];
  let j = i + 1;
  while (j < s.length && s.charAt(j) !== 'e') {
    const item = bdecodeAt(s, j, depth + 1);
    if (!item) return null;
    out.push(item.v);
    j = item.i;
  }
  if (s.charAt(j) !== 'e') return null;
  return { v: out, i: j + 1 };
}

function bdecodeDict(s, i, depth) {
  const out = {};
  let j = i + 1;
  while (j < s.length && s.charAt(j) !== 'e') {
    const key = bdecodeStr(s, j);
    if (!key) return null;
    const val = bdecodeAt(s, key.i, depth + 1);
    if (!val) return null;
    out[key.v] = val.v;
    j = val.i;
  }
  if (s.charAt(j) !== 'e') return null;
  return { v: out, i: j + 1 };
}

/** 20 raw bytes of a 40-hex infohash, or null. */
export function infohashBytes(hex) {
  const h = String(hex || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) return null;
  let s = '';
  for (let i = 0; i < 40; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return s;
}

export function encodeInfohash(hex) {
  const b = infohashBytes(hex);
  if (b === null) return null;
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const hexb = b.charCodeAt(i).toString(16).toUpperCase();
    out += '%' + (hexb.length < 2 ? '0' : '') + hexb;
  }
  return out;
}

/** HTTP(S) scrape URL: the first "announce" in the path becomes "scrape". Null for UDP and for a path with no announce. */
export function httpScrapeUrl(announce, infohashHex) {
  const enc = encodeInfohash(infohashHex);
  if (!enc) return null;
  let u;
  try {
    u = new URL(announce);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!/announce/i.test(u.pathname)) return null;
  const path = u.pathname.replace(/announce/i, 'scrape');
  const q = u.search ? u.search + '&' : '?';
  return u.origin + path + q + 'info_hash=' + enc;
}

/**
 * Seeders (`complete`) and leechers (`incomplete`) for this infohash.
 * `completed` (the snatched count, BEP 48 `downloaded`) is added only when the tracker sent it.
 * A scrape dict with a single file entry is accepted even when its key does not match.
 */
export function parseHttpScrape(body, infohashHex) {
  let v;
  try {
    v = bdecode(body);
  } catch (e) {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const files = v.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const key = infohashBytes(infohashHex);
  let entry;
  if (key !== null && Object.prototype.hasOwnProperty.call(files, key)) entry = files[key];
  if (entry === undefined) {
    const keys = Object.keys(files);
    if (keys.length === 1) entry = files[keys[0]];
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const seeders = capCount(entry.complete);
  const leechers = capCount(entry.incomplete);
  if (seeders === null || leechers === null) return null;
  const out = { seeders, leechers };
  const completed = capCount(entry.downloaded);
  if (completed !== null) out.completed = completed;
  return out;
}

const MAGIC = 0x41727101980n;

export function connectRequest(tx) {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64BE(MAGIC, 0);
  buf.writeUInt32BE(0, 8);
  buf.writeUInt32BE(tx >>> 0, 12);
  return buf;
}

/** Connection id as bigint, or null when the packet is not the connect reply for `tx`. */
export function readConnect(packet, tx) {
  const buf = Buffer.isBuffer(packet) ? packet : Buffer.from(packet || []);
  if (buf.length < 16) return null;
  const action = buf.readUInt32BE(0);
  const got = buf.readUInt32BE(4);
  if (action !== 0 || got !== (tx >>> 0)) return null;
  return buf.readBigUInt64BE(8);
}

export function scrapeRequest(connectionId, tx, infohashHex) {
  const raw = infohashBytes(infohashHex);
  if (raw === null) return null;
  const buf = Buffer.alloc(16 + 20);
  buf.writeBigUInt64BE(BigInt(connectionId), 0);
  buf.writeUInt32BE(2, 8);
  buf.writeUInt32BE(tx >>> 0, 12);
  Buffer.from(raw, 'latin1').copy(buf, 16);
  return buf;
}

/** Seeders / completed / leechers, or null for an error packet or a mismatched transaction. */
export function readScrape(packet, tx) {
  const buf = Buffer.isBuffer(packet) ? packet : Buffer.from(packet || []);
  if (buf.length < 20) return null;
  const action = buf.readUInt32BE(0);
  const got = buf.readUInt32BE(4);
  if (action !== 2 || got !== (tx >>> 0)) return null;
  const seeders = capCount(buf.readUInt32BE(8));
  const completed = capCount(buf.readUInt32BE(12));
  const leechers = capCount(buf.readUInt32BE(16));
  if (seeders === null || leechers === null || completed === null) return null;
  return { seeders, completed, leechers };
}

function hostOk(host) {
  if (!host || host.length > 253) return false;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return false;
  if (lower === 'metadata.google.internal') return false;
  if (isIP(host)) return isPublicAddress(host);
  return true;
}

/**
 * One announce URL the magnet named. HTTP becomes a scrape URL. UDP keeps host and port.
 * Userinfo, private addresses, and anything that is not http(s) or udp are dropped.
 * A hostname is not resolved here: the transport refuses a name that resolves to a private address.
 */
export function parseTracker(raw, infohash) {
  const text = String(raw || '').trim();
  if (!text || text.length > 300) return null;
  let u;
  try {
    u = new URL(text);
  } catch (e) {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!hostOk(host)) return null;
  if (u.protocol === 'udp:') {
    const port = u.port ? parseInt(u.port, 10) : 6969;
    if (!port || port < 1 || port > 65535) return null;
    return { kind: 'udp', host, port, url: '' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const url = httpScrapeUrl(text, infohash);
  if (!url) return null;
  const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80;
  if (!port || port < 1 || port > 65535) return null;
  return { kind: 'http', host, port, url };
}

/** Up to two trackers, different hosts, first announce first. */
export function trackerJobs(item) {
  const hash = String(item && item.infohash || '').toLowerCase();
  const list = item && Array.isArray(item.trackers) ? item.trackers : [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < list.length && out.length < SEED_MAX_TRACKERS; i++) {
    const t = parseTracker(list[i], hash);
    if (!t || seen[t.host]) continue;
    seen[t.host] = true;
    out.push({ hash, host: t.host, kind: t.kind, url: t.url, port: t.port });
  }
  return out;
}

/**
 * Hosts the caller named, sorted, without the path or a passkey.
 * The cache key is this plus the infohash, so one caller's tracker cannot overwrite another's row.
 */
export function trackerKey(item) {
  const hash = String(item && item.infohash || '').toLowerCase();
  const list = item && Array.isArray(item.trackers) ? item.trackers : [];
  const seen = Object.create(null);
  const hosts = [];
  for (let i = 0; i < list.length; i++) {
    const t = parseTracker(list[i], hash);
    if (!t) continue;
    const host = t.host.toLowerCase();
    if (seen[host]) continue;
    seen[host] = true;
    hosts.push(host);
  }
  hosts.sort();
  const key = hosts.join(',');
  return key.length > 1024 ? key.slice(0, 1024) : key;
}

/**
 * The only paths stored for a re-scrape: a bare announce/scrape endpoint, optionally .php.
 * A passkey can sit in a path segment (/secret/announce, /announce/<token>): such a URL is
 * credential-bearing and is dropped from storage, not stripped. The foreground scrape still
 * uses the full original URL - this whitelist is for the cache row only.
 */
const STORED_ANNOUNCE_PATH = /^\/(announce|scrape)(\.php)?$/i;

/**
 * Credential-free announce addresses for the cache row: scheme, host, port and a standard
 * announce path only. The query (a passkey can sit there), the fragment and userinfo are dropped,
 * and a path with extra segments (a passkey or token can sit there) drops the whole URL.
 * UDP keeps host and port. The background refresh re-scrapes these; they are never logged.
 */
export function publicTrackers(item) {
  const hash = String((item && item.infohash) || '').toLowerCase();
  const list = item && Array.isArray(item.trackers) ? item.trackers : [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < list.length && out.length < 4; i++) {
    const raw = String(list[i] || '');
    if (!raw || raw.length > 300) continue;
    const t = parseTracker(raw, hash);
    if (!t) continue;
    let url;
    try {
      const u = new URL(raw);
      if (t.kind === 'udp') {
        url = 'udp://' + (t.host.indexOf(':') >= 0 ? '[' + t.host + ']' : t.host) + ':' + t.port + '/announce';
      } else {
        // a non-standard path can carry a credential: refuse to store it at all
        if (!STORED_ANNOUNCE_PATH.test(u.pathname)) continue;
        url = u.origin + u.pathname;
      }
    } catch (e) {
      continue;
    }
    if (seen[url]) continue;
    seen[url] = true;
    out.push(url);
  }
  return out;
}

/**
 * Trackers safe to store for a refresh: credential-free, and only when they rebuild the same
 * tracker key as the original list. A mixed list (a credential-path tracker alongside clean ones)
 * would refresh under a different key and never update this row, so nothing is stored and the
 * selection skips it; the row keeps being checked when a device asks with the full addresses.
 */
export function storedTrackers(item) {
  const list = publicTrackers(item);
  if (!list.length) return [];
  const hash = String((item && item.infohash) || '').toLowerCase();
  return trackerKey({ infohash: hash, trackers: list }) === trackerKey(item) ? list : [];
}

export function probeKey(infohash, key) {
  return String(infohash || '') + '\n' + String(key || '');
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid];
  return Math.round((s[mid - 1] + s[mid]) / 2);
}

/** A DHT callback may return a peer count or a BEP 33 sample. Address counts are never seed estimates. */
export function dhtSample(raw) {
  if (typeof raw === 'number') return { peers: capCount(raw) || 0, dhtSeeds: 0, peerEstimate: 0, estimate: false };
  if (!raw || typeof raw !== 'object') return { peers: 0, dhtSeeds: 0, peerEstimate: 0, estimate: false };
  const seeds = capCount(raw.seedsEstimate !== undefined ? raw.seedsEstimate : raw.dhtSeeds);
  const swarm = capCount(raw.peerEstimate);
  return {
    peers: capCount(raw.peers) || 0,
    dhtSeeds: seeds === null ? 0 : seeds,
    peerEstimate: swarm === null ? 0 : swarm,
    estimate: raw.estimate === true || raw.scraped === true,
  };
}

/**
 * Chosen seeders: the median when two or more trackers answered, otherwise the max.
 * Leechers come from the sample closest to that choice.
 * `completed` (snatched) follows the same median/max rule over the samples that reported it;
 * a tracker that did not send `downloaded` does not pull the count down.
 * `peers` is the DHT address sample. `dhtSeeds` is the BEP 33 estimate. Only a tracker answer is verified.
 */
export function mergeMeasurements(samples, dhtPeers, now) {
  const list = Array.isArray(samples) ? samples.filter((s) => s && capCount(s.seeders) !== null && capCount(s.leechers) !== null) : [];
  const seeds = list.map((s) => s.seeders);
  const seedersMax = seeds.length ? Math.max.apply(null, seeds) : 0;
  const seedersMedian = seeds.length ? median(seeds) : 0;
  const chosen = seeds.length >= 2 ? seedersMedian : seedersMax;
  const comps = list.filter((s) => capCount(s.completed) !== null).map((s) => s.completed);
  const completed = comps.length >= 2 ? median(comps) : comps.length ? Math.max.apply(null, comps) : 0;
  let leechers = 0;
  if (list.length) {
    let best = list[0];
    let dist = Math.abs(best.seeders - chosen);
    for (let i = 1; i < list.length; i++) {
      const d = Math.abs(list[i].seeders - chosen);
      if (d < dist || (d === dist && list[i].leechers > best.leechers)) {
        best = list[i];
        dist = d;
      }
    }
    leechers = best.leechers;
  }
  const dht = dhtSample(dhtPeers);
  const live = list.length > 0;
  return {
    seeders: chosen,
    leechers,
    completed,
    seedersMax,
    seedersMedian,
    peers: dht.peers,
    dhtSeeds: dht.dhtSeeds,
    peerEstimate: dht.peerEstimate,
    estimate: dht.estimate,
    samples: list.length,
    live,
    verified: live,
    measuredAt: now,
  };
}

/** Popular rows (many seeds, or asked often) expire in 20 minutes. A rare live row lasts 4 hours. A miss lasts 10 minutes. */
export function ttlMs(row) {
  const useful = row && (row.live || (row.dhtSeeds || 0) > 0 || (row.peers || 0) > 0);
  if (!useful) return TTL_MISS_MS;
  if ((row.seeders || 0) >= POPULAR_SEEDS || (row.dhtSeeds || 0) >= POPULAR_SEEDS || (row.hits || 0) >= POPULAR_HITS) return TTL_POPULAR_MS;
  return TTL_RARE_MS;
}

export function cacheFresh(row, now) {
  if (!row || typeof row.measuredAt !== 'number') return false;
  return now - row.measuredAt < ttlMs(row);
}

export function createTrackerGate(opts) {
  const o = opts || {};
  const maxInFlight = o.maxInFlight || SEED_MAX_IN_FLIGHT;
  const perHostGapMs = o.perHostGapMs === undefined ? SEED_PER_HOST_GAP_MS : o.perHostGapMs;
  const windowMs = o.windowMs || SEED_WINDOW_MS;
  const windowMax = o.windowMax || SEED_WINDOW_MAX;
  let inFlight = 0;
  const hostAt = Object.create(null);
  const stamps = [];
  function prune(now) {
    while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
  }
  return {
    maxInFlight,
    allow(host, now) {
      if (inFlight >= maxInFlight) return false;
      prune(now);
      if (stamps.length >= windowMax) return false;
      if (Object.prototype.hasOwnProperty.call(hostAt, host) && now - hostAt[host] < perHostGapMs) return false;
      return true;
    },
    take(host, now) {
      if (!this.allow(host, now)) return false;
      inFlight += 1;
      hostAt[host] = now;
      stamps.push(now);
      return true;
    },
    release() {
      inFlight = inFlight > 0 ? inFlight - 1 : 0;
    },
    // Why a take would fail, as a wait time: the ms left on the per-host gap when the gap is the
    // ONLY blocker (a sequential request may wait it out), 0 when take would succeed right now, or
    // null when a concurrency/window cap blocks. A cap is a legitimate limit, not a gap to wait out.
    gapWaitMs(host, now) {
      if (inFlight >= maxInFlight) return null;
      prune(now);
      if (stamps.length >= windowMax) return null;
      if (Object.prototype.hasOwnProperty.call(hostAt, host) && now - hostAt[host] < perHostGapMs) {
        return perHostGapMs - (now - hostAt[host]);
      }
      return 0;
    },
  };
}

export function createMemorySeedCache() {
  const rows = new Map();
  const idOf = (row) => probeKey(row.infohash, row.trackerKey);
  return {
    async get(keys) {
      const out = [];
      const list = Array.isArray(keys) ? keys : [];
      for (let i = 0; i < list.length; i++) {
        const row = rows.get(idOf(list[i]));
        if (row) out.push({ ...row, trackers: Array.isArray(row.trackers) ? row.trackers.slice() : [] });
      }
      return out;
    },
    async touch(keys, now) {
      const list = Array.isArray(keys) ? keys : [];
      for (let i = 0; i < list.length; i++) {
        const row = rows.get(idOf(list[i]));
        if (!row) continue;
        row.hits += 1;
        row.lastHitAt = now;
      }
    },
    // A background attempt stamp: selection backs off, the measurement itself is untouched.
    async noteRefresh(keys, now) {
      const list = Array.isArray(keys) ? keys : [];
      for (let i = 0; i < list.length; i++) {
        const row = rows.get(idOf(list[i]));
        if (row) row.refreshedAt = now;
      }
    },
    async save(list) {
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        const id = idOf(row);
        const prev = rows.get(id);
        rows.set(id, {
          infohash: row.infohash,
          trackerKey: row.trackerKey || '',
          seeders: row.seeders,
          leechers: row.leechers,
          completed: row.completed || 0,
          seedersMax: row.seedersMax,
          seedersMedian: row.seedersMedian,
          peers: row.peers,
          dhtSeeds: row.dhtSeeds || 0,
          peerEstimate: row.peerEstimate || 0,
          estimate: !!row.estimate,
          samples: row.samples,
          measuredAt: row.measuredAt,
          live: !!row.live,
          hits: (prev ? prev.hits : 0) + 1,
          lastHitAt: row.measuredAt,
          trackers: Array.isArray(row.trackers) ? row.trackers.slice() : [],
          refreshedAt: row.refreshedAt || (prev ? prev.refreshedAt : 0) || 0,
        });
      }
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory TTL cache over a bitmagnet source, in the same fetchCounts shape. Fresh answers (and
 * misses) are served from the window without a network call; only hashes the cache does not hold
 * are asked, in one batch. A disabled source never fetches; a source error resolves to an empty
 * map. Expired entries are pruned and the table is capped, so a long-lived process stays bounded.
 * Counts only: no URL or infohash is ever logged here.
 */
export function createBitmagnetCountsCache(source, opts) {
  const o = opts || {};
  const ttlMs = typeof o.ttlMs === 'number' && o.ttlMs >= 0 ? o.ttlMs : BITMAGNET_CACHE_TTL_MS;
  const nowFn = typeof o.now === 'function' ? o.now : () => Date.now();
  const rows = new Map();
  return {
    get enabled() {
      return !!(source && source.enabled);
    },
    async fetchCounts(infoHashes) {
      const out = new Map();
      if (!source || !source.enabled || typeof source.fetchCounts !== 'function') return out;
      const now = nowFn();
      for (const [h, e] of rows) if (now - e.at >= ttlMs) rows.delete(h);
      const list = Array.isArray(infoHashes) ? infoHashes : [];
      const seen = Object.create(null);
      const miss = [];
      for (let i = 0; i < list.length; i++) {
        const h = String(list[i] || '').trim().toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(h) || seen[h]) continue;
        seen[h] = 1;
        const e = rows.get(h);
        if (e) {
          if (e.row) out.set(h, e.row);
        } else {
          miss.push(h);
        }
      }
      if (!miss.length) return out;
      let fetched = new Map();
      try {
        fetched = await source.fetchCounts(miss);
      } catch (e) {
        fetched = new Map();
      }
      if (!fetched || typeof fetched.get !== 'function') fetched = new Map();
      for (let i = 0; i < miss.length; i++) {
        const h = miss[i];
        const row = (fetched && fetched.get(h)) || null;
        rows.set(h, { row, at: now });
        if (row) out.set(h, row);
      }
      if (rows.size > BITMAGNET_CACHE_MAX) {
        let drop = rows.size - BITMAGNET_CACHE_MAX;
        for (const h of rows.keys()) {
          if (drop <= 0) break;
          rows.delete(h);
          drop -= 1;
        }
      }
      return out;
    },
  };
}

/**
 * Body of POST /v1/seed-check. `items` may be an array or a JSON string (the app posts a form).
 * Duplicate infohashes collapse. More than 30 are cut. A bad row is skipped.
 */
export function parseSeedRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  let items = body.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      return { ok: false };
    }
  }
  if (!Array.isArray(items)) return { ok: false };
  const out = [];
  const index = Object.create(null);
  for (let i = 0; i < items.length && out.length < SEED_TOP_N; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    const hash = String(it.infohash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash)) continue;
    const trackers = [];
    const raw = Array.isArray(it.trackers) ? it.trackers : [];
    for (let j = 0; j < raw.length && trackers.length < 4; j++) {
      if (typeof raw[j] !== 'string' || raw[j].length > 300) continue;
      trackers.push(raw[j]);
    }
    if (index[hash] === undefined) {
      index[hash] = out.length;
      out.push({ infohash: hash, trackers });
    } else {
      const dest = out[index[hash]];
      for (let j = 0; j < trackers.length && dest.trackers.length < 4; j++) {
        if (dest.trackers.indexOf(trackers[j]) < 0) dest.trackers.push(trackers[j]);
      }
    }
  }
  return { ok: true, items: out };
}

function publicItem(hash, merged, cached) {
  const out = {
    infohash: hash,
    verified: !!merged.verified,
    live: !!merged.live,
    seeders: merged.seeders || 0,
    leechers: merged.leechers || 0,
    completed: merged.completed || 0,
    seedersMax: merged.seedersMax || 0,
    seedersMedian: merged.seedersMedian || 0,
    peers: merged.peers || 0,
    dhtSeeds: merged.dhtSeeds || 0,
    peerEstimate: merged.peerEstimate || 0,
    estimate: !!merged.estimate,
    noTracker: !!merged.noTracker,
    samples: merged.samples || 0,
    measuredAt: merged.measuredAt || 0,
    cached: !!cached,
  };
  // Additive estimate provenance: present only when bitmagnet counts were applied to this answer.
  if (merged.source) {
    out.source = merged.source;
    if (typeof merged.ageMs === 'number' && isFinite(merged.ageMs)) out.ageMs = merged.ageMs;
  }
  return out;
}

function fromCache(row) {
  return publicItem(row.infohash, {
    verified: !!row.live,
    live: !!row.live,
    seeders: row.seeders || 0,
    leechers: row.leechers || 0,
    completed: row.completed || 0,
    seedersMax: row.seedersMax || 0,
    seedersMedian: row.seedersMedian || 0,
    peers: row.peers || 0,
    dhtSeeds: row.dhtSeeds || 0,
    peerEstimate: row.peerEstimate || 0,
    estimate: !!row.estimate,
    noTracker: !row.trackerKey,
    samples: row.samples || 0,
    measuredAt: row.measuredAt || 0,
  }, true);
}

async function scrapeJobs(jobs, opts) {
  const deadline = opts.deadline;
  const gate = opts.gate;
  const timeoutMs = opts.timeoutMs;
  const samples = Object.create(null);
  let next = 0;
  const retry = [];
  function claim() {
    if (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      return job;
    }
    if (retry.length) return retry.shift();
    return null;
  }
  async function worker() {
    while (Date.now() < deadline) {
      const job = claim();
      if (!job) return;
      const isUdp = job.kind === 'udp';
      const now = Date.now();
      // UDP scrapes a single host, so it is gated here. HTTP gates every contacted host inside the
      // transport (each redirect hop included): a redirect target is a different host and must not
      // bypass the per-host gap or the shared request-window budget. A gate refusal there is a miss.
      if (isUdp && !gate.take(job.host, now)) {
        job.tries = (job.tries || 0) + 1;
        if (job.tries <= 8 && Date.now() < deadline) retry.push(job);
        await delay(Math.min(80, Math.max(0, deadline - Date.now())));
        continue;
      }
      const left = deadline - Date.now();
      const budget = left < timeoutMs ? left : timeoutMs;
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = null;
      try {
        if (budget < 200) continue;
        if (ac) timer = setTimeout(() => ac.abort(), budget);
        const signal = ac ? ac.signal : undefined;
        const sample = await Promise.race([
          isUdp
            ? opts.transport.udp(job.host, job.port, job.hash, budget, { signal: signal })
            : opts.transport.http(job.url, job.hash, budget, { signal: signal, gate: gate }),
          delay(budget).then(() => null),
        ]);
        if (sample && capCount(sample.seeders) !== null && capCount(sample.leechers) !== null) {
          if (!samples[job.hash]) samples[job.hash] = [];
          const rec = { seeders: sample.seeders, leechers: sample.leechers };
          if (capCount(sample.completed) !== null) rec.completed = sample.completed;
          samples[job.hash].push(rec);
        }
      } catch (e) {
        // a tracker miss is not a failure of the batch
      } finally {
        if (timer) clearTimeout(timer);
        if (ac) ac.abort();
        if (isUdp) gate.release();
      }
    }
  }
  const n = Math.max(1, gate.maxInFlight || 1);
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return samples;
}

/**
 * DHT for the given hashes, beside the scrapes. Lookups run with a capped concurrency inside one
 * shared deadline; each hash races the time left, so a slow sidecar cannot hang the batch.
 * Returns a map hash -> dhtSample (zeros for a hash that did not answer in budget). The sidecar
 * serves one lookup at a time and rate-limits the rest, so most fan-out resolves to zeros here.
 */
async function runDhtBatch(dht, hashes, deadline, cap) {
  const out = Object.create(null);
  let next = 0;
  async function worker() {
    while (next < hashes.length) {
      const hash = hashes[next];
      next += 1;
      const left = deadline - Date.now();
      if (left <= 0) {
        out[hash] = dhtSample(0);
        continue;
      }
      out[hash] = await Promise.race([
        Promise.resolve()
          .then(() => dht(hash))
          .then((n) => dhtSample(n))
          .catch(() => dhtSample(0)),
        delay(left).then(() => dhtSample(0)),
      ]);
    }
  }
  const n = Math.max(1, Math.min(cap, hashes.length));
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/**
 * Cache hits return at once. The rest are scraped until the deadline. DHT covers every stale hash
 * with no tracker address beside the scrapes (capped concurrency, one shared budget), merged per
 * hash; when all carry trackers the first stale hash is asked. The answer keeps the request order.
 * `force` scrapes even a fresh row: the background refresh asks at half the TTL, when the endpoint
 * would still answer from the cache. The gate and the deadline apply the same way. An optional
 * `bitmagnet` source (fetchCounts shape) adds estimate counts to the answer for hashes with no
 * tracker measurement; it never writes to the cache and never sets live/verified.
 */
export async function runSeedCheck(opts) {
  const o = opts || {};
  const nowFn = o.now || (() => Date.now());
  const now = nowFn();
  const deadlineMs = o.deadlineMs || SEED_BATCH_DEADLINE_MS;
  const items = Array.isArray(o.items) ? o.items.slice(0, SEED_TOP_N) : [];
  const cache = o.cache;
  const gate = o.gate || createTrackerGate();
  const transport = o.transport || { http: async () => null, udp: async () => null };
  const wanted = items.map((it) => ({ infohash: it.infohash, trackerKey: trackerKey(it) }));
  const cachedRows = cache ? await cache.get(wanted) : [];
  const byId = Object.create(null);
  for (let i = 0; i < cachedRows.length; i++) byId[probeKey(cachedRows[i].infohash, cachedRows[i].trackerKey)] = cachedRows[i];
  const fresh = [];
  const stale = [];
  for (let i = 0; i < wanted.length; i++) {
    const row = byId[probeKey(wanted[i].infohash, wanted[i].trackerKey)];
    if (!o.force && row && cacheFresh(row, now)) fresh.push(wanted[i]);
    else stale.push(items[i]);
  }
  if (cache && fresh.length) await cache.touch(fresh, now);
  // First tracker of every hash, then the second, so the window budget covers more hashes.
  const planned = stale.map((it) => trackerJobs(it));
  const jobs = [];
  for (let wave = 0; wave < SEED_MAX_TRACKERS; wave++) {
    for (let i = 0; i < planned.length; i++) if (planned[i][wave]) jobs.push(planned[i][wave]);
  }
  // DHT covers every stale hash with no tracker address, not just one: those rows have nothing else
  // to show, and phase 1 asked only a single hash per batch. A hash that carries trackers already
  // has a verified scrape, so it is not asked here (the sidecar serves one lookup at a time). When
  // every hash carries trackers, the first stale hash is asked, as in phase 1. The shared budget
  // starts now and runs beside the scrapes. dhtWaitMs / dhtConcurrency are injectable for tests.
  const dhtHashes = [];
  for (let i = 0; i < stale.length; i++) {
    if (!trackerJobs(stale[i]).length) dhtHashes.push(stale[i].infohash);
  }
  if (!dhtHashes.length && stale.length) dhtHashes.push(stale[0].infohash);
  const dhtWaitMs = o.dhtWaitMs || DHT_WAIT_MS;
  const dhtConcurrency = o.dhtConcurrency || DHT_MAX_IN_FLIGHT;
  const dhtTask = o.dht && dhtHashes.length
    ? runDhtBatch(o.dht, dhtHashes, Date.now() + dhtWaitMs, dhtConcurrency)
    : Promise.resolve(Object.create(null));
  const samples = await scrapeJobs(jobs, {
    deadline: now + deadlineMs,
    gate,
    timeoutMs: o.timeoutMs || SEED_TRACKER_TIMEOUT_MS,
    transport,
  });
  const dhtByHash = await dhtTask;
  let dhtUseful = 0;
  const measuredAt = nowFn();
  const saved = [];
  const measured = Object.create(null);
  for (let i = 0; i < stale.length; i++) {
    const hash = stale[i].infohash;
    const dhtHit = dhtByHash[hash] || dhtSample(0);
    if (dhtHit.peers > 0 || dhtHit.estimate || dhtHit.dhtSeeds > 0) dhtUseful += 1;
    const merged = mergeMeasurements(samples[hash] || [], dhtHit, measuredAt);
    merged.noTracker = trackerJobs(stale[i]).length === 0;
    measured[hash] = merged;
    // A forced refresh with no tracker answer must not erase a working measurement: the stored
    // row keeps its counts, live and measured_at. A real zero (samples > 0, a dead torrent) saves.
    // The endpoint never forces, so a miss there still records the 10-minute TTL row as before.
    // The attempt is stamped either way: selection backs off this row and takes another hash next tick.
    if (o.force && merged.samples === 0) {
      if (cache && typeof cache.noteRefresh === 'function') {
        await cache.noteRefresh([{ infohash: hash, trackerKey: trackerKey(stale[i]) }], measuredAt);
      }
      continue;
    }
    saved.push({
      infohash: hash,
      trackerKey: trackerKey(stale[i]),
      seeders: merged.seeders,
      leechers: merged.leechers,
      completed: merged.completed,
      seedersMax: merged.seedersMax,
      seedersMedian: merged.seedersMedian,
      peers: merged.peers,
      dhtSeeds: merged.dhtSeeds,
      peerEstimate: merged.peerEstimate,
      estimate: merged.estimate,
      samples: merged.samples,
      measuredAt: merged.measuredAt,
      live: merged.live,
      // Credential-free announce addresses for the refresh: standard path only, no query, no passkey,
      // and only when they rebuild this row's tracker key. Never logged.
      trackers: storedTrackers(stale[i]),
      refreshedAt: o.force ? merged.measuredAt : undefined,
    });
  }
  if (cache && saved.length) await cache.save(saved);
  const itemsOut = [];
  let live = 0;
  for (let i = 0; i < items.length; i++) {
    const hash = items[i].infohash;
    const id = probeKey(hash, trackerKey(items[i]));
    if (fresh.some((k) => probeKey(k.infohash, k.trackerKey) === id)) {
      const row = fromCache(byId[id]);
      if (row.live) live += 1;
      itemsOut.push(row);
    } else {
      const merged = measured[hash] || mergeMeasurements([], 0, measuredAt);
      if (merged.live) live += 1;
      itemsOut.push(publicItem(hash, merged, false));
    }
  }
  // bitmagnet estimates for the hashes left without a tracker measurement (samples = 0): the
  // tracker-less magnets, a dead tracker's miss, and cached miss rows. One batch, after the
  // scrapes and DHT. The merge is response-time only - nothing here is saved, so the estimates
  // never enter seed_probes, the background selection, or the verified/live flags. A stale or
  // absent bitmagnet row, a disabled source, and any source error all keep the previous answer.
  let bmApplied = 0;
  if (o.bitmagnet && typeof o.bitmagnet.fetchCounts === 'function') {
    const bmWanted = [];
    const bmSeen = Object.create(null);
    for (let i = 0; i < itemsOut.length; i++) {
      const it = itemsOut[i];
      if (it.samples === 0 && !bmSeen[it.infohash]) {
        bmSeen[it.infohash] = 1;
        bmWanted.push(it.infohash);
      }
    }
    if (bmWanted.length) {
      let bmRows = new Map();
      try {
        bmRows = await o.bitmagnet.fetchCounts(bmWanted);
      } catch (e) {
        bmRows = new Map();
      }
      if (bmRows && typeof bmRows.get === 'function' && bmRows.size) {
        const bmNow = nowFn();
        for (let i = 0; i < itemsOut.length; i++) {
          const it = itemsOut[i];
          if (it.samples !== 0) continue;
          const row = bmRows.get(it.infohash);
          if (!row) continue;
          const merged = mergeBitmagnetCounts(it, row, { now: () => bmNow });
          if (merged.source !== 'bitmagnet') continue;
          itemsOut[i] = publicItem(it.infohash, merged, it.cached);
          bmApplied += 1;
        }
      }
    }
  }
  return {
    items: itemsOut,
    stats: { asked: items.length, cache: fresh.length, live, dht: dhtUseful, bitmagnet: bmApplied },
  };
}
