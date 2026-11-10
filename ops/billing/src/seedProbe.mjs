// Fresh seeder counts for the top search rows. The app sends infohashes and announce URLs.
// This process scrapes those trackers (HTTP BEP 48, UDP BEP 15) from the NUC address, with a
// shared cap so one search cannot stampede a tracker. DHT is one extra lookup per batch when the
// sidecar is configured: peers are not seeders, they only mark a swarm that scrape missed.
// A background refresh of popular hashes is not here. Next step: one hash a minute, same gate,
// only when hits are high and the row is past half its TTL.
import { isIP } from 'node:net';
import { isPublicAddress } from './monitorHttp.mjs';

export const SEED_TOP_N = 30;
export const SEED_MAX_TRACKERS = 2;
export const SEED_TRACKER_TIMEOUT_MS = 1200;
export const SEED_BATCH_DEADLINE_MS = 4000;
export const SEED_MAX_IN_FLIGHT = 6;
export const SEED_PER_HOST_GAP_MS = 500;
export const SEED_WINDOW_MS = 10 * 1000;
export const SEED_WINDOW_MAX = 24;
export const SEED_DEVICE_MAX = 8;
export const SEED_DEVICE_WINDOW_MS = 60 * 1000;
export const TTL_POPULAR_MS = 20 * 60 * 1000;
export const TTL_RARE_MS = 4 * 60 * 60 * 1000;
export const TTL_MISS_MS = 10 * 60 * 1000;
export const POPULAR_SEEDS = 15;
export const POPULAR_HITS = 3;
export const COUNT_CAP = 1000000;
const DHT_WAIT_MS = 1500;

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
  return { seeders, leechers };
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

/**
 * Chosen seeders: the median when two or more trackers answered, otherwise the max.
 * Leechers come from the sample closest to that choice. DHT peers stay a separate field.
 */
export function mergeMeasurements(samples, dhtPeers, now) {
  const list = Array.isArray(samples) ? samples.filter((s) => s && capCount(s.seeders) !== null && capCount(s.leechers) !== null) : [];
  const seeds = list.map((s) => s.seeders);
  const seedersMax = seeds.length ? Math.max.apply(null, seeds) : 0;
  const seedersMedian = seeds.length ? median(seeds) : 0;
  const chosen = seeds.length >= 2 ? seedersMedian : seedersMax;
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
  const peers = capCount(dhtPeers) || 0;
  const live = list.length > 0;
  return {
    seeders: chosen,
    leechers,
    seedersMax,
    seedersMedian,
    peers,
    samples: list.length,
    live,
    verified: live || peers > 0,
    measuredAt: now,
  };
}

/** Popular rows (many seeds, or asked often) expire in 20 minutes. A rare live row lasts 4 hours. A miss lasts 10 minutes. */
export function ttlMs(row) {
  if (!row || (!row.live && !(row.peers > 0))) return TTL_MISS_MS;
  if ((row.seeders || 0) >= POPULAR_SEEDS || (row.hits || 0) >= POPULAR_HITS) return TTL_POPULAR_MS;
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
        if (row) out.push({ ...row });
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
          seedersMax: row.seedersMax,
          seedersMedian: row.seedersMedian,
          peers: row.peers,
          samples: row.samples,
          measuredAt: row.measuredAt,
          live: !!row.live,
          hits: (prev ? prev.hits : 0) + 1,
          lastHitAt: row.measuredAt,
        });
      }
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return {
    infohash: hash,
    verified: !!merged.verified,
    live: !!merged.live,
    seeders: merged.seeders || 0,
    leechers: merged.leechers || 0,
    seedersMax: merged.seedersMax || 0,
    seedersMedian: merged.seedersMedian || 0,
    peers: merged.peers || 0,
    samples: merged.samples || 0,
    measuredAt: merged.measuredAt || 0,
    cached: !!cached,
  };
}

function fromCache(row) {
  return publicItem(row.infohash, {
    verified: !!row.live || (row.peers || 0) > 0,
    live: !!row.live,
    seeders: row.seeders || 0,
    leechers: row.leechers || 0,
    seedersMax: row.seedersMax || 0,
    seedersMedian: row.seedersMedian || 0,
    peers: row.peers || 0,
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
      const now = Date.now();
      if (!gate.take(job.host, now)) {
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
          job.kind === 'udp'
            ? opts.transport.udp(job.host, job.port, job.hash, budget, { signal: signal })
            : opts.transport.http(job.url, job.hash, budget, { signal: signal }),
          delay(budget).then(() => null),
        ]);
        if (sample && capCount(sample.seeders) !== null && capCount(sample.leechers) !== null) {
          if (!samples[job.hash]) samples[job.hash] = [];
          samples[job.hash].push({ seeders: sample.seeders, leechers: sample.leechers });
        }
      } catch (e) {
        // a tracker miss is not a failure of the batch
      } finally {
        if (timer) clearTimeout(timer);
        if (ac) ac.abort();
        gate.release();
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
 * Cache hits return at once. The rest are scraped until the deadline. One DHT lookup runs beside
 * the scrapes for the first hash that was not cached. The answer keeps the request order.
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
    if (row && cacheFresh(row, now)) fresh.push(wanted[i]);
    else stale.push(items[i]);
  }
  if (cache && fresh.length) await cache.touch(fresh, now);
  // First tracker of every hash, then the second, so the window budget covers more hashes.
  const planned = stale.map((it) => trackerJobs(it));
  const jobs = [];
  for (let wave = 0; wave < SEED_MAX_TRACKERS; wave++) {
    for (let i = 0; i < planned.length; i++) if (planned[i][wave]) jobs.push(planned[i][wave]);
  }
  let dhtPeers = 0;
  let dhtHash = '';
  const dhtTarget = stale.length ? stale[0].infohash : '';
  const dhtTask = o.dht && dhtTarget
    ? Promise.race([
      Promise.resolve()
        .then(() => o.dht(dhtTarget))
        .then((n) => (capCount(n) === null ? 0 : capCount(n)))
        .catch(() => 0),
      delay(DHT_WAIT_MS).then(() => 0),
    ])
    : Promise.resolve(0);
  const samples = await scrapeJobs(jobs, {
    deadline: now + deadlineMs,
    gate,
    timeoutMs: o.timeoutMs || SEED_TRACKER_TIMEOUT_MS,
    transport,
  });
  if (dhtTarget) {
    dhtPeers = await dhtTask;
    if (dhtPeers > 0) dhtHash = dhtTarget;
  }
  const measuredAt = nowFn();
  const saved = [];
  const measured = Object.create(null);
  for (let i = 0; i < stale.length; i++) {
    const hash = stale[i].infohash;
    const merged = mergeMeasurements(samples[hash] || [], hash === dhtHash ? dhtPeers : 0, measuredAt);
    measured[hash] = merged;
    saved.push({
      infohash: hash,
      trackerKey: trackerKey(stale[i]),
      seeders: merged.seeders,
      leechers: merged.leechers,
      seedersMax: merged.seedersMax,
      seedersMedian: merged.seedersMedian,
      peers: merged.peers,
      samples: merged.samples,
      measuredAt: merged.measuredAt,
      live: merged.live,
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
  return {
    items: itemsOut,
    stats: { asked: items.length, cache: fresh.length, live, dht: dhtHash ? 1 : 0 },
  };
}
