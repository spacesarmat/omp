import { describe, it, expect } from 'vitest';
import { AUDIO_SEEK_MS, AUDIO_SPEEDS, chapterPlayItem, filePlayItem, playOffsetMs } from '../../src/lib/audiobookPlayback';

describe('audiobook playback queue', () => {
  it('seeks by 30 seconds and keeps speed inside 0.5–3', () => {
    expect(AUDIO_SEEK_MS).toBe(30000);
    expect(AUDIO_SPEEDS[0]).toBe(0.5);
    expect(AUDIO_SPEEDS[AUDIO_SPEEDS.length - 1]).toBe(3);
    expect(AUDIO_SPEEDS.indexOf(1)).toBeGreaterThan(0);
  });

  it('clips a chapter and leaves a whole file open', () => {
    const file = filePlayItem('http://127.0.0.1:8090/stream/01.mp3?index=1&play', '01', 1);
    expect(file).toEqual({ url: file.url, title: '01', fileId: 1, startMs: 0, endMs: 0 });
    const chapter = chapterPlayItem('http://127.0.0.1:8090/book.m4b?index=3&play', 'Глава первая', 3, 90, 200);
    expect(chapter.startMs).toBe(90000);
    expect(chapter.endMs).toBe(200000);
    expect(chapterPlayItem('http://x/a.m4b', 'x', 1, 10, 10).endMs).toBe(0);
    expect(playOffsetMs(chapter, 90000)).toBe(0);
    expect(playOffsetMs(chapter, 95000)).toBe(5000);
    expect(playOffsetMs(file, 12000)).toBe(12000);
  });
});
