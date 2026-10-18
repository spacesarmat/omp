import { describe, it, expect, afterEach } from 'vitest';
import { lang } from '../../src/i18n';
import { torrentHeaderEpisodes } from '../src/lib/releaseContents';
import type { TorrentFile } from '../../src/lib/episodes';

afterEach(() => {
  lang.value = 'ru';
});

const f = (path: string): TorrentFile => ({ id: 1, path: path, length: 1 });

describe('torrent header episodes', () => {
  it('«5 из 8 серий» for one season whose total is known', () => {
    const files = [1, 2, 3, 4, 5].map((n) => f('Show.S02E0' + n + '.mkv'));
    expect(torrentHeaderEpisodes(files, 2, 8)).toBe('5 из 8 серий');
    expect(torrentHeaderEpisodes(files, 2, 0)).toBe('5 серий');
    expect(torrentHeaderEpisodes(files, null, 8)).toBe('5 серий');
  });

  it('a pack of several seasons stays «N серий»', () => {
    const files = ['Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S02E01.mkv'].map(f);
    expect(torrentHeaderEpisodes(files, 1, 8)).toBe('3 серии');
  });

  it('files that are not episodes stay a file count', () => {
    const files = ['a.mkv', 'b.mkv', 'c.mkv'].map(f);
    expect(torrentHeaderEpisodes(files, 2, 8)).toBe('3 файла');
  });

  it('a single file stays blank, as the header does for a film', () => {
    expect(torrentHeaderEpisodes([f('Show.S02E01.mkv')], 2, 8)).toBe('');
  });

  it('English', () => {
    lang.value = 'en';
    const files = [1, 2, 3, 4, 5].map((n) => f('Show.S02E0' + n + '.mkv'));
    expect(torrentHeaderEpisodes(files, 2, 8)).toBe('5 of 8 episodes');
    expect(torrentHeaderEpisodes(files, 2, 0)).toBe('5 episodes');
  });
});
