import { describe, it, expect, beforeEach, vi } from 'vitest';

const remembered: { hash: string; patch: unknown }[] = [];
vi.mock('../../src/store/seriesTracks', () => ({
  seriesTracksFor: () => null,
  rememberSeriesTracks: (_c: unknown, hash: string, patch: unknown) => {
    remembered.push({ hash, patch });
    return Promise.resolve();
  },
}));

import { play2160, queueExternalTracks, sanitizeP2160 } from '../../src/player/player2160';
import {
  externalTracksForQueue,
  p2160TrackExtras,
  p2160TrackResult,
  seriesPatchFromResult,
  P2160_RESULT_KEYS,
  P2160_TRACKS,
} from '../../src/player/externalTracks';
import { torrents } from '../../src/store/library';
import { reloadProgress } from '../../src/store/progress';
import type { TorrentFile } from '../../src/lib/episodes';
import type { PlayItem } from '../../src/player/types';

const H = 'd'.repeat(40);
const list = (paths: string[]): TorrentFile[] => paths.map((path, i) => ({ id: i, path, length: 1 }));
const FILES = list([
  'S/Show.S01E01.mkv',
  'S/Show.S01E02.mkv',
  'S/Rus Sound/LostFilm/Show.S01E01.mka',
  'S/Rus Sound/LostFilm/Show.S01E02.mka',
  'S/Rus Subs/Show.S01E01.srt',
]);
const streamUrl = (hash: string, i: number, name = 'file') => 'http://ts:8090/stream/' + encodeURIComponent(name) + '?link=' + hash + '&index=' + i + '&play';
const S = { audioLang: 'ru', subLang: 'ru', subtitlesOn: false };
const queue: PlayItem[] = [
  { url: streamUrl(H, 0, 'Show.S01E01.mkv'), title: 'S01E01', hash: H, fileIndex: 0 },
  { url: streamUrl(H, 1, 'Show.S01E02.mkv'), title: 'S01E02', hash: H, fileIndex: 1 },
];

function client() {
  const preloaded: number[] = [];
  return {
    preloaded,
    streamUrl,
    videoSrc: (u: string) => u.replace('http://', 'http://u:p@'),
    files: () => FILES,
    preload: (_h: string, i: number) => {
      preloaded.push(i);
      return Promise.resolve();
    },
    setViewed: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    setData: () => Promise.resolve(),
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  remembered.length = 0;
  torrents.value = [{ hash: H, title: 'Show S01', stat: 3, file_stats: FILES }];
});

describe('the Intent extras (2160 Player API §3.7)', () => {
  it('per-item JSON arrays and the start choice under the keys of P2160_TRACKS', () => {
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, { ...S, subtitlesOn: true });
    const e = p2160TrackExtras(items, 0);
    const audio = e[P2160_TRACKS.audioTracks] as string[];
    expect(audio.length).toBe(2);
    expect(JSON.parse(audio[0])).toEqual([
      { uri: streamUrl(H, 2, 'Show.S01E01.mka'), id: 'a:rus:lostfilm', language: 'rus', name: 'LostFilm', mime: 'audio/x-matroska' },
    ]);
    expect(JSON.parse(audio[1])[0].uri).toContain('index=3');
    const text = e[P2160_TRACKS.textTracks] as string[];
    expect(JSON.parse(text[0])[0]).toEqual({ uri: streamUrl(H, 4, 'Show.S01E01.srt'), id: 's:rus:', language: 'rus', mime: 'application/x-subrip' });
    expect(text[1]).toBe('[]');
    expect(e[P2160_TRACKS.audioSelect]).toBe('id:a:rus:lostfilm');
    expect(e[P2160_TRACKS.textSelect]).toBe('id:s:rus:');
  });

  it('subtitles: the player own default unless chosen; «off» only when the item has some; nothing without tracks', () => {
    expect(p2160TrackExtras(externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, S), 0)[P2160_TRACKS.textSelect]).toBeUndefined();
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], { at: 1, s: 'off' }, { ...S, subtitlesOn: true });
    expect(p2160TrackExtras(items, 0)[P2160_TRACKS.textSelect]).toBe('off');
    expect(p2160TrackExtras(items, 1)[P2160_TRACKS.textSelect]).toBeUndefined();
    expect(p2160TrackExtras(externalTracksForQueue({ streamUrl }, H, list(['a.mkv']), [0], null, S), 0)).toEqual({});
  });

  it('result keys are the ones of P2160_TRACKS.result', () => {
    expect(P2160_RESULT_KEYS).toContain('tv.p2160.extra.AUDIO_ID');
    expect(P2160_RESULT_KEYS).toContain('tv.p2160.extra.TEXT_OFF');
    expect(P2160_RESULT_KEYS.length).toBe(13);
  });
});

