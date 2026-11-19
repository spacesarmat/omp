// One import of remembered data that still lives on TorrServer (torrent `data.omp`) and in
// the local progress map. A second call does nothing. A newer local row is never replaced.
import { parseData, nameLocked, rawReleaseOf, watchesNewEpisodes, watchesBetterQuality } from '../lib/journal';
import { deviceMigrated, deviceRecords, markDeviceMigrated, putDeviceRecords } from './deviceDb';
import type { SyncRecord } from './syncMerge';

export interface MigrateTorrent {
  hash: string;
  title?: string;
  data?: string;
}

function row(id: string, kind: string, key: string, body: { [k: string]: unknown }, updatedAt: number): SyncRecord {
  return { id, kind, key, body, updatedAt: updatedAt > 0 ? updatedAt : 1, deviceId: 'migrate', deleted: false };
}

/** Records carried by one torrent's omp bag. */
export function recordsFromTorrent(t: MigrateTorrent): SyncRecord[] {
  const hash = (t.hash || '').toLowerCase();
  if (!hash) return [];
  const parsed = parseData(t.data);
  if (!parsed) return [];
  const out: SyncRecord[] = [];
  for (let i = 0; i < parsed.journal.length; i++) {
    const e = parsed.journal[i];
    out.push(row('journal:' + hash + ':' + e.f + ':' + e.src, 'journal', hash, { f: e.f, t: e.t, d: e.d, at: e.at, src: e.src, name: e.name || '' }, e.at));
  }
  if (parsed.skip) out.push(row('skip:' + hash, 'skip', hash, parsed.skip as unknown as { [k: string]: unknown }, 1));
  const omp = parsed.obj.omp as { [k: string]: unknown } | undefined;
  if (omp && omp.a && typeof omp.a === 'object') out.push(row('audio:' + hash, 'audio', hash, omp.a as { [k: string]: unknown }, 1));
  if (!watchesNewEpisodes(t.data)) out.push(row('watch:' + hash, 'watch', hash, { newEpisodes: false }, 1));
  if (!watchesBetterQuality(t.data)) out.push(row('quality:' + hash, 'quality', hash, { better: false }, 1));
  if (nameLocked(t.data) || rawReleaseOf(t.data)) {
    out.push(row('title:' + hash, 'title', hash, { title: t.title || '', raw: rawReleaseOf(t.data), locked: nameLocked(t.data) }, 1));
  }
  return out;
}

export function recordsFromProgress(map: { [k: string]: { time: number; duration: number; updated: number } }): SyncRecord[] {
  const out: SyncRecord[] = [];
  const keys = Object.keys(map || {});
  for (let i = 0; i < keys.length; i++) {
    const p = map[keys[i]];
    if (!p || typeof p.updated !== 'number') continue;
    out.push(row('progress:' + keys[i], 'progress', keys[i], { time: p.time, duration: p.duration }, p.updated));
  }
  return out;
}

/**
 * Import once. `fromServer` is false when the list was not read from TorrServer (offline start):
 * the flag stays clear so a later connection still imports.
 */
export function migrateRemembered(torrents: MigrateTorrent[] | null, progress: { [k: string]: { time: number; duration: number; updated: number } }, fromServer: boolean): boolean {
  if (deviceMigrated()) return false;
  const incoming: SyncRecord[] = recordsFromProgress(progress || {});
  const list = torrents || [];
  for (let i = 0; i < list.length; i++) {
    const part = recordsFromTorrent(list[i]);
    for (let j = 0; j < part.length; j++) incoming.push(part[j]);
  }
  if (incoming.length) putDeviceRecords(incoming);
  if (fromServer) markDeviceMigrated();
  return incoming.length > 0 || fromServer;
}

/** True when a local row is still present after a second import of the same torrent. */
export function keptCount(): number {
  return deviceRecords().filter((r) => !r.deleted).length;
}
