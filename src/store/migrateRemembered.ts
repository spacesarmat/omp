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
  return { id, kind, key, body, updatedAt: updatedAt > 0 ? updatedAt : 1, deviceId: 'local', deleted: false };
}

/** Records carried by one torrent's omp bag. Undated fields use `now`, so a later edit wins. */
export function recordsFromTorrent(t: MigrateTorrent, now = 1): SyncRecord[] {
  const hash = (t.hash || '').toLowerCase();
  if (!hash) return [];
  const parsed = parseData(t.data);
  if (!parsed) return [];
  const out: SyncRecord[] = [];
  for (let i = 0; i < parsed.journal.length; i++) {
    const e = parsed.journal[i];
    out.push(row('journal:' + hash + ':' + e.f + ':' + e.src, 'journal', hash, { f: e.f, t: e.t, d: e.d, at: e.at, src: e.src, name: e.name || '' }, e.at));
  }
  if (parsed.skip) out.push(row('skip:' + hash, 'skip', hash, parsed.skip as unknown as { [k: string]: unknown }, now));
  const omp = parsed.obj.omp as { [k: string]: unknown } | undefined;
  if (omp && omp.a && typeof omp.a === 'object') out.push(row('audio:' + hash, 'audio', hash, omp.a as { [k: string]: unknown }, now));
  if (!watchesNewEpisodes(t.data)) out.push(row('watch:' + hash, 'watch', hash, { newEpisodes: false }, now));
  if (!watchesBetterQuality(t.data)) out.push(row('quality:' + hash, 'quality', hash, { better: false }, now));
  if (nameLocked(t.data) || rawReleaseOf(t.data)) {
    out.push(row('title:' + hash, 'title', hash, { title: t.title || '', raw: rawReleaseOf(t.data), locked: nameLocked(t.data) }, now));
  }
  return out;
}

/** A library edit. `drop` lists kinds this write removed on purpose. Other missing rows stay. */
export function recordsForEdit(t: MigrateTorrent, now: number, drop?: string[]): SyncRecord[] {
  const fresh = recordsFromTorrent(t, now);
  if (!drop || !drop.length) return fresh;
  const hash = (t.hash || '').toLowerCase();
  const have: { [id: string]: boolean } = {};
  for (let i = 0; i < fresh.length; i++) have[fresh[i].id] = true;
  const old = deviceRecords().filter((r) => r.key === hash && !r.deleted && drop.indexOf(r.kind) >= 0 && !have[r.id]);
  const tombs: SyncRecord[] = [];
  for (let i = 0; i < old.length; i++) {
    const at = now > old[i].updatedAt ? now : old[i].updatedAt + 1;
    tombs.push({ id: old[i].id, kind: old[i].kind, key: hash, body: {}, updatedAt: at, deviceId: 'local', deleted: true });
  }
  return fresh.concat(tombs);
}

export function recordsFromProgress(map: { [k: string]: { time: number; duration: number; updated: number; open?: boolean } }): SyncRecord[] {
  const out: SyncRecord[] = [];
  const keys = Object.keys(map || {});
  for (let i = 0; i < keys.length; i++) {
    const p = map[keys[i]];
    if (!p || typeof p.updated !== 'number') continue;
    const body: { [k: string]: unknown } = { time: p.time, duration: p.duration };
    if (p.open === true) body.open = true;
    out.push(row('progress:' + keys[i], 'progress', keys[i], body, p.updated));
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
