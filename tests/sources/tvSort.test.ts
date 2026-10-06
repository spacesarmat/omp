import { describe, it, expect } from 'vitest';
import { sortTvResults, stableTvOrder } from '../../src/sources/tvSort';

const r = (t: string, s: number, extra: object = {}) => ({ Title: t, Seed: s, Link: t, ...extra }) as never;
const titles = (l: { Title: string }[]) => l.map((x) => x.Title);

describe('sortTvResults', () => {
  it('quality first, then seeds', () => {
    expect(sortTvResults([r('X 1080p WEB-DL', 50), r('X 2160p HDR Remux', 3), r('X 2160p WEB-DL', 9)], 'quality').map((x: { Title: string }) => x.Title))
      .toEqual(['X 2160p HDR Remux', 'X 2160p WEB-DL', 'X 1080p WEB-DL']);
  });

  it('same quality: more seeds first, ties keep their order', () => {
    expect(titles(sortTvResults([r('A 1080p', 5), r('B 1080p', 50), r('C 1080p', 5)], 'quality'))).toEqual(['B 1080p', 'A 1080p', 'C 1080p']);
  });

  it('seeds / size / date keys use the shared sort', () => {
    const list = [r('A 2160p', 1, { Size: '90 GB' }), r('B 720p', 99, { Size: '1 GB' })];
    expect(titles(sortTvResults(list, 'seeds'))).toEqual(['B 720p', 'A 2160p']);
    expect(titles(sortTvResults(list, 'size'))).toEqual(['A 2160p', 'B 720p']);
  });

  it('stableTvOrder keeps shown rows and sorts the new ones below', () => {
    const list = [r('Low 720p', 1), r('Top 2160p', 1), r('Mid 1080p', 1)];
    expect(titles(stableTvOrder(['Low 720p'], list, 'quality'))).toEqual(['Low 720p', 'Top 2160p', 'Mid 1080p']);
  });
});
