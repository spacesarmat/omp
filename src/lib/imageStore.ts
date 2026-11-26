// Posters kept on the device between runs. The memory cache of src/lib/imageCache.ts dies with the app, so after a
// restart every grid downloads its pictures again; on a phone on mobile data that is traffic the person already
// paid for once. This is the second level: the same bytes in IndexedDB, with a quota of their own and the oldest
// picture dropped first.
//
// Everything here is best effort and nothing here throws: a browser without IndexedDB (webOS 3 in a strict mode),
// a private window that refuses it, or a full disk must leave the app exactly where it was before this module
// existed. An entry point that threw would be read by the caller as "the picture host is broken".
//
// Two stores. `images` holds the bytes, `meta` holds only the size and the touch stamp, so counting what is kept
// and choosing what to drop never reads the pictures themselves.

const DB_NAME = 'omp-images';
const IMAGES = 'images';
const META = 'meta';
/** 60 MB: about 1500 posters of the size the grids ask for. */
export const STORE_QUOTA = 60 * 1024 * 1024;
/** A row touched within this window is not re-stamped on read: the stamp only has to be roughly right. */
const TOUCH_MS = 10 * 60 * 1000;
/** Writes are gathered and committed together: a grid asks for dozens of posters in one second. */
const FLUSH_ITEMS = 12;
const FLUSH_MS = 800;

interface ImageRow {
  url: string;
  type: string;
  data: ArrayBuffer;
}

interface MetaRow {
  url: string;
  bytes: number;
  seen: number;
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
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'url' });
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

/** The A bytes of a picture as an ArrayBuffer, on every engine this app runs on. */
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

/**
 * One queue for everything that changes the store. A clear that ran in the middle of a flush would otherwise put
 * the pictures of that flush back, and a flush started before a clear must not commit afterwards.
 */
let chain: Promise<void> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  // the queue itself never carries a rejection into the next task
  chain = next.then(() => undefined, () => undefined);
  return next;
}

/** Rows are dropped oldest touched first until the store fits the quota again. */
async function trimToQuota(db: IDBDatabase, extra: number): Promise<void> {
  const metaTx = db.transaction(META, 'readonly');
  const metaDone = completion(metaTx);
  const rows = await request(metaTx.objectStore(META).getAll() as IDBRequest<MetaRow[]>);
  await metaDone;
  let bytes = rows.reduce((sum, r) => sum + (r.bytes || 0), 0) + extra;
  if (bytes <= STORE_QUOTA) return;
  const sorted = rows.slice().sort((a, b) => (a.seen || 0) - (b.seen || 0));
  const tx = db.transaction([IMAGES, META], 'readwrite');
  const done = completion(tx);
  const images = tx.objectStore(IMAGES);
  const meta = tx.objectStore(META);
  for (const row of sorted) {
    if (bytes <= STORE_QUOTA) break;
    images.delete(row.url);
    meta.delete(row.url);
    bytes -= row.bytes || 0;
  }
  await done;
}

const staged = new Map<string, { epoch: number; ready: Promise<void> }>();
const pending = new Map<string, { row: ImageRow; meta: MetaRow; epoch: number }>();
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer === null) timer = setTimeout(() => void flushImageWrites().catch(() => undefined), FLUSH_MS);
}

/** Commits everything gathered so far. Awaiting it is what tests and the clear button do. */
export function flushImageWrites(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  return enqueue(async () => {
    const mine = epoch;
    await Promise.all(Array.from(staged.values()).map((s) => s.ready.catch(() => undefined)));
    // rows staged before a clear are no longer ours to keep
    for (const [url, entry] of Array.from(pending)) {
      if (entry.epoch !== mine) pending.delete(url);
    }
    staged.clear();
    const rows = Array.from(pending.values());
    pending.clear();
    if (!rows.length || !usable) return;
    try {
      const db = await openDb();
      await trimToQuota(db, 0);
      const tx = db.transaction([IMAGES, META], 'readwrite');
      const done = completion(tx);
      const images = tx.objectStore(IMAGES);
      const meta = tx.objectStore(META);
      for (const item of rows) {
        images.put(item.row);
        meta.put(item.meta);
      }
      await done;
      await trimToQuota(db, 0);
    } catch (err) {
      // a disk that is full answers the same way every time: switching the level off here is what stops the next
      // batch from copying its bytes again and retrying the write that just failed
      usable = false;
    }
  });
}

