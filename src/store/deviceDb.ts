// Remembered data on this device: progress, journal, skip, voice, titles, TMDB match, monitoring.
// localStorage is the copy every screen reads. IndexedDB, when the browser has it, keeps the same
// rows so a wiped localStorage can be filled again. No TorrServer is required to read or write.
import { loadJson, saveJson, isObject } from './storage';
import { mergeRecords, type SyncRecord } from './syncMerge';

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
}

function empty(): Bag {
  return { records: {}, migrated: false, syncOn: true, lastSync: 0, lastSeq: 0, accountId: '', syncEpoch: 0 };
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
  };
}

function write(bag: Bag): void {
  writes++;
  saveJson(KEY, bag);
  mirrorIndexed(bag);
  afterWrite();
}

export function deviceRecords(): SyncRecord[] {
  const bag = read();
  return Object.keys(bag.records).map((id) => bag.records[id]);
}

export function putDeviceRecords(rows: SyncRecord[]): SyncRecord[] {
  const bag = read();
  const list = Object.keys(bag.records).map((id) => bag.records[id]);
  const merged = mergeRecords(list, rows);
  const next: { [id: string]: SyncRecord } = {};
  for (let i = 0; i < merged.length; i++) next[merged[i].id] = merged[i];
  bag.records = next;
  write(bag);
  return merged;
}

export function deviceMigrated(): boolean {
  return read().migrated;
}

export function markDeviceMigrated(): void {
  const bag = read();
  bag.migrated = true;
  write(bag);
}

export function syncEnabled(): boolean {
  return read().syncOn;
}

export function setSyncEnabled(on: boolean): void {
  const bag = read();
  bag.syncOn = on;
  write(bag);
}

export function lastSyncAt(): number {
  return read().lastSync;
}

export function markSynced(at: number): void {
  const bag = read();
  bag.lastSync = at;
  write(bag);
}

export function syncCursor(): number {
  return read().lastSeq;
}

export function setSyncCursor(seq: number): void {
  const bag = read();
  if (seq > bag.lastSeq) bag.lastSeq = seq;
  write(bag);
}

/** Another billing account must not upload this device's earlier rows. Local rows stay. */
export function noteSyncAccount(id: string): number {
  const bag = read();
  if (bag.accountId && id && bag.accountId !== id) {
    bag.syncEpoch = Date.now();
    bag.lastSeq = 0;
  }
  if (id) bag.accountId = id;
  write(bag);
  return bag.syncEpoch;
}

export function syncEpoch(): number {
  return read().syncEpoch;
}

export function resetDeviceDb(): void {
  write(empty());
}

let afterWrite: () => void = () => undefined;
let hydrated = false;
let writes = 0;

/** The sync client registers here so a local write can upload without a import cycle. */
export function onDeviceWrite(fn: () => void): void {
  afterWrite = fn;
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
      done();
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
        done();
      };
      req.onerror = () => {
        hydrated = true;
        db.close();
        done();
      };
    };
  } catch (e) {
    hydrated = true;
    done();
  }
}

// App startup calls hydrateDeviceDb. Tests do not, so a late IndexedDB read cannot overwrite a fixture.
