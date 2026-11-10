// Popular-release cache nodes. The feature stays off until settings.cacheNodesEnabled is true.
// Node tokens are random, shown once, and stored only as sha256. Nothing here talks to a node URL.
import { randomBytes } from 'node:crypto';
import { randomId, sameHex, sha256 } from './crypto.mjs';

export const HEARTBEAT_FRESH_MS = 90 * 1000;
export const REMOVED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_PREFIX_MB = 512;
export const POPULAR_LIMIT = 20;
export const POPULAR_MIN_SCORE = 3;
export const POPULAR_INTERVAL_MS = 15 * 60 * 1000;
const DUMMY_HASH = sha256('cn_missing');
const INFOHASH = /^[a-f0-9]{40}$/;

export function cacheEnabled(settings) {
  return !!(settings && settings.cacheNodesEnabled === true);
}

function whole(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function validPrefixMb(v) {
  return whole(v, 0, 102400) !== null;
}

export function validPrefixPercent(v) {
  return whole(v, 0, 100) !== null;
}

/** Megabytes kept from the start of a release. A stored 0 still means the default 512. */
export function prefixMbOf(settings) {
  const n = whole(settings && settings.cachePrefixMb, 0, 102400);
  return n === null ? DEFAULT_PREFIX_MB : n;
}

export function prefixPercentOf(settings) {
  const n = whole(settings && settings.cachePrefixPercent, 0, 100);
  return n === null ? 0 : n;
}

export function newNodeToken() {
  return 'cn_' + randomBytes(32).toString('hex');
}

export function tokenHash(token) {
  return sha256(String(token || ''));
}

/** Bearer value when it is a node token. Anything else is empty. */
export function nodeTokenFromHeader(header) {
  const raw = String(header || '');
  if (raw.slice(0, 7).toLowerCase() !== 'bearer ') return '';
  const token = raw.slice(7).trim();
  return /^cn_[a-f0-9]{64}$/.test(token) ? token : '';
}

function num(v) {
  const n = Math.floor(Number(v) || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 2 ** 52 ? 2 ** 52 : n;
}

export function clipText(v, max) {
  return String(v || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function blockedHost(host) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.internal')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const p = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (p.some((n) => n > 255)) return true;
    if (p[0] === 0 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (h.indexOf(':') >= 0) {
    if (h === '::1' || h === '::') return true;
    if (h.indexOf('fe80:') === 0 || h.indexOf('ff') === 0) return true;
    const mapped = /::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (mapped) return blockedHost(mapped[1]);
    return false;
  }
  // A single label is a docker or local name. The app must get a real host.
  if (h.indexOf('.') < 0) return true;
  return false;
}

/** Public origin of a cache node, or '' when the address must not be stored or sent to phones. */
export function safeNodeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';
  if (u.search || u.hash) return '';
  if (u.pathname !== '/' && u.pathname !== '') return '';
  if (blockedHost(u.hostname)) return '';
  return u.origin;
}

function safeTracker(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch (e) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.pathname.length > 80) return false;
  return !blockedHost(u.hostname);
}

/**
 * Magnet stored for a node. Empty input becomes a DHT magnet for this infohash.
 * A private tracker query, a passkey, or a different hash is rejected ('').
 */
export function cleanMagnet(raw, infohash) {
  const hash = String(infohash || '').toLowerCase();
  if (!INFOHASH.test(hash)) return '';
  const fallback = 'magnet:?xt=urn:btih:' + hash;
  const text = String(raw || '').trim();
  if (!text) return fallback;
  if (text.length > 1500) return '';
  if (/passkey|authkey|apikey|password|secret/i.test(text)) return '';
  let u;
  try {
    u = new URL(text);
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'magnet:') return '';
  if ((u.searchParams.get('xt') || '').toLowerCase() !== 'urn:btih:' + hash) return '';
  let extra = false;
  u.searchParams.forEach((value, key) => {
    const name = String(key || '').toLowerCase();
    if (name !== 'xt' && name !== 'dn' && name !== 'tr') extra = true;
  });
  if (extra) return '';
  const trackers = u.searchParams.getAll('tr');
  for (let i = 0; i < trackers.length; i++) {
    if (!safeTracker(trackers[i])) return '';
  }
  let out = fallback;
  const dn = clipText(u.searchParams.get('dn') || '', 200);
  if (dn) out += '&dn=' + encodeURIComponent(dn);
  for (let i = 0; i < trackers.length; i++) out += '&tr=' + encodeURIComponent(trackers[i]);
  return out;
}

export function normalizeInfohash(raw) {
  const hash = String(raw || '').trim().toLowerCase();
  return INFOHASH.test(hash) ? hash : '';
}

/** Bytes the node should keep. Megabytes win. Percent applies when megabytes are 0 and the size is known. */
export function resolvePrefix(settings, node, sizeBytes) {
  const nodeMb = node && whole(node.prefixMb, 0, 102400);
  const nodePct = node && whole(node.prefixPercent, 0, 100);
  const mb = nodeMb > 0 ? nodeMb : prefixMbOf(settings);
  const percent = nodePct > 0 ? nodePct : prefixPercentOf(settings);
  if (mb > 0) return { prefixBytes: mb * 1024 * 1024, prefixPercent: 0, prefixMb: mb };
  const pct = percent > 0 ? percent : 5;
  const size = num(sizeBytes);
  const bytes = size > 0 ? Math.ceil((size * pct) / 100) : 512 * 1024 * 1024;
  return { prefixBytes: bytes, prefixPercent: pct, prefixMb: 0 };
}

export function scoreOf(row) {
  return num(row && row.plays) * 5 + num(row && row.searches) * 2 + Math.min(num(row && row.seeders), 200);
}

/**
 * Releases worth caching. A row with no seeders is skipped: search and play counts only
 * order releases that still have seeds. `skip[infohash]` drops a hash (already assigned).
 */
export function selectPopular(rows, opts) {
  const o = opts || {};
  const minScore = o.minScore === undefined ? POPULAR_MIN_SCORE : o.minScore;
  const limit = o.limit === undefined ? POPULAR_LIMIT : o.limit;
  const skip = o.skip || {};
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    if (d) return d;
    return String(a.infohash || '').localeCompare(String(b.infohash || ''));
  });
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const hash = normalizeInfohash(row && row.infohash);
    if (!hash || skip[hash]) continue;
    if (num(row.seeders) < 1) continue;
    const score = scoreOf(row);
    if (score < minScore) continue;
    out.push({
      infohash: hash,
      title: clipText(row.title, 300),
      searches: num(row.searches),
      plays: num(row.plays),
      seeders: num(row.seeders),
      sizeBytes: num(row.sizeBytes),
      score,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function reserveBytes(row) {
  const bytes = num(row && (row.prefixBytes || row.prefix_bytes));
  return bytes > 0 ? bytes : 512 * 1024 * 1024;
}

export function nodeOnline(node, now) {
  if (!node || node.status === 'disabled') return false;
  const at = num(node.lastHeartbeat !== undefined ? node.lastHeartbeat : node.last_heartbeat);
  if (!at) return false;
  return now - at <= HEARTBEAT_FRESH_MS;
}

/**
 * What the popularity job should write. Pinned and manual rows stay.
 * An offline node keeps its rows. A fresh auto row that fell out of the top is removed.
 */
export function planAssignments(input) {
  const now = num(input && input.now) || Date.now();
  const settings = (input && input.settings) || {};
  const nodes = (input && input.nodes) || [];
  const assignments = (input && input.assignments) || [];
  const picked = (input && input.picked) || [];
  const online = nodes.filter((n) => nodeOnline(n, now) && n.status !== 'disabled');
  const active = assignments.filter((a) => a.status !== 'removed');
  const byHash = {};
  for (let i = 0; i < active.length; i++) byHash[active[i].infohash] = active[i];
  const pickedSet = {};
  for (let i = 0; i < picked.length; i++) pickedSet[picked[i].infohash] = picked[i];
  const removedRecent = {};
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a.status === 'removed' && a.removedAt && now - a.removedAt < REMOVED_COOLDOWN_MS) removedRecent[a.infohash] = true;
  }
  const used = {};
  for (let i = 0; i < online.length; i++) used[online[i].id] = 0;
  for (let i = 0; i < active.length; i++) {
    if (used[active[i].nodeId] === undefined) continue;
    used[active[i].nodeId] += reserveBytes(active[i]);
  }
  const create = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    if (byHash[p.infohash] || removedRecent[p.infohash]) continue;
    const sample = resolvePrefix(settings, null, p.sizeBytes);
    const need = reserveBytes({ prefixBytes: sample.prefixBytes });
    let best = null;
    let bestFree = -1;
    for (let j = 0; j < online.length; j++) {
      const n = online[j];
      const cap = num(n.capacityBytes);
      if (cap <= 0) continue;
      const free = cap - (used[n.id] || 0);
      if (free < need || free <= bestFree) continue;
      best = n;
      bestFree = free;
    }
    if (!best) continue;
    const prefix = resolvePrefix(settings, best, p.sizeBytes);
    used[best.id] += need;
    create.push({
      id: randomId(),
      nodeId: best.id,
      infohash: p.infohash,
      title: p.title || '',
      sizeBytes: num(p.sizeBytes),
      prefixBytes: prefix.prefixBytes,
      prefixPercent: prefix.prefixPercent,
      score: p.score,
      magnet: cleanMagnet('', p.infohash),
    });
  }
  const onlineIds = {};
  for (let i = 0; i < online.length; i++) onlineIds[online[i].id] = true;
  const drop = [];
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (a.pinned || a.source === 'manual') continue;
    if (pickedSet[a.infohash]) continue;
    if (!onlineIds[a.nodeId]) continue;
    drop.push(a.id);
  }
  return { create, drop };
}

