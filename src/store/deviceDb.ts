// Remembered data on this device: progress, journal, skip, voice, titles, TMDB match, monitoring.
// localStorage is the copy every screen reads. IndexedDB, when the browser has it, keeps the same
// rows so a wiped localStorage can be filled again. No TorrServer is required to read or write.
import { loadJson, saveJson, isObject } from './storage';
import { mergeRecords, type SyncRecord } from './syncMerge';
import { hydrateV2Projection, mirrorV2Bag } from './deviceV2Db';

const KEY = 'omp.deviceDb';
const DB = 'omp-device';
const STORE = 'records';

interface Bag {
  records: { [id: string]: SyncRecord };
  migrated: boolean;
  syncOn: boolean;
  lastSync: number;
  lastSeq: number;
  accountId: string;
  syncEpoch: number;
  /** updatedAt last accepted by the server, so the same row is not uploaded again. */
  sent: { [id: string]: number };
  /** Last failed sync: offline, denied, error. Empty after a success. */
  lastError: string;
}

function empty(): Bag {
  return { records: {}, migrated: false, syncOn: true, lastSync: 0, lastSeq: 0, accountId: '', syncEpoch: 0, sent: {}, lastError: '' };
}

function read(): Bag {
  const raw = loadJson<{ [k: string]: unknown }>(KEY, {}, isObject);
  const records = isObject(raw.records) ? (raw.records as { [id: string]: SyncRecord }) : {};
  return {
    records,
    migrated: raw.migrated === true,
    syncOn: raw.syncOn !== false,
    lastSync: typeof raw.lastSync === 'number' ? raw.lastSync : 0,
    lastSeq: typeof raw.lastSeq === 'number' ? raw.lastSeq : 0,
    accountId: typeof raw.accountId === 'string' ? raw.accountId : '',
    syncEpoch: typeof raw.syncEpoch === 'number' ? raw.syncEpoch : 0,
    sent: sentOf(raw.sent),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
  };
}

function sentOf(raw: unknown): { [id: string]: number } {
  if (!isObject(raw)) return {};
  const out: { [id: string]: number } = {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    const n = raw[keys[i]];
    if (typeof n === 'number') out[keys[i]] = n;
  }
  return out;
}

/** `quiet` stores bookkeeping (cursor, account, ack) without scheduling another sync. */
function write(bag: Bag, quiet: boolean): void {
  writes++;
  saveJson(KEY, bag);
  mirrorIndexed(bag);
  void mirrorV2Bag(Object.keys(bag.records).map((id) => bag.records[id])).catch(() => undefined);
  if (!quiet) afterWrite();
}

export function deviceRecords(): SyncRecord[] {
  const bag = read();
  return Object.keys(bag.records).map((id) => bag.records[id]);
}

export function putDeviceRecords(rows: SyncRecord[], quiet?: boolean): SyncRecord[] {
  const bag = read();
  const list = Object.keys(bag.records).map((id) => bag.records[id]);
  const merged = mergeRecords(list, rows);
  const next: { [id: string]: SyncRecord } = {};
  for (let i = 0; i < merged.length; i++) {
    const row = merged[i];
    const prev = bag.records[row.id];
    if (!prev || prev.updatedAt !== row.updatedAt || prev.deviceId !== row.deviceId || !!prev.deleted !== !!row.deleted) delete bag.sent[row.id];
    next[row.id] = row;
  }
  bag.records = next;
  write(bag, quiet === true);
  return merged;
}

/** Rows not yet accepted at this updatedAt. `epoch` hides the previous account. */
export function unsentRecords(epoch: number): SyncRecord[] {
  const bag = read();
  const ids = Object.keys(bag.records);
  const out: SyncRecord[] = [];
  for (let i = 0; i < ids.length; i++) {
    const row = bag.records[ids[i]];
    if (row.updatedAt < epoch) continue;
    if (bag.sent[row.id] === row.updatedAt) continue;
    out.push(row);
  }
  return out;
}

