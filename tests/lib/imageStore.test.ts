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
});