export function publicNode(row, now) {
  const at = now || Date.now();
  const disabled = row.status === 'disabled';
  let presence = 'offline';
  if (disabled) presence = 'disabled';
  else if (nodeOnline(row, at)) presence = 'online';
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    region: row.region || '',
    capacityBytes: num(row.capacityBytes),
    prefixMb: num(row.prefixMb),
    prefixPercent: num(row.prefixPercent),
    status: presence,
    disabled,
    hasToken: !!row.hasToken,
    lastHeartbeat: num(row.lastHeartbeat) || null,
    diskUsedBytes: num(row.diskUsedBytes),
    diskTotalBytes: num(row.diskTotalBytes),
    torrserverOk: row.torrserverOk === true,
    createdAt: num(row.createdAt),
  };
}

export function publicAssignment(row) {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.nodeName || '',
    infohash: row.infohash,
    title: row.title || '',
    sizeBytes: num(row.sizeBytes),
    prefixBytes: num(row.prefixBytes),
    prefixPercent: num(row.prefixPercent),
    status: row.status,
    pinned: row.pinned === true,
    source: row.source === 'manual' ? 'manual' : 'auto',
    score: num(row.score),
    error: row.error || '',
    updatedAt: num(row.updatedAt),
  };
}

/** Playback source for one infohash. Only a cached copy on a node that heartbeated recently. */
export function sourceFor(rows, infohash, now) {
  const hash = normalizeInfohash(infohash);
  if (!hash) return null;
  const at = now || Date.now();
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.infohash !== hash || row.status !== 'cached') continue;
    if (row.nodeStatus === 'disabled' || !row.hasToken) continue;
    if (!nodeOnline({ status: row.nodeStatus, lastHeartbeat: row.lastHeartbeat }, at)) continue;
    const url = safeNodeUrl(row.url);
    if (!url) continue;
    if (!best || num(row.lastHeartbeat) > num(best.lastHeartbeat)) best = row;
  }
  if (!best) return null;
  return {
    url: safeNodeUrl(best.url),
    infohash: hash,
    title: best.title || '',
    prefixBytes: num(best.prefixBytes),
  };
}