/** Remembers a picture for the next run. Fire and forget: the caller already has the bytes on screen. */
export function saveImage(url: string, blob: Blob): void {
  if (!usable || !url) return;
  const mine = epoch;
  const bytes = blob.size || 0;
  const seen = Date.now();
  const ready = toBuffer(blob).then(
    (data) => {
      if (mine !== epoch) return;
      pending.set(url, { row: { url, type: blob.type || 'image/jpeg', data }, meta: { url, bytes, seen }, epoch: mine });
      if (pending.size >= FLUSH_ITEMS) void flushImageWrites().catch(() => undefined);
    },
    () => {
      /* the bytes did not survive the copy: the memory cache still has them */
    },
  );
  staged.set(url, { epoch: mine, ready });
  schedule();
}

/** The bytes of a stored picture, or null. A hit refreshes the touch stamp when it has grown stale. */
export async function readImage(url: string): Promise<Blob | null> {
  if (!usable || !url) return null;
  try {
    return await enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(IMAGES, 'readonly');
      const done = completion(tx);
      const row = await request(tx.objectStore(IMAGES).get(url) as IDBRequest<ImageRow | undefined>);
      await done;
      if (!row || typeof row.data?.byteLength !== 'number') {
        if (row && row.url) await dropRows([row.url]);
        return null;
      }
      const metaTx = db.transaction(META, 'readonly');
      const metaDone = completion(metaTx);
      const meta = await request(metaTx.objectStore(META).get(url) as IDBRequest<MetaRow | undefined>);
      await metaDone;
      if (meta && Date.now() - (meta.seen || 0) > TOUCH_MS) {
        pending.set(url, { row: { url, type: row.type, data: row.data }, meta: { url, bytes: row.data.byteLength, seen: Date.now() }, epoch });
        schedule();
      }
      return new Blob([row.data], { type: row.type || 'image/jpeg' });
    });
  } catch (err) {
    // a store that cannot answer is not a broken picture host: the caller goes to the network
    usable = false;
    return null;
  }
}

/** Removes rows by url: a picture that cannot be read back is not worth keeping. */
async function dropRows(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const db = await openDb();
  const tx = db.transaction([IMAGES, META], 'readwrite');
  const done = completion(tx);
  for (const url of urls) {
    tx.objectStore(IMAGES).delete(url);
    tx.objectStore(META).delete(url);
  }
  await done;
}

export interface StoredStats {
  items: number;
  bytes: number;
  /** False when the device gave up on IndexedDB, so the settings row can say what is actually kept. */
  available: boolean;
}

/** Counts what is kept from the size register only - the pictures themselves are not read. */
export async function storedStats(): Promise<StoredStats> {
  if (!usable) return { items: 0, bytes: 0, available: false };
  try {
    return await enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(META, 'readonly');
      const done = completion(tx);
      const rows = await request(tx.objectStore(META).getAll() as IDBRequest<MetaRow[]>);
      await done;
      return { items: rows.length, bytes: rows.reduce((sum, r) => sum + (r.bytes || 0), 0), available: true };
    });
  } catch (err) {
    usable = false;
    return { items: 0, bytes: 0, available: false };
  }
}

/** Wipes the stored pictures: the «Очистить» button in the settings. */
export function clearStoredImages(): Promise<void> {
  // anything staged or gathered before this moment belongs to the old state and must not be committed
  epoch++;
  staged.clear();
  pending.clear();
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!usable) return Promise.resolve();
  return enqueue(async () => {
    try {
      const db = await openDb();
      const tx = db.transaction([IMAGES, META], 'readwrite');
      const done = completion(tx);
      tx.objectStore(IMAGES).clear();
      tx.objectStore(META).clear();
      await done;
    } catch (err) {
      usable = false;
    }
  }).catch(() => undefined);
}

/** Test seam: forgets the open database so a case can start from an empty one. */
export function resetImageStore(): void {
  opened = null;
  opening = null;
  staged.clear();
  pending.clear();
  epoch++;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  usable = typeof indexedDB !== 'undefined';
}
