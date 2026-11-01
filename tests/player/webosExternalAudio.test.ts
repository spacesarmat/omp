import { describe, it, expect } from 'vitest';
import { releaseTracks } from '../../src/lib/externalTracks';
import type { TorrentFile } from '../../src/lib/episodes';
import type { TrackOption } from '../../src/player/trackOptions';
import {
  dubStreamUrl, episodeExternalAudio, externalAudioLabel, mergeWebosAudio, webosAudioIndex, webosExternalBlocked,
  webosMayPlayDub, webosSeriesAudioPatch,
} from '../../src/player/webosExternalAudio';

const f = (id: number, path: string): TorrentFile => ({ id, path, length: 1000 });

const FILES: TorrentFile[] = [
  f(1, 'Show/Show.S01E01.mkv'),
  f(2, 'Show/Show.S01E02.mkv'),
  f(3, 'Show/Rus Sound/LostFilm/Show.S01E01.mka'),
  f(4, 'Show/Rus Sound/LostFilm/Show.S01E02.mka'),
  f(5, 'Show/Rus Sound/HDRezka/Show.S01E01.ac3'),
  f(10, 'Show/DTS/Show.S01E01.dts'),
];

const builtin: TrackOption[] = [
  { label: 'RU · AC3 5.1 · Дубляж', language: 'ru', isDefault: true, title: 'Дубляж' },
  { label: 'EN · AAC 2.0', language: 'en', isDefault: false },
];

describe('webOS external dub list', () => {
  it('puts the episode dubs after the built-in rows, with the stable id', () => {
    const ext = episodeExternalAudio(FILES, 1);
    const lost = ext.filter((t) => t.id === 'a:rus:lostfilm')[0];
    const rezka = ext.filter((t) => t.id === 'a:rus:hdrezka')[0];
    expect(lost && rezka).toBeTruthy();
    const list = mergeWebosAudio(builtin, ext, (t) => 'http://srv/' + t.file.id);
    // built-in rows stay a prefix, so their index is the <video> track index
    expect(list[0].externalId).toBeUndefined();
    expect(list[1].externalId).toBeUndefined();
    const i = list.findIndex((o) => o.externalId === 'a:rus:lostfilm');
    expect(i).toBe(builtin.length + ext.findIndex((t) => t.id === 'a:rus:lostfilm'));
    expect(list[i].label).toBe('RU · MKA · LostFilm');
    expect(list[i].title).toBe('LostFilm');
    expect(list[i].language).toBe('ru');
    expect(list[i].externalUrl).toBe('http://srv/3');
    expect(externalAudioLabel(lost)).toBe('RU · MKA · LostFilm');
    // the next episode carries the same id
    expect(episodeExternalAudio(FILES, 2).some((t) => t.id === 'a:rus:lostfilm')).toBe(true);
  });

  it('starts on the external dub the series remembers, and on the built-in index when that was the choice', () => {
    const ext = episodeExternalAudio(FILES, 1);
    const list = mergeWebosAudio(builtin, ext, () => '');
    const lost = list.findIndex((o) => o.externalId === 'a:rus:lostfilm');
    expect(webosAudioIndex(builtin, ext, { at: 1, l: 'LostFilm', g: 'ru' }, null, 'en')).toBe(lost);
    expect(webosAudioIndex(builtin, ext, { at: 1, l: 'Дубляж', g: 'ru' }, null, 'en')).toBe(0);
    expect(webosAudioIndex(builtin, ext, { at: 1, l: 'Дубляж', g: 'ru', e: 0 }, null, 'en')).toBe(0);
    // the video already has Russian, so the settings language stays on that built-in row
    expect(webosAudioIndex(builtin, ext, null, null, 'ru')).toBe(0);
    expect(webosAudioIndex(builtin, ext, null, { audioLabel: 'RU · MKA · LostFilm', audioLang: 'ru' }, 'en')).toBe(lost);
    // a built-in index that does not match this file does not block the external dub
    const onlyEn: TrackOption[] = [{ label: 'EN · AAC 2.0', language: 'en', isDefault: true }];
    const enList = mergeWebosAudio(onlyEn, ext, () => '');
    const enLost = enList.findIndex((o) => o.externalId === 'a:rus:lostfilm');
    expect(webosAudioIndex(onlyEn, ext, { at: 1, l: 'LostFilm', g: 'ru', e: 0 }, null, 'en')).toBe(enLost);
  });

  it('remembers an external choice without a built-in index, and a built-in choice with one', () => {
    const list = mergeWebosAudio(builtin, episodeExternalAudio(FILES, 1), () => 'u');
    const lost = list.findIndex((o) => o.externalId === 'a:rus:lostfilm');
    const patch = webosSeriesAudioPatch(list, lost);
    expect(patch.l).toBe('LostFilm');
    expect(patch.g).toBe('ru');
    expect(patch).not.toHaveProperty('e');
    expect(patch.k.some((s) => s.l === 'LostFilm' && s.g === 'ru')).toBe(true);
    expect(webosSeriesAudioPatch(list, 0)).toMatchObject({ l: 'Дубляж', g: 'ru', e: 0 });
  });

  it('builds the stream url the same way as the video, credentials included', () => {
    const t = episodeExternalAudio(FILES, 1).filter((x) => x.id === 'a:rus:lostfilm')[0];
    const c = {
      streamUrl: (h: string, i: number, n?: string) => 'http://srv/stream/' + (n || '') + '?link=' + h + '&index=' + i + '&play',
      videoSrc: (u: string) => u.replace('http://', 'http://user:pw@'),
    };
    expect(dubStreamUrl(c, 'abc', t)).toBe('http://user:pw@srv/stream/Show.S01E01.mka?link=abc&index=3&play');
  });

  it('warns only when every external dub is a container the TV will not open', () => {
    expect(webosMayPlayDub('mka')).toBe(true);
    expect(webosMayPlayDub('AC3')).toBe(true);
    expect(webosMayPlayDub('dts')).toBe(false);
    expect(webosMayPlayDub('flac')).toBe(false);
    expect(webosExternalBlocked(FILES)).toBe(false);
    const dtsOnly = [f(1, 'Show/Show.S01E01.mkv'), f(2, 'Show/DTS/Show.S01E01.dts'), f(3, 'Show/DTS/Show.S01E01.flac')];
    expect(webosExternalBlocked(dtsOnly)).toBe(true);
    expect(releaseTracks(dtsOnly).audio.length).toBe(2);
    expect(webosExternalBlocked([f(1, 'Show/Show.S01E01.mkv')])).toBe(false);
  });
});