let lastPopularityAt = 0;

export function resetPopularityClock() {
  lastPopularityAt = 0;
}

export async function runPopularity(repo, settings, now) {
  if (!cacheEnabled(settings)) return { skipped: true, reason: 'disabled', created: 0, dropped: 0 };
  const at = now || Date.now();
  const interest = await repo.listInterest(500);
  const nodes = await repo.listNodes();
  const assignments = await repo.listAssignments(2000);
  const active = {};
  for (let i = 0; i < assignments.length; i++) {
    if (assignments[i].status !== 'removed') active[assignments[i].infohash] = true;
  }
  const picked = selectPopular(interest, { skip: {} });
  const plan = planAssignments({ nodes, assignments, picked, now: at, settings });
  for (let i = 0; i < plan.create.length; i++) {
    await repo.upsertAssignment(plan.create[i], at);
  }
  for (let i = 0; i < plan.drop.length; i++) await repo.dropAssignment(plan.drop[i], at);
  return { skipped: false, created: plan.create.length, dropped: plan.drop.length, considered: picked.length, active: Object.keys(active).length };
}

export async function maybeRunPopularity(repo, settings, now, force) {
  if (!cacheEnabled(settings)) return { skipped: true, reason: 'disabled', created: 0, dropped: 0 };
  const at = now || Date.now();
  if (!force && lastPopularityAt && at - lastPopularityAt < POPULAR_INTERVAL_MS) {
    return { skipped: true, reason: 'recent', created: 0, dropped: 0 };
  }
  lastPopularityAt = at;
  return runPopularity(repo, settings, at);
}

export function freshNodeId() {
  return randomId();
}

/** The node behind a bearer token, or null. The stored hash is not returned. */
export async function authenticateNode(repo, header) {
  const token = nodeTokenFromHeader(header);
  const hash = token ? tokenHash(token) : DUMMY_HASH;
  const row = token ? await repo.findByTokenHash(hash) : null;
  const ok = sameHex(hash, row && row.tokenHash ? row.tokenHash : DUMMY_HASH);
  if (!token || !row || !ok) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    region: row.region,
    capacityBytes: row.capacityBytes,
    status: row.status,
    lastHeartbeat: row.lastHeartbeat,
    hasToken: true,
    diskUsedBytes: row.diskUsedBytes,
    diskTotalBytes: row.diskTotalBytes,
    torrserverOk: row.torrserverOk,
    prefixMb: row.prefixMb,
    prefixPercent: row.prefixPercent,
    createdAt: row.createdAt,
  };
}
