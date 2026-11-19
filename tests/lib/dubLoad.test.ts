import { describe, expect, it } from 'vitest';
import { externalDubSeen, probeDubSeen, probeFileId } from '../../src/lib/dubLoad';
import type { TorrentFile } from '../../src/lib/episodes';

const f = (id: number, path: string): TorrentFile => ({ id, path, length: 1000 });

describe('dub list before a season was played', () => {
  it('reads studios from external audio next to the video', () => {
    const files = [
      f(1, 'Show/Show.S01E01.mkv'),
      f(2, 'Show/Rus Sound/LostFilm/Show.S01E01.mka'),
      f(3, 'Show/Rus Sound/HDRezka/Show.S01E01.mka'),
    ];
    expect(externalDubSeen(files).map((s) => s.l).sort()).toEqual(['HDRezka', 'LostFilm']);
    expect(probeFileId(files)).toBe(1);
  });

  it('reads named ffprobe tracks and skips a track with no studio', () => {
    const seen = probeDubSeen({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc' },
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { title: 'LostFilm', language: 'rus' } },
        { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'eng' } },
      ],
    });
    expect(seen).toEqual([{ l: 'LostFilm', g: 'ru', c: '5.1' }]);
  });

  it('an empty probe and a release with no video offer nothing', () => {
    expect(probeDubSeen(null)).toEqual([]);
    expect(externalDubSeen([f(1, 'book.mp3')])).toEqual([]);
    expect(probeFileId([f(1, 'book.mp3')])).toBe(1);
  });
});
