import { deviceId } from '../billing/session';
import { mergeRecords, newer, type SyncRecord } from './syncMerge';

const DB_NAME = 'omp-sync-v2';
const RECORDS = 'records';
const OUTBOX = 'outbox';
const META = 'meta';

export interface SyncRecordV2 extends SyncRecord {
  mutationId?: string;
  revision?: number;
}
export interface OutboxRow {
  mutationId: string;
  accountId: string;
  row: SyncRecordV2;
  createdAt: number;
  blocked?: string;
}
export interface V2Meta {
  key: string;
  accountId: string;
  revision: number;
  [key: string]: unknown;
}

let opening: Promise<IDBDatabase> | null = null;
let opened: IDBDatabase | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb'));
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('indexeddb_transaction'));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (opened) return Promise.resolve(opened);
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'mutationId' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      opened = req.result;
      opened.onversionchange = () => resetDeviceV2Db();
      resolve(opened);
    };
    req.onerror = () => reject(req.error || new Error('indexeddb_open'));
  }).then((db) => db, (error) => {
    opening = null;
    throw error;
  });
  return opening!;
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = completion(tx);
  try {
    const result = await fn(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch (e) { /* already finished */ }
    await done.catch(() => undefined);
    throw error;
  }
}

function baseRecord(row: SyncRecordV2): SyncRecord {
  return {
    id: String(row.id || ''), kind: String(row.kind || ''), key: String(row.key || ''),
    body: row.body && typeof row.body === 'object' ? row.body : {},
    updatedAt: Number(row.updatedAt) || 0, deviceId: String(row.deviceId || ''), deleted: row.deleted === true,
  };
}

function sameEdit(row: SyncRecordV2, other: SyncRecordV2): boolean {
  return row.id === other.id && row.updatedAt === other.updatedAt && row.deviceId === other.deviceId;
}

async function localRows(tx: IDBTransaction, rows: SyncRecordV2[], accountId: string, skipExisting: boolean): Promise<OutboxRow[]> {
  const records = tx.objectStore(RECORDS);
  const outbox = tx.objectStore(OUTBOX);
  const meta = tx.objectStore(META);
  const counterRow = await request(meta.get('device-counter'));
  let counter = counterRow && typeof counterRow.value === 'number' ? counterRow.value : 0;
  const existing = await request(outbox.getAll()) as OutboxRow[];
  const created: OutboxRow[] = [];
  for (const input of rows) {
    const row = baseRecord(input);
    if (!row.id || !row.kind || row.updatedAt <= 0) continue;
    const previous = await request(records.get(row.id)) as SyncRecord | undefined;
    if (previous && newer(previous, row) === previous) continue;
    if (skipExisting && existing.some((item) => item.accountId === accountId && sameEdit(item.row, row))) continue;
    for (const item of existing) {
      if (item.accountId === accountId && item.row.id === row.id && item.blocked) await request(outbox.delete(item.mutationId));
    }
    counter++;
    const mutationId = deviceId() + ':' + counter;
    const mutationRow: SyncRecordV2 = { ...row, mutationId };
    const item: OutboxRow = { mutationId, accountId, row: mutationRow, createdAt: Date.now() };
    await request(records.put(row));
    await request(outbox.put(item));
    existing.push(item);
    created.push(item);
  }
  await request(meta.put({ key: 'device-counter', value: counter }));
  return created;
}

export function putV2Local(rows: SyncRecordV2[], accountId: string): Promise<OutboxRow[]> {
  return transaction([RECORDS, OUTBOX, META], 'readwrite', (tx) => localRows(tx, rows, accountId, false));
}

export function enqueueUnsent(rows: SyncRecordV2[], accountId: string): Promise<void> {
  return transaction([RECORDS, OUTBOX, META], 'readwrite', async (tx) => {
    await localRows(tx, rows, accountId, true);
  }).then(() => undefined);
}

export function mirrorV2Bag(rows: SyncRecordV2[]): Promise<void> {
  return transaction([RECORDS], 'readwrite', async (tx) => {
    const store = tx.objectStore(RECORDS);
    for (const input of rows) {
      const row = baseRecord(input);
      if (!row.id) continue;
      const previous = await request(store.get(row.id)) as SyncRecord | undefined;
      if (!previous || newer(previous, row) === row) await request(store.put(row));
    }
  }).then(() => undefined);
}

export function readV2Records(): Promise<SyncRecord[]> {
  return transaction([RECORDS], 'readonly', (tx) => request(tx.objectStore(RECORDS).getAll())) as Promise<SyncRecord[]>;
}

export function readV2Outbox(accountId: string, limit = 0): Promise<OutboxRow[]> {
  return transaction([OUTBOX], 'readonly', async (tx) => {
    const rows = await request(tx.objectStore(OUTBOX).getAll()) as OutboxRow[];
    return rows.filter((row) => row.accountId === accountId).sort((a, b) => a.createdAt - b.createdAt || a.mutationId.localeCompare(b.mutationId)).slice(0, limit > 0 ? limit : undefined);
  });
}

export function ackV2(acks: Array<{ mutationId: string; recordId: string; revision: number }>, sentRows: SyncRecord[]): Promise<void> {
  void sentRows;
  return transaction([OUTBOX], 'readwrite', async (tx) => {
    const store = tx.objectStore(OUTBOX);
    for (const ack of acks) await request(store.delete(ack.mutationId));
  }).then(() => undefined);
}

export function blockV2Mutation(mutationId: string, reason: string): Promise<void> {
  return transaction([OUTBOX], 'readwrite', async (tx) => {
    const store = tx.objectStore(OUTBOX);
    const row = await request(store.get(mutationId)) as OutboxRow | undefined;
    if (row) await request(store.put({ ...row, blocked: reason }));
  }).then(() => undefined);
}

export function mergeV2Pulled(rows: SyncRecordV2[]): Promise<SyncRecord[]> {
  return transaction([RECORDS], 'readwrite', async (tx) => {
    const store = tx.objectStore(RECORDS);
    for (const input of rows) {
      const row = baseRecord(input);
      const previous = await request(store.get(row.id)) as SyncRecord | undefined;
      if (!previous || newer(previous, row) === row) await request(store.put(row));
    }
    return request(store.getAll()) as Promise<SyncRecord[]>;
  });
}

export function readV2Meta(accountId: string): Promise<V2Meta> {
  return transaction([META], 'readonly', async (tx) => {
    const key = 'account:' + accountId;
    const row = await request(tx.objectStore(META).get(key));
    return row || { key, accountId, revision: 0 };
  });
}

export function writeV2Meta(accountId: string, patch: { [key: string]: unknown }): Promise<V2Meta> {
  return transaction([META], 'readwrite', async (tx) => {
    const store = tx.objectStore(META);
    const key = 'account:' + accountId;
    const previous = await request(store.get(key)) || { key, accountId, revision: 0 };
    const next = { ...previous, ...patch, key, accountId };
    await request(store.put(next));
    return next;
  });
}

export function hydrateV2Projection(currentRows: SyncRecord[]): Promise<SyncRecord[]> {
  return readV2Records().then((stored) => mergeRecords(currentRows, stored));
}

export function resetDeviceV2Db(): void {
  if (opened) opened.close();
  opened = null;
  opening = null;
}
