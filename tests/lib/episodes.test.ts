import { describe, it, expect } from 'vitest';
import {
  extOf, baseName, stripExt, fileKind, parseEpisode, episodeLabel, naturalCompare,
  groupBySeason, playableFiles, matchSubtitles, subtitleLabel, TorrentFile,
} from '../../src/lib/episodes';

const f = (id: number, path: string): TorrentFile => ({ id, path, length: 100 });

describe('path helpers', () => {
  it('extOf/baseName/stripExt', () => {
    expect(extOf('a/b/Movie.MKV')).toBe('mkv');
    expect(extOf('noext')).toBe('');
    expect(baseName('a/b/c.mkv')).toBe('c.mkv');
    expect(stripExt('c.rus.srt')).toBe('c.rus');
  });
  it('fileKind', () => {
    expect(fileKind('x.mkv')).toBe('video');
    expect(fileKind('x.m2ts')).toBe('video');
    expect(fileKind('x.flac')).toBe('audio');
    expect(fileKind('x.srt')).toBe('subtitle');
    expect(fileKind('x.ass')).toBe('subtitle');
    expect(fileKind('x.m3u8')).toBe('playlist');
    expect(fileKind('x.nfo')).toBe('other');
  });
});

describe('parseEpisode', () => {
  it('SxxEyy', () => expect(parseEpisode('Show/Show.S04E01.1080p.mkv')).toEqual({ season: 4, episode: 1 }));
  it('s1.e2 with separator', () => expect(parseEpisode('show.s01.e12.mkv')).toEqual({ season: 1, episode: 12 }));
  it('1x05', () => expect(parseEpisode('Show 1x05 Title.avi')).toEqual({ season: 1, episode: 5 }));
  it('season folder + leading number', () => expect(parseEpisode('Show/Season 2/03. Title.mkv')).toEqual({ season: 2, episode: 3 }));
  it('russian folders', () => expect(parseEpisode('Сезон 3/Серия 7.avi')).toEqual({ season: 3, episode: 7 }));
  it('movie has none', () => expect(parseEpisode('Movie.2021.1080p.mkv')).toEqual({ season: null, episode: null }));
  it('episodeLabel', () => {
    expect(episodeLabel('Show.S04E01.mkv')).toBe('S04E01');
    expect(episodeLabel('Movie.2021.mkv')).toBe('');
  });
});

describe('naturalCompare', () => {
  it('orders numbers naturally', () => {
    expect(['ep10', 'ep2', 'ep1'].sort(naturalCompare)).toEqual(['ep1', 'ep2', 'ep10']);
  });
});

describe('groupBySeason', () => {
  it('groups and sorts', () => {
    const groups = groupBySeason([
      f(1, 'S/Show.S02E01.mkv'), f(2, 'S/Show.S01E02.mkv'), f(3, 'S/Show.S01E01.mkv'),
    ]);
    expect(groups.map((g) => g.season)).toEqual([1, 2]);
    expect(groups[0].files.map((x) => x.id)).toEqual([3, 2]);
    expect(groups[1].files.map((x) => x.id)).toEqual([1]);
  });
  it('puts unknown season last', () => {
    const groups = groupBySeason([f(1, 'extra.mkv'), f(2, 'Show.S01E01.mkv')]);
    expect(groups.map((g) => g.season)).toEqual([1, null]);
  });
});

describe('playableFiles', () => {
  it('prefers video', () => {
    const r = playableFiles([f(1, 'a.mp3'), f(2, 'b.S01E02.mkv'), f(3, 'b.S01E01.mkv'), f(4, 'b.srt')]);
    expect(r.map((x) => x.id)).toEqual([3, 2]);
  });
  it('falls back to audio', () => {
    const r = playableFiles([f(1, '02 b.mp3'), f(2, '01 a.mp3'), f(3, 'cover.jpg')]);
    expect(r.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe('subtitles matching', () => {
  const video = f(1, 'Show/Show.S01E01.mkv');
  const subs = [f(2, 'Show/Show.S01E01.rus.srt'), f(3, 'Show/Show.S01E02.rus.srt'), f(4, 'Show/Subs/Eng/Show.S01E01.srt')];
  it('matches by base name prefix', () => {
    expect(matchSubtitles(video, subs).map((s) => s.id)).toEqual([2, 4]);
  });
  it('movie without matches gets all subs', () => {
    const movie = f(1, 'Movie/Movie.2020.mkv');
    const ms = [f(2, 'Movie/Subs/rus.srt'), f(3, 'Movie/Subs/eng.srt')];
    expect(matchSubtitles(movie, ms).map((s) => s.id)).toEqual([2, 3]);
  });
  it('episode without matches gets none', () => {
    expect(matchSubtitles(f(9, 'Show.S05E05.mkv'), subs)).toEqual([]);
  });
  it('labels', () => {
    expect(subtitleLabel(subs[0], video)).toBe('rus');
    expect(subtitleLabel(subs[2], video)).toBe('Eng');
    expect(subtitleLabel(f(5, 'rus.srt'), f(1, 'Movie.mkv'))).toBe('rus');
  });
});
