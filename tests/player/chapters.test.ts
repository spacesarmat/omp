import { describe, it, expect } from 'vitest';
import { introChapter } from '../../src/player/chapters';
import type { FfprobeResult } from '../../src/api/types';

const probe = (titles: [number, number, string][]): FfprobeResult => ({
  streams: [],
  chapters: titles.map(([s, e, title]) => ({ start_time: String(s), end_time: String(e), tags: { title } })),
});

describe('introChapter', () => {
  it('finds intro-like chapters', () => {
    const p = probe([[0, 90, 'Intro'], [90, 1500, 'Episode']]);
    expect(introChapter(p, 10)).toEqual({ start: 0, end: 90 });
    expect(introChapter(p, 89.5)).toBeNull();
    expect(introChapter(p, 100)).toBeNull();
  });
  it('matches titles in several languages and ignores look-alikes', () => {
    expect(introChapter(probe([[5, 60, 'Opening']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'OP']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Заставка']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Вступление']]), 6)).not.toBeNull();
    expect(introChapter(probe([[5, 60, 'Copyright']]), 6)).toBeNull();
    expect(introChapter(probe([[5, 60, 'Chapter 1']]), 6)).toBeNull();
    expect(introChapter(probe([[5, 8, 'Intro']]), 6)).toBeNull();
  });
  it('handles missing data', () => {
    expect(introChapter(null, 1)).toBeNull();
    expect(introChapter({ streams: [] }, 1)).toBeNull();
  });
});
