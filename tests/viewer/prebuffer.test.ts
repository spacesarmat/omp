import { afterEach, describe, expect, it } from 'vitest';
import { connectionMetered, isMkvName, protectWarm, resetWarmProtect, shouldPrebuffer, startFileWarm, startWarm, tailRange, type WarmClient } from '../../src/viewer/prebuffer';
import type { TorrentFile } from '../../src/lib/episodes';

afterEach(() => {
  resetWarmProtect();
});

function file(path: string, length: number, id = 1): TorrentFile {
  return { id: id, path: path, length: length };
}

function client(files: TorrentFile[]): WarmClient & { calls: string[]; removed: string[] } {
  const calls: string[] = [];
  const removed: string[] = [];
  return {
    calls: calls,
    removed: removed,
    get: (hash) => Promise.reject(new Error('missing ' + hash)),
    addTemporary: (link) => Promise.resolve({ hash: 'added-' + link }),
    remove: (hash) => {
      removed.push(hash);
      return Promise.resolve();
    },
    loadInfo: (hash) => Promise.resolve({ hash: hash, file_stats: files }),
    files: (t) => t.file_stats || [],
    preload: (hash, index, name) => {
      calls.push('pre ' + hash + ' ' + index + ' ' + name);
      return Promise.resolve();
    },
    preloadTail: (hash, index, name, start, end) => {
      calls.push('tail ' + hash + ' ' + index + ' ' + start + '-' + end + ' ' + name);
      return Promise.resolve();
    },
  };
}

describe('prebuffer policy', () => {
  it('skips metered data unless the setting allows it', () => {
    expect(shouldPrebuffer(false, false)).toBe(true);
    expect(shouldPrebuffer(true, false)).toBe(false);
    expect(shouldPrebuffer(true, true)).toBe(true);
    expect(connectionMetered()).toBe(false);
  });

  it('asks for the MKV tail only when the file is long enough', () => {
    expect(isMkvName('a/Movie.MKV')).toBe(true);
    expect(isMkvName('a/Movie.mp4')).toBe(false);
    expect(tailRange(1000)).toBeNull();
    const range = tailRange(10 * 1024 * 1024);
    expect(range && range.end - range.start + 1).toBe(2 * 1024 * 1024);
  });

  it('preloads the start and the MKV tail, and stops without deleting a library torrent', async () => {
    const c = client([file('Show/E01.mkv', 10 * 1024 * 1024)]);
    const stop = startFileWarm(c, 'abc', file('Show/E01.mkv', 10 * 1024 * 1024), true);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.calls[0]).toContain('pre abc 1 E01.mkv');
    expect(c.calls.some((x) => x.indexOf('tail ') === 0)).toBe(true);
    stop();
    expect(c.removed).toEqual([]);
  });

  it('does not start on a metered link', () => {
    const c = client([]);
    startFileWarm(c, 'abc', file('A.mkv', 10 * 1024 * 1024), false);
    expect(c.calls).toEqual([]);
  });

  it('removes a torrent it added when the screen is left, and keeps one the viewer claimed', async () => {
    const c = client([file('Movie.mp4', 1000, 2)]);
    const stop = startWarm(c, { link: 'magnet-1' }, true);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.calls.some((x) => x.indexOf('pre added-magnet-1') === 0)).toBe(true);
    stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.removed).toEqual(['added-magnet-1']);

    const kept = client([file('Movie.mp4', 1000, 2)]);
    const stopKept = startWarm(kept, { link: 'magnet-2' }, true);
    await new Promise((r) => setTimeout(r, 20));
    protectWarm('added-magnet-2');
    stopKept();
    await new Promise((r) => setTimeout(r, 0));
    expect(kept.removed).toEqual([]);
  });
});
