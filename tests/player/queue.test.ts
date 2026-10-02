import { describe, it, expect } from 'vitest';
import { buildTorrentQueue } from '../../src/player/queue';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

const H = 'c4c4bd6a4618e1042aa89649d629f85951eff546';
const c = new TorrServerClient({ url: 'h:1' });

describe('buildTorrentQueue', () => {
  it('orders episodes and attaches matching subtitles', () => {
    const t: Torrent = { hash: H, title: 'Show', stat: 5, poster: 'p.jpg' };
    const q = buildTorrentQueue(c, t, [
      { id: 2, path: 'Show/Show.S01E02.mkv', length: 10 },
      { id: 1, path: 'Show/Show.S01E01.mkv', length: 10 },
      { id: 3, path: 'Show/Show.S01E01.rus.srt', length: 1 },
      { id: 4, path: 'Show/readme.txt', length: 1 },
    ]);
    expect(q.map((i) => i.fileIndex)).toEqual([1, 2]);
    expect(q[0]).toEqual({
      url: c.streamUrl(H, 1, 'Show.S01E01.mkv'),
      title: 'Show.S01E01.mkv',
      hash: H,
      fileIndex: 1,
      poster: 'p.jpg',
      torrentTitle: 'Show',
      subtitles: [{ url: c.streamUrl(H, 3, 'Show.S01E01.rus.srt'), label: 'rus', ext: 'srt' }],
    });
    expect(q[1].subtitles).toEqual([]);
  });
  it('uses torrent title for single-file torrents', () => {
    const q = buildTorrentQueue(c, { hash: H, title: 'Фильм (2020)', stat: 5 }, [{ id: 1, path: 'Movie.2020.mkv', length: 1 }]);
    expect(q[0].title).toBe('Фильм (2020)');
  });
});