/** Remember a batch the server accepted. A newer local edit of the same id is left unsent. */
export function ackSent(rows: SyncRecord[]): void {
  const bag = read();
  for (let i = 0; i < rows.length; i++) {
    const cur = bag.records[rows[i].id];
    if (cur && cur.updatedAt === rows[i].updatedAt && cur.deviceId === rows[i].deviceId) bag.sent[rows[i].id] = cur.updatedAt;
  }
  write(bag, true);
}

export function deviceMigrated(): boolean {
  return read().migrated;
}

export function markDeviceMigrated(): void {
  const bag = read();
  bag.migrated = true;
  write(bag, true);
}

export function syncEnabled(): boolean {
  return read().syncOn;
}

export function setSyncEnabled(on: boolean): void {
  const bag = read();
  const changed = bag.syncOn !== on;
  bag.syncOn = on;
  write(bag, true);
  if (changed) syncStateListener(on);
}

export function lastSyncAt(): number {
  return read().lastSync;
}

export function markSynced(at: number): void {
  const bag = read();
  bag.lastSync = at;
  bag.lastError = '';
  write(bag, true);
}

export function lastSyncError(): string {
  return read().lastError;
}

export function markSyncError(code: string): void {
  const bag = read();
  bag.lastError = code;
  write(bag, true);
}

export function syncCursor(): number {
  return read().lastSeq;
}

export function setSyncCursor(seq: number): void {
  const bag = read();
  if (seq <= bag.lastSeq) return;
  bag.lastSeq = seq;
  write(bag, true);
}

/** Another billing account must not upload this device's earlier rows. Local rows stay. */
export function noteSyncAccount(id: string): number {
  const bag = read();
  let changed = false;
  if (bag.accountId && id && bag.accountId !== id) {
    bag.syncEpoch = Date.now();
    bag.lastSeq = 0;
    bag.sent = {};
    changed = true;
  }
  if (id && bag.accountId !== id) {
    bag.accountId = id;
    changed = true;
  }
  if (changed) write(bag, true);
  return bag.syncEpoch;
}

export function syncEpoch(): number {
  return read().syncEpoch;
}

export function resetDeviceDb(): void {
  write(empty(), true);
}

let afterWrite: () => void = () => undefined;
let syncStateListener: (on: boolean) => void = () => undefined;
let hydrated = false;
let writes = 0;

/** The sync client registers here so a local write can upload without a import cycle. */
export function onDeviceWrite(fn: () => void): void {
  afterWrite = fn;
}

export function onSyncStateChange(fn: (on: boolean) => void): () => void {
  syncStateListener = fn;
  return () => { syncStateListener = () => undefined; };
}

function mirrorIndexed(bag: Bag): void {
  if (!hydrated) return;
  const idb = typeof indexedDB === 'undefined' ? null : indexedDB;
  if (!idb) return;
  try {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bag, 'bag');
      tx.oncomplete = () => db.close();
    };
  } catch (e) {
    /* IndexedDB is optional */
  }
}

/** Fill localStorage from IndexedDB when the page store is empty and IndexedDB has a bag. */
export function hydrateDeviceDb(done: () => void): void {
  const finish = () => {
    void hydrateV2Projection(deviceRecords()).then((rows) => {
      if (rows.length) putDeviceRecords(rows, true);
      done();
    }, () => done());
  };
  const idb = typeof indexedDB === 'undefined' ? null : indexedDB;
  if (!idb) {
    hydrated = true;
    done();
    return;
  }
  try {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onerror = () => {
      hydrated = true;
      finish();
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('bag');
      req.onsuccess = () => {
        const bag = req.result as Bag | undefined;
        if (writes === 0 && bag && bag.records && !Object.keys(read().records).length) saveJson(KEY, bag);
        hydrated = true;
        if (writes > 0) mirrorIndexed(read());
        db.close();
        finish();
      };
      req.onerror = () => {
        hydrated = true;
        db.close();
        finish();
      };
    };
  } catch (e) {
    hydrated = true;
    finish();
  }
}

// App startup calls hydrateDeviceDb. Tests do not, so a late IndexedDB read cannot overwrite a fixture.
