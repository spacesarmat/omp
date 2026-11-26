// Posters kept on the device between runs. The memory cache of src/lib/imageCache.ts dies with the app, so after a
// restart every grid downloads its pictures again; on a phone on mobile data that is the traffic the person already
// paid for once. This is the second level: the same Blob, stored in IndexedDB, with a quota of its own and the
// oldest picture dropped first.
//
// Everything here is best effort. A browser without IndexedDB (webOS 3 in a strict mode), a private window that
// refuses it, or a full disk must leave the app working exactly as it did before: the memory cache and the network
// still answer, only without persistence.

const DB_NAME = 'omp-images';
const IMAGES = 'images';
/** 60 MB: about 1500 posters of the size the grids ask for. */
export const STORE_QUOTA = 60 * 1024 * 1024;
/** A row touched within this window is not rewritten on read: the seen stamp only has to be roughly right. */
const TOUCH_MS = 10 * 60 * 1000;
/** Writes are gathered and committed together: a grid asks for dozens of posters in one second. */
const FLUSH_ITEMS = 12;
const FLUSH_MS = 800;

// A row holds an ArrayBuffer, not the Blob: structured cloning of Blob is uneven across engines (it is missing in
// the jsdom we test with, and shaky on old webOS), while ArrayBuffer is cloned everywhere. The Blob is rebuilt on
// read, which costs nothing next to a download.
interface Row {
  url: string;
  type: string;
  data: ArrayBuffer;
  bytes: number;
  seen: number;
}

/** The bytes of a picture as an ArrayBuffer, on every engine this app runs on. */
function toBuffer(blob: Blob): Promise<ArrayBuffer> {
  const asBuffer = (blob as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof asBuffer === 'function') return asBuffer.call(blob);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsArrayBuffer(blob);
  });
}

let opening: Promise<IDBDatabase> | null = null;
let opened: IDBDatabase | null = null;
/** False once a storage attempt has failed: the app stops trying for the rest of the run. */
let usable = typeof indexedDB !== 'undefined';

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
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'url' });
    };
    req.onsuccess = () => resolve((opened = req.result));
    req.onerror = () => reject(req.error || new Error('indexeddb_open'));
    req.onblocked = () => reject(new Error('indexeddb_blocked'));
  }).then((db) => db, (error) => {
    opening = null;
    usable = false;
    throw error;
  });
  return opening;
}

function giveUp(err: unknown): never {
  // one broken attempt is enough for the whole run
  usable = false;
  throw err instanceof Error ? err : new Error('indexeddb');
}

/** All rows, oldest touched first - the order the quota drops them in. */
async function allRows(): Promise<Row[]> {
  const db = await openDb();
  const tx = db.transaction(IMAGES, 'readonly');
  const done = completion(tx);
  try {
    const rows = await request(tx.objectStore(IMAGES).getAll() as IDBRequest<Row[]>);
    await done;
    return rows;
  } catch (err) {
    return giveUp(err);
  }
}

/** Drops the oldest pictures until the store fits the quota again. */
async function trim(db: IDBDatabase, rows: Row[], extra: number): Promise<void> {
  let bytes = rows.reduce((sum, r) => sum + r.bytes, 0) + extra;
  if (bytes <= STORE_QUOTA) return;
  const sorted = rows.slice().sort((a, b) => a.seen - b.seen);
  const tx = db.transaction(IMAGES, 'readwrite');
  const done = completion(tx);
  const store = tx.objectStore(IMAGES);
  for (const row of sorted) {
    if (bytes <= STORE_QUOTA) break;
    store.delete(row.url);
    bytes -= row.bytes;
  }
  await done;
}

