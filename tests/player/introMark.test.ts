import { describe, it, expect } from 'vitest';
import { introMark } from '../../src/player/introMark';
import type { FfprobeResult } from '../../src/api/types';

function probe(chapters: { start: string; end: string; title: string }[]): FfprobeResult {
  return {
    streams: [],
    chapters: chapters.map((c) => ({ start_time: c.start, end_time: c.end, tags: { title: c.title } })),
  } as unknown as FfprobeResult;
}

describe('introMark', () => {
  it('turns the intro chapter into a message for the item', () => {
    const p = probe([
      { start: '0', end: '60', title: 'Cold open' },
      { start: '60.5', end: '150', title: 'Opening' },
    ]);
    expect(introMark(p, 2, 7)).toEqual({ type: 'intro', index: 2, start: 60.5, end: 150, session: 7 });
  });

  it('sends nothing without ffprobe, chapters or an intro chapter', () => {
    expect(introMark(null, 0, 1)).toBeNull();
    expect(introMark(probe([]), 0, 1)).toBeNull();
    expect(introMark(probe([{ start: '0', end: '90', title: 'Part 1' }]), 0, 1)).toBeNull();
  });

  it('ignores intro chapters of 5 s or less', () => {
    expect(introMark(probe([{ start: '10', end: '14', title: 'Intro' }]), 0, 1)).toBeNull();
  });
});
