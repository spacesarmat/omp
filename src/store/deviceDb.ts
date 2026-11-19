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
}

function empty(): Bag {
  return { records: {}, migrated: false, syncOn: true, lastSync: 0 };
}

function read(): Bag {
  const raw = loadJson<{ [k: string]: unknown }>(KEY, {}, isObject);
  const records = isObject(raw.records) ? (raw.records as { [id: string]: SyncRecord }) : {};
  return {
    records,
    migrated: raw.migrated === true,
    syncOn: raw.syncOn !== false,
    lastSync: typeof raw.lastSync === 'number' ? raw.lastSync : 0,
  };
}

function write(bag: Bag): void {
  saveJson(KEY, bag);
  mirrorIndexed(bag);
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

export function resetDeviceDb(): void {
  write(empty());
}

function mirrorIndexed(bag: Bag): void {
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
    done();
    return;
  }
  try {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onerror = () => done();
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('bag');
      req.onsuccess = () => {
        const bag = req.result as Bag | undefined;
        if (bag && bag.records && !Object.keys(read().records).length) saveJson(KEY, bag);
        db.close();
        done();
      };
      req.onerror = () => {
        db.close();
        done();
      };
    };
  } catch (e) {
    done();
  }
}
