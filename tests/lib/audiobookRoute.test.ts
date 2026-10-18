import { describe, expect, it } from 'vitest';
import { isAudiobookTorrent } from '../../src/lib/audiobookRoute';

const file = (path: string, id = 1) => ({ id, path, length: 1000 });

describe('isAudiobookTorrent', () => {
  it('trusts the audiobook category even before files arrive', () => {
    expect(isAudiobookTorrent({ category: 'audiobook', file_stats: [] })).toBe(true);
    expect(isAudiobookTorrent(null)).toBe(false);
    expect(isAudiobookTorrent({ category: 'movie', file_stats: [] })).toBe(false);
  });

  it('treats a file list of only book audio as an audiobook', () => {
    expect(isAudiobookTorrent({ file_stats: [file('CD1/01.mp3'), file('CD1/02.m4b', 2)] })).toBe(true);
    const data = JSON.stringify({ TorrServer: { Files: [file('01.mp3')] } });
    expect(isAudiobookTorrent({ data })).toBe(true);
  });

  it('keeps a video, and a video with an extra mp3, on the video screen', () => {
    expect(isAudiobookTorrent({ file_stats: [file('Show.mkv'), file('extra.mp3', 2)] })).toBe(false);
    expect(isAudiobookTorrent({ file_stats: [file('notes.txt')] })).toBe(false);
  });
});