describe('reading the result', () => {
  const k = P2160_TRACKS.result;
  it('external by id, embedded by name and language, off, and nothing from an older player', () => {
    expect(p2160TrackResult({ [k.audioExternal]: true, [k.audioId]: 'a:rus:lostfilm', [k.textOff]: true }, 3)).toEqual({ fileIndex: 3, audioId: 'a:rus:lostfilm', subtitleId: 'off' });
    expect(p2160TrackResult({ [k.audioExternal]: false, [k.audioName]: 'HDrezka Studio', [k.audioLang]: 'ru', [k.textExternal]: false, [k.textName]: 'Full', [k.textLang]: 'en', [k.textOff]: false })).toEqual({
      audioId: null, audioName: 'HDrezka Studio', audioLang: 'ru', subtitleId: null, subtitleName: 'Full', subtitleLang: 'en',
    });
    expect(p2160TrackResult({})).toEqual({});
    expect(p2160TrackResult(null)).toEqual({});
  });

  it('the series patch: external choice, embedded dub, codec-only titles kept out, unchanged parts dropped', () => {
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, S);
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: 'a:rus:lostfilm' }, null)).toEqual({ l: 'LostFilm', g: 'ru' });
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: null, audioName: 'HDrezka Studio', audioLang: 'rus' }, null)).toEqual({ l: 'HDrezka Studio', g: 'ru' });
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: null, audioName: 'AC3 5.1', audioLang: 'ru' }, null)).toBeNull();
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: 'a:rus:lostfilm', subtitleId: 'off' }, { at: 1, l: 'LostFilm', g: 'ru', s: 'off' })).toBeNull();
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: 'a:rus:lostfilm', subtitleId: 'off' }, { at: 1, l: 'LostFilm', g: 'ru' })).toEqual({ s: 'off' });
  });

  it('sanitizeP2160 keeps only the asked result keys with plain values, and is idempotent', () => {
    const r = sanitizeP2160({ returned: true, positionMs: 1, extras: { [k.audioId]: 'x', [k.textOff]: true, other: 'y', [k.audioName]: { a: 1 } } });
    expect(r.extras).toEqual({ [k.audioId]: 'x', [k.textOff]: true });
    expect(sanitizeP2160(r)).toEqual(r);
    expect(sanitizeP2160({ returned: true, extras: { other: 1 } }).extras).toBeUndefined();
  });
});

describe('play2160 with external tracks', () => {
  it('uris carry the credentials, extras and result keys go to the plugin, the start dub is preloaded, the choice is kept', async () => {
    const c = client();
    let sent: any = null;
    const plugin = {
      open2160: (o: unknown) => {
        sent = o;
        return Promise.resolve({ returned: true, positionMs: 600000, durationMs: 2400000, url: queue[1].url, extras: { [P2160_TRACKS.result.audioExternal]: true, [P2160_TRACKS.result.audioId]: 'a:rus:lostfilm' } });
      },
    };
    await play2160(plugin, c as any, queue, 0, 0, null, 0);
    expect(sent.resultKeys).toEqual(P2160_RESULT_KEYS);
    const audio = sent.extras[P2160_TRACKS.audioTracks] as string[];
    expect(JSON.parse(audio[0])[0].uri).toBe('http://u:p@ts:8090/stream/Show.S01E01.mka?link=' + H + '&index=2&play');
    expect(sent.extras[P2160_TRACKS.audioSelect]).toBe('id:a:rus:lostfilm');
    expect(c.preloaded).toEqual([2]);
    expect(remembered).toEqual([{ hash: H, patch: { l: 'LostFilm', g: 'ru' } }]);
  });

  it('a release without external tracks launches as before', async () => {
    const c = client();
    c.files = () => list(['a.mkv', 'b.mkv']);
    torrents.value = [{ hash: H, title: 'X', stat: 3, file_stats: list(['a.mkv', 'b.mkv']) }];
    let sent: any = null;
    await play2160({ open2160: (o: unknown) => { sent = o; return Promise.resolve({ returned: false }); } }, c as any, queue, 0, 0, null, 0);
    expect(sent.extras).toBeUndefined();
    expect(c.preloaded).toEqual([]);
    expect(queueExternalTracks(c as any, queue, S).every((x) => !x.audio.length)).toBe(true);
  });
});
