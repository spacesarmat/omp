import { describe, it, expect, beforeEach } from 'vitest';
import {
  reloadProgress, saveProgress, getLocalProgress, isWatched, resumePosition, progressRatio,
  markWatched, clearProgress, serverViewed, continueWatching, refreshViewed, resetViewed,
} from '../../src/store/progress';
import type { Torrent } from '../../src/api/types';

const H = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
});

describe('progress store', () => {
  it('saves and resumes', () => {
    saveProgress(H, 1, 120, 1000);
    expect(getLocalProgress(H, 1)!.time).toBe(120);
    expect(resumePosition(H, 1)).toBe(120);
    expect(isWatched(H, 1)).toBe(false);
    expect(progressRatio(H, 1)).toBeCloseTo(0.12);
    reloadProgress();
    expect(resumePosition(H, 1)).toBe(120);
  });
  it('does not resume tiny or finished positions', () => {
    saveProgress(H, 1, 5, 1000);
    expect(resumePosition(H, 1)).toBe(0);
    saveProgress(H, 1, 950, 1000);
    expect(resumePosition(H, 1)).toBe(0);
    expect(isWatched(H, 1)).toBe(true);
  });
  it('uses server viewed when no local data', () => {
    serverViewed.value = [{ hash: H, file_index: 2, timecode: 0 }, { hash: H, file_index: 3, timecode: 300 }];
    expect(isWatched(H, 2)).toBe(true);
    expect(isWatched(H, 3)).toBe(false);
    expect(resumePosition(H, 3)).toBe(300);
    expect(isWatched(H, 4)).toBe(false);
  });
  it('marks and clears', () => {
    markWatched(H, 1);
    expect(isWatched(H, 1)).toBe(true);
    saveProgress(H, 2, 100, 1000);
    clearProgress(H);
    expect(getLocalProgress(H, 1)).toBeNull();
    expect(getLocalProgress(H, 2)).toBeNull();
  });
  it('builds continue watching list', () => {
    const list = [{ hash: H, title: 'A', stat: 5 }, { hash: H2, title: 'B', stat: 5 }] as Torrent[];
    saveProgress(H, 1, 100, 1000);
    saveProgress(H, 2, 200, 1000);
    saveProgress(H2, 1, 960, 1000);
    saveProgress('c'.repeat(40), 1, 100, 1000);
    const r = continueWatching(list);
    expect(r).toHaveLength(1);
    expect(r[0].torrent.hash).toBe(H);
    expect(r[0].fileIndex).toBe(2);
  });
  it('refreshViewed loads from client and ignores errors', async () => {
    await refreshViewed({ viewedList: () => Promise.resolve([{ hash: H, file_index: 1 }]) } as any);
    expect(serverViewed.value).toHaveLength(1);
    await refreshViewed({ viewedList: () => Promise.reject(new Error('x')) } as any);
    expect(serverViewed.value).toHaveLength(1);
  });
  it('ignores a stale viewedList after resetViewed', async () => {
    let resolve!: (v: any) => void;
    const p = refreshViewed({ viewedList: () => new Promise<any>((r) => { resolve = r; }) } as any);
    resetViewed();
    resolve([{ hash: H, file_index: 1 }]);
    await p;
    expect(serverViewed.value).toEqual([]);
  });
});
