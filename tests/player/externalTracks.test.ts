import { describe, it, expect } from 'vitest';
import { chosenTracks, externalTracksForItem, externalTracksForQueue, seriesPatchFor } from '../../src/player/externalTracks';
import { tracksForVideo } from '../../src/lib/externalTracks';
import type { TorrentFile } from '../../src/lib/episodes';

const list = (paths: string[]): TorrentFile[] => paths.map((path, i) => ({ id: i, path, length: 1 }));
const c = { streamUrl: (hash: string, i: number, name = 'file') => 'http://ts:8090/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + i + '&play' };
const S = { audioLang: 'ru', subLang: 'ru', subtitlesOn: false };
const FILES = list([
  'S/Show.S01E01.mkv',
  'S/Show.S01E02.mkv',
  'S/Rus Sound/LostFilm/Show.S01E01.mka',
  'S/Rus Sound/LostFilm/Show.S01E02.mka',
  'S/Rus Subs/Show.S01E01.forced.srt',
]);

describe('externalTracksForItem', () => {
  it('stream uris of the files, language, name, mime and the start choice', () => {
    const item = externalTracksForItem(c, 'abc', tracksForVideo(FILES, 0), 0, null, S);
    expect(item).toEqual({
      fileIndex: 0,
      audio: [{ id: 'a:rus:lostfilm', uri: 'http://ts:8090/stream/Show.S01E01.mka?link=abc&index=2&play', lang: 'rus', name: 'LostFilm', mime: 'audio/x-matroska' }],
      subtitles: [{ id: 's:rus::forced', uri: 'http://ts:8090/stream/Show.S01E01.forced.srt?link=abc&index=4&play', lang: 'rus', name: 'Forced', mime: 'application/x-subrip', forced: true }],
      startAudio: 'a:rus:lostfilm',
      startSubtitle: null,
    });
  });

  it('every item of the queue gets its own files', () => {
    const q = externalTracksForQueue(c, 'abc', FILES, [0, 1], null, S);
    expect(q.map((x) => x.audio.map((a) => a.uri))).toEqual([
      ['http://ts:8090/stream/Show.S01E01.mka?link=abc&index=2&play'],
      ['http://ts:8090/stream/Show.S01E02.mka?link=abc&index=3&play'],
    ]);
    expect(q[1].subtitles).toEqual([]);
    expect(externalTracksForQueue(c, 'abc', FILES, [42], null, S)[0].audio).toEqual([]);
  });
});

describe('reading the choice back', () => {
  const q = externalTracksForQueue(c, 'abc', FILES, [0, 1], null, S);

  it('only ids of that item count', () => {
    const ch = chosenTracks(q, { fileIndex: 1, audioId: 'a:rus:lostfilm', subtitleId: 's:rus::forced' });
    expect(ch && ch.item.fileIndex).toBe(1);
    expect(ch && ch.audio && ch.audio.uri).toContain('index=3');
    // episode 2 has no such subtitles: the player did not say
    expect(ch && 'subtitle' in ch).toBe(false);
    expect(chosenTracks(q, { fileIndex: 7 })).toBeNull();
  });

  it('the series record: studio + language, subtitles by name or off; embedded choices keep nothing', () => {
    expect(seriesPatchFor(chosenTracks(q, { fileIndex: 0, audioId: 'a:rus:lostfilm', subtitleId: 's:rus::forced' }))).toEqual({
      l: 'LostFilm',
      g: 'ru',
      s: { l: 'Forced', g: 'ru' },
    });
    expect(seriesPatchFor(chosenTracks(q, { fileIndex: 0, subtitleId: 'off' }))).toEqual({ s: 'off' });
    expect(seriesPatchFor(chosenTracks(q, { fileIndex: 0, audioId: null, subtitleId: null }))).toBeNull();
    expect(seriesPatchFor(null)).toBeNull();
  });
});
