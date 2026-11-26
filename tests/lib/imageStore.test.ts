import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStoredImages, flushImageWrites, readImage, resetImageStore, saveImage, storedStats } from '../../src/lib/imageStore';

const bytes = (n: number) => new Blob([new Uint8Array(n)]);

beforeEach(async () => {
  resetImageStore();
  await clearStoredImages();
});

afterEach(() => {
  resetImageStore();
});

describe('imageStore', () => {
  it('gives back what was saved', async () => {
    saveImage('https://img/a.jpg', bytes(10));
    await flushImageWrites();
    const held = await readImage('https://img/a.jpg');
    expect(held).not.toBeNull();
    expect(held!.size).toBe(10);
  });

  it('knows nothing about an address it never saw', async () => {
    expect(await readImage('https://img/never.jpg')).toBeNull();
  });

  it('counts what is kept', async () => {
    saveImage('https://img/a.jpg', bytes(10));
    saveImage('https://img/b.jpg', bytes(20));
    await flushImageWrites();
    const st = await storedStats();
    expect(st.available).toBe(true);
    expect(st.items).toBe(2);
    expect(st.bytes).toBe(30);
  });

  it('drops the oldest picture when the quota is over', async () => {
    const quota = 60 * 1024 * 1024;
    // 15 + 15 + 40 MB against a 60 MB quota: the first picture cannot stay
    saveImage('https://img/1.jpg', bytes(quota / 4));
    await flushImageWrites();
    saveImage('https://img/2.jpg', bytes(quota / 4));
    await flushImageWrites();
    saveImage('https://img/3.jpg', bytes(quota * 0.66));
    await flushImageWrites();
    const st = await storedStats();
    expect(st.bytes).toBeLessThanOrEqual(quota);
    expect(await readImage('https://img/1.jpg')).toBeNull();
    expect(await readImage('https://img/3.jpg')).not.toBeNull();
  });

  it('wipes everything', async () => {
    saveImage('https://img/a.jpg', bytes(5));
    await flushImageWrites();
    expect((await storedStats()).items).toBe(1);
    await clearStoredImages();
    const st = await storedStats();
    expect(st.items).toBe(0);
    expect(st.bytes).toBe(0);
    expect(await readImage('https://img/a.jpg')).toBeNull();
  });

  it('keeps the last write when the same address is saved twice', async () => {
    saveImage('https://img/a.jpg', bytes(4));
    saveImage('https://img/a.jpg', bytes(9));
    await flushImageWrites();
    const st = await storedStats();
    expect(st.items).toBe(1);
    expect(st.bytes).toBe(9);
  });

  it('counts from the size register without reading the pictures', async () => {
    const seen: string[] = [];
    const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['getAll']>) {
      seen.push(this.name);
      return original.apply(this, args);
    };
    try {
      saveImage('https://img/a.jpg', bytes(10));
      await flushImageWrites();
      const st = await storedStats();
      expect(st.items).toBe(1);
      expect(st.bytes).toBe(10);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((n) => n === 'images').length).toBe(0);
    } finally {
      IDBObjectStore.prototype.getAll = original;
    }
  });

  it('a clear wins over a flush that was already running', async () => {
    saveImage('https://img/late.jpg', bytes(12));
    // no await in between: the flush and the clear race, and the clear must be the one that stands
    const clearing = clearStoredImages();
    await Promise.all([flushImageWrites(), clearing]);
    const st = await storedStats();
    expect(st.items).toBe(0);
    expect(await readImage('https://img/late.jpg')).toBeNull();
  });

  it('a database that refuses to open is not reported as a broken picture', async () => {
    const original = indexedDB.open.bind(indexedDB);
    // the same fake request every time: openDb hangs its handlers on it, and the error fires on the next tick
    const fake = {} as IDBOpenDBRequest;
    (indexedDB as unknown as { open: IDBFactory['open'] }).open = (() => {
      setTimeout(() => {
        if (fake.onerror) fake.onerror(new Event('error'));
      }, 0);
      return fake;
    }) as IDBFactory['open'];
    resetImageStore();
    try {
      expect(await readImage('https://img/x.jpg')).toBeNull();
      expect((await storedStats()).available).toBe(false);
      await expect(clearStoredImages()).resolves.toBeUndefined();
    } finally {
      (indexedDB as unknown as { open: IDBFactory['open'] }).open = original;
      resetImageStore();
    }
  });

  it('a write the disk refuses switches the level off instead of being retried', async () => {
    const original = IDBObjectStore.prototype.put;
    let attempts = 0;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore) {
      attempts++;
      throw new Error('QuotaExceededError');
    };
    try {
      saveImage('https://img/full.jpg', bytes(10));
      await flushImageWrites();
      expect(attempts).toBeGreaterThan(0);
      expect((await storedStats()).available).toBe(false);
      const after = attempts;
      // the next batch must not copy its bytes and try the same failing write again
      saveImage('https://img/full2.jpg', bytes(10));
      await flushImageWrites();
      expect(attempts).toBe(after);
    } finally {
      IDBObjectStore.prototype.put = original;
      resetImageStore();
    }
  });
});
