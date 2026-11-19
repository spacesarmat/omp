// Persistent DHT routing table so a restarted/idle node starts warm instead of bootstrapping from
// scratch through filtered UDP ports. Stores only DHT node ip:port:id - no personal data, no peers.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_NODES = 200;
const ID_HEX = /^[0-9a-f]{40}$/;

/** Valid, deduped, capped node list. Bad ids/hosts/ports are dropped, never thrown. */
export function sanitizeNodes(list, max = MAX_NODES) {
  const out = [];
  const seen = Object.create(null);
  for (const n of Array.isArray(list) ? list : []) {
    if (!n || typeof n !== 'object') continue;
    const id = String(n.id || '').toLowerCase();
    const host = String(n.host || '').trim().toLowerCase();
    const port = Number(n.port);
    if (!ID_HEX.test(id) || !host || host.length > 64 || /[\s/\\]/.test(host)) continue;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = host + ':' + port;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ id, host, port });
    if (out.length >= max) break;
  }
  return out;
}

export function loadTable(file) {
  if (!file) return [];
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return sanitizeNodes(j && j.nodes);
  } catch (e) {
    return [];
  }
}

/** Atomic write (tmp + rename) so a crash mid-save never leaves a torn table. */
export function saveTable(file, nodes) {
  if (!file) return;
  const clean = sanitizeNodes(nodes);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ nodes: clean }));
  renameSync(tmp, file);
}

/** Snapshot the live routing table as plain {id(hex),host,port} rows. */
export function exportNodes(dht) {
  const table = dht && dht.nodes;
  if (!table || typeof table.toArray !== 'function') return [];
  return table.toArray().map((n) => ({
    id: Buffer.isBuffer(n.id) ? n.id.toString('hex') : String(n.id || ''),
    host: n.host,
    port: n.port,
  }));
}
