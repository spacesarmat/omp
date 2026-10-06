import { describe, it, expect } from 'vitest';
import { episodeCopies, episodeProgress, type ProgressReader, type StoredProgress } from '../../src/lib/episodeProgress';
import type { Torrent } from '../../src/api/types';

const files = (names: string[]) => names.map((p, i) => ({ id: i + 1, path: p, length: 1000 }));
const tv = (hash: string, title: string, names: string[]): Torrent => ({ hash, title, category: 'tv', stat: 3, file_stats: files(names) });

const UHD = tv('uhd', 'Звёздный путь: Странные новые миры / Star Trek: Strange New Worlds [S04] 2160p', ['S04E01.mkv', 'S04E02.mkv']);
const HD = tv('hd', 'Звездный путь: Странные новые миры / Star Trek: Strange New Worlds [S04] 1080p', ['x/SNW.S04E02.mkv', 'x/SNW.S04E01.mkv']);
const EN = tv('en', 'Star Trek: Strange New Worlds S04 720p', ['SNW.S04E01.mkv']);
const OTHER = tv('oth', 'Тёмная материя / Dark Matter [S04] 1080p', ['S04E01.mkv']);
const FILM: Torrent = { hash: 'film', title: 'Star Trek: Strange New Worlds 2160p', category: 'movie', stat: 3, file_stats: files(['S04E01.mkv']) };
const EXTRAS = tv('ext', 'Star Trek: Strange New Worlds Extras', ['Making of.mkv']);
const LIST = [UHD, HD, EN, OTHER, FILM, EXTRAS];

function reader(local: { [k: string]: StoredProgress }, server: { [k: string]: number | undefined } = {}): ProgressReader {
  return {
    local: (h, i) => local[h + ':' + i] || null,
    server: (h, i) => (Object.prototype.hasOwnProperty.call(server, h + ':' + i) ? { timecode: server[h + ':' + i] } : null),
  };
}

describe('episodeProgress', () => {
  it('two releases: watched in one counts in the other (same SxxEyy, any file order)', () => {
    const r = reader({ 'hd:2': { time: 3500, duration: 3600, updated: 5 } });
    const p = episodeProgress(LIST, 'uhd', 1, r);
    expect(p.watched).toBe(true);
    expect(p.hash).toBe('hd');
    expect(episodeProgress(LIST, 'uhd', 2, r).watched).toBe(false);
    // the release titled only in English joins through the one titled in both
    expect(episodeProgress(LIST, 'en', 1, r).watched).toBe(true);
  });

  it('a resume position in one release is offered in the other', () => {
    const r = reader({ 'uhd:2': { time: 1394, duration: 3600, updated: 7 } });
    const p = episodeProgress(LIST, 'hd', 1, r);
    expect(p.watched).toBe(false);
    expect(p.position).toBe(1394);
    expect(p.duration).toBe(3600);
  });

  it('a server viewed mark of a copy counts too', () => {
    expect(episodeProgress(LIST, 'uhd', 1, reader({}, { 'hd:2': undefined })).watched).toBe(true);
    expect(episodeProgress(LIST, 'uhd', 1, reader({}, { 'hd:2': 600 })).position).toBe(600);
  });

  it('the most recently updated copy wins', () => {
    const r = reader({
      'uhd:1': { time: 3500, duration: 3600, updated: 3 },
      'hd:2': { time: 900, duration: 3600, updated: 9 },
    });
    const p = episodeProgress(LIST, 'uhd', 1, r);
    expect(p.watched).toBe(false);
    expect(p.position).toBe(900);
    const older = reader({
      'uhd:1': { time: 900, duration: 3600, updated: 9 },
      'hd:2': { time: 3500, duration: 3600, updated: 3 },
    });
    expect(episodeProgress(LIST, 'uhd', 1, older).position).toBe(900);
  });

  it('a position past the file\'s own known duration is dropped', () => {
    const r = reader({
      'uhd:1': { time: 0, duration: 1200, updated: 1 },
      'hd:2': { time: 1500, duration: 3600, updated: 9 },
    });
    expect(episodeProgress(LIST, 'uhd', 1, r).position).toBe(0);
  });

  it('different series, films and files without SxxEyy are not mixed in', () => {
    const r = reader({
      'oth:1': { time: 3500, duration: 3600, updated: 9 },
      'film:1': { time: 3500, duration: 3600, updated: 9 },
    });
    expect(episodeProgress(LIST, 'uhd', 1, r).watched).toBe(false);
    expect(episodeCopies(LIST, 'uhd', 1).map((c) => c.hash).sort()).toEqual(['en', 'hd', 'uhd']);
    expect(episodeCopies(LIST, 'film', 1)).toEqual([{ hash: 'film', fileIndex: 1 }]);
    expect(episodeCopies(LIST, 'ext', 1)).toEqual([{ hash: 'ext', fileIndex: 1 }]);
    expect(episodeProgress(LIST, 'oth', 1, reader({ 'uhd:1': { time: 3500, duration: 3600, updated: 9 } })).watched).toBe(false);
  });

  it('nothing recorded: not watched, no position; an unknown hash reads only itself', () => {
    expect(episodeProgress(LIST, 'uhd', 1, reader({}))).toMatchObject({ watched: false, position: 0, ratio: 0, updated: 0 });
    expect(episodeCopies(LIST, 'nope', 1)).toEqual([{ hash: 'nope', fileIndex: 1 }]);
  });
});