const writes = new Map<string, Row>();
/** Pictures whose byte copy has not finished yet: a flush waits for them, or it would commit an empty batch. */
const staged = new Map<string, Promise<void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Commits everything gathered since the last call. Awaiting it is only needed by tests and by the clear button. */
export async function flushImageWrites(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await Promise.all(Array.from(staged.values()));
  staged.clear();
  const rows = Array.from(writes.values());
  writes.clear();
  if (!rows.length || !usable) return;
  try {
    const db = await openDb();
    const existing = await allRows();
    await trim(db, existing, 0);
    const tx = db.transaction(IMAGES, 'readwrite');
    const done = completion(tx);
    const store = tx.objectStore(IMAGES);
    for (const row of rows) store.put(row);
    await done;
    // a picture that alone is bigger than what is left goes straight back out
    await trim(db, await allRows(), 0);
  } catch (err) {
    giveUp(err);
  }
}

/** Remembers a picture for the next run. Fire and forget: the caller already has the bytes on screen. */
export function saveImage(url: string, blob: Blob): void {
  if (!usable || !url) return;
  const seen = Date.now();
  const bytes = blob.size || 0;
  const ready = toBuffer(blob).then(
    (data) => {
      writes.set(url, { url, type: blob.type || 'image/jpeg', data, bytes, seen });
      staged.delete(url);
      if (writes.size >= FLUSH_ITEMS) void flushImageWrites();
    },
    () => {
      /* the bytes did not survive the copy: the memory cache still has them */
      staged.delete(url);
    },
  );
  staged.set(url, ready);
  if (timer === null) timer = setTimeout(() => void flushImageWrites(), FLUSH_MS);
}

/** The bytes of a stored picture, or null. A hit refreshes the touch stamp when it has grown stale. */
export async function readImage(url: string): Promise<Blob | null> {
  if (!usable || !url) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(IMAGES, 'readonly');
    const done = completion(tx);
    const row = await request(tx.objectStore(IMAGES).get(url) as IDBRequest<Row | undefined>);
    await done;
    // not `instanceof ArrayBuffer`: the bytes come back from another realm under the test worker
    if (!row || typeof row.data?.byteLength !== 'number') {
      if (row && row.url) await dropRow(row.url);
      return null;
    }
    if (Date.now() - row.seen > TOUCH_MS) {
      writes.set(url, { ...row, seen: Date.now() });
      if (timer === null) timer = setTimeout(() => void flushImageWrites(), FLUSH_MS);
    }
    return new Blob([row.data], { type: row.type || 'image/jpeg' });
  } catch (err) {
    giveUp(err);
    return null;
  }
}

/** Removes one row: a picture that cannot be read back is not worth keeping. */
async function dropRow(url: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(IMAGES, 'readwrite');
    const done = completion(tx);
    tx.objectStore(IMAGES).delete(url);
    await done;
  } catch (err) {
    giveUp(err);
  }
}

export interface StoredStats {
  items: number;
  bytes: number;
  /** False when the device gave up on IndexedDB, so the settings row can say what is actually kept. */
  available: boolean;
}

export async function storedStats(): Promise<StoredStats> {
  if (!usable) return { items: 0, bytes: 0, available: false };
  try {
    const rows = await allRows();
    return { items: rows.length, bytes: rows.reduce((sum, r) => sum + r.bytes, 0), available: true };
  } catch (err) {
    giveUp(err);
    return { items: 0, bytes: 0, available: false };
  }
}

/** Wipes the stored pictures: the «Очистить данные» button in the settings. */
export async function clearStoredImages(): Promise<void> {
  writes.clear();
  staged.clear();
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!usable) return;
  try {
    const db = await openDb();
    const tx = db.transaction(IMAGES, 'readwrite');
    const done = completion(tx);
    tx.objectStore(IMAGES).clear();
    await done;
  } catch (err) {
    giveUp(err);
  }
}

/** Test seam: forgets the open database so a case can start from an empty one. */
export function resetImageStore(): void {
  opened = null;
  opening = null;
  writes.clear();
  staged.clear();
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  usable = typeof indexedDB !== 'undefined';
}
