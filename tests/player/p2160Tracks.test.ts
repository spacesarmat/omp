import { describe, it, expect, beforeEach, vi } from 'vitest';

const remembered: { hash: string; patch: unknown }[] = [];
vi.mock('../../src/store/seriesTracks', () => ({
  seriesTracksFor: () => null,
  rememberSeriesTracks: (_c: unknown, hash: string, patch: unknown) => {
    remembered.push({ hash, patch });
    return Promise.resolve();
  },
}));

import { ensureQueueFiles, play2160, queueExternalTracks, sanitizeP2160 } from '../../src/player/player2160';
import { knownFiles, rememberFiles, resetKnownFilesForTests } from '../../src/lib/knownFiles';
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
  'S/Rus Sound/HDRezka/Show.S01E01.mka',
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
  resetKnownFilesForTests();
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
    expect(JSON.parse(audio[0])).toContainEqual(
      { uri: streamUrl(H, 2, 'Show.S01E01.mka'), id: 'a:rus:lostfilm', language: 'rus', name: 'LostFilm', mime: 'audio/x-matroska' },
    );
    expect(JSON.parse(audio[0]).length).toBe(2);
    expect(JSON.parse(audio[1])[0].uri).toContain('index=3');
    const text = e[P2160_TRACKS.textTracks] as string[];
    expect(JSON.parse(text[0])[0]).toEqual({ uri: streamUrl(H, 4, 'Show.S01E01.srt'), id: 's:rus:', language: 'rus', mime: 'application/x-subrip' });
    expect(text[1]).toBe('[]');
    expect(e[P2160_TRACKS.audioSelect]).toBe('id:' + items[0].startAudio);
    expect(e[P2160_TRACKS.textSelect]).toBe('id:s:rus:');
  });

  it('subtitles: the player own default unless chosen; «off» only when the item has some; nothing without tracks', () => {
    expect(p2160TrackExtras(externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, S), 0)[P2160_TRACKS.textSelect]).toBeUndefined();
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], { at: 1, s: 'off' }, { ...S, subtitlesOn: true });
    expect(p2160TrackExtras(items, 0)[P2160_TRACKS.textSelect]).toBe('off');
    expect(p2160TrackExtras(items, 1)[P2160_TRACKS.textSelect]).toBeUndefined();
    expect(p2160TrackExtras(externalTracksForQueue({ streamUrl }, H, list(['a.mkv']), [0], null, S), 0)).toEqual({});
  });

  it('the final 0.2.17 track object: uri required, no delayMs or select from OMP, charset only on subtitles', () => {
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, { ...S, subtitlesOn: true });
    items[0].audio[0] = { ...items[0].audio[0] };
    (items[0].audio[0] as any).charset = 'windows-1251';
    items[0].subtitles[0] = { ...items[0].subtitles[0], charset: 'windows-1251' };
    const e = p2160TrackExtras(items, 0);
    const allowed = ['uri', 'language', 'name', 'mime', 'id', 'charset'];
    const audio = ([] as any[]).concat(...(e[P2160_TRACKS.audioTracks] as string[]).map((x) => JSON.parse(x)));
    const text = ([] as any[]).concat(...(e[P2160_TRACKS.textTracks] as string[]).map((x) => JSON.parse(x)));
    for (const t of audio.concat(text)) {
      expect(typeof t.uri).toBe('string');
      expect(Object.keys(t).every((f) => allowed.indexOf(f) >= 0)).toBe(true);
    }
    expect(audio.some((t) => 'charset' in t)).toBe(false);
    expect(text[0].charset).toBe('windows-1251');
    // the select values are the player's «id:<id>» (the id may itself hold colons) and «off»
    expect(P2160_TRACKS.selectId).toBe('id:');
    expect(P2160_TRACKS.selectOff).toBe('off');
    expect(/^id:a:rus:/.test(e[P2160_TRACKS.audioSelect] as string)).toBe(true);
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

  it('reads the result as 2160 Player 0.2.17 builds it (IntentApi.buildResult)', () => {
    // external dub, embedded subtitles
    expect(p2160TrackResult({
      [k.audioId]: 'a:rus:lostfilm', [k.audioName]: 'LostFilm', [k.audioLang]: 'rus', [k.audioExternal]: true,
      [k.audioEmbeddedIndex]: -1, [k.audioExternalIndex]: 0, [k.textOff]: false,
      [k.textId]: 'Full', [k.textName]: 'Full', [k.textLang]: 'eng', [k.textExternal]: false, [k.textEmbeddedIndex]: 0, [k.textExternalIndex]: -1,
    }, 0)).toEqual({ fileIndex: 0, audioId: 'a:rus:lostfilm', subtitleId: null, subtitleName: 'Full', subtitleLang: 'eng' });
    // embedded dub: its AUDIO_ID is the name or «embedded:<n>», never one of OMP's ids; subtitles off: no TEXT_* but TEXT_OFF
    expect(p2160TrackResult({
      [k.audioId]: 'embedded:1', [k.audioLang]: 'rus', [k.audioExternal]: false, [k.audioEmbeddedIndex]: 1, [k.audioExternalIndex]: -1, [k.textOff]: true,
    })).toEqual({ audioId: null, audioLang: 'rus', subtitleId: 'off' });
    // no subtitles at all: TEXT_OFF false and no TEXT_ID, nothing said
    expect(p2160TrackResult({ [k.textOff]: false })).toEqual({});
  });

  it('the series patch: a change by hand, never OMP own pick; codec-only titles out; unchanged parts dropped', () => {
    const items = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, S);
    const picked = items[0].startAudio as string;
    const other = items[0].audio.filter((a) => a.id !== picked)[0];
    // OMP asked for this one (a fallback, say): no new choice
    expect(seriesPatchFromResult(items, { fileIndex: 0, audioId: picked }, { at: 1, l: 'Kubik', g: 'ru' }, items[0])).toBeNull();
    expect(seriesPatchFromResult(items, { fileIndex: 0, audioId: other.id }, null, items[0])).toEqual({ l: other.name, g: 'ru' });
    // the next episode carried the start choice: still OMP own
    expect(seriesPatchFromResult(items, { fileIndex: 1, audioId: 'a:rus:lostfilm' }, null, items[0])).toBeNull();
    // embedded after OMP asked for an external dub: by hand
    expect(seriesPatchFromResult(items, { fileIndex: 0, audioId: null, audioName: 'HDrezka Studio', audioLang: 'rus' }, null, items[0])).toEqual({ l: 'HDrezka Studio', g: 'ru' });
    expect(seriesPatchFromResult(items, { fileIndex: 0, audioId: null, audioName: 'AC3 5.1', audioLang: 'ru' }, null, items[0])).toBeNull();
    // nothing external asked: an embedded track may be the player own default
    const bare = externalTracksForQueue({ streamUrl }, H, list(['a.mkv']), [0], null, S);
    expect(seriesPatchFromResult(bare, { fileIndex: 0, audioId: null, audioName: 'HDrezka Studio', audioLang: 'ru', subtitleId: 'off' }, null, bare[0])).toBeNull();
    // subtitles turned off by hand after OMP asked for external ones; unchanged parts dropped
    const subs = externalTracksForQueue({ streamUrl }, H, FILES, [0, 1], null, { ...S, subtitlesOn: true });
    expect(seriesPatchFromResult(subs, { fileIndex: 0, audioId: other.id, subtitleId: 'off' }, { at: 1, l: other.name, g: 'ru' }, subs[0])).toEqual({ s: 'off' });
    expect(seriesPatchFromResult(subs, { fileIndex: 0, subtitleId: 'off' }, { at: 1, s: 'off' }, subs[0])).toBeNull();
  });

  it('a nameless external subtitle (no studio, no language) is kept by its id', () => {
    const files = list(['S/Show.S01E01.mkv', 'S/Show.S01E02.mkv', 'S/Subs/Show.S01E01.ass', 'S/Subs/Show.S01E02.ass']);
    const items = externalTracksForQueue({ streamUrl }, H, files, [0, 1], null, S);
    const sub = items[0].subtitles[0];
    expect(sub.name).toBe('');
    expect(sub.lang).toBe('und');
    const res = p2160TrackResult({ [P2160_TRACKS.result.textExternal]: true, [P2160_TRACKS.result.textId]: sub.id }, 0);
    expect(seriesPatchFromResult(items, res, null, items[0])).toEqual({ s: { l: '', g: '', i: 's:und:' } });
    // the second of two nameless files keeps its «#2»
    const two = externalTracksForQueue({ streamUrl }, H, list(['S/Show.S01E01.mkv', 'S/Show.S01E01.srt', 'S/Show.S01E01.ass']), [0], null, S);
    const res2 = p2160TrackResult({ [P2160_TRACKS.result.textExternal]: true, [P2160_TRACKS.result.textId]: 's:und:#2' }, 0);
    expect(two[0].subtitles.map((x) => x.id)).toEqual(['s:und:', 's:und:#2']);
    expect(seriesPatchFromResult(two, res2, null, two[0])).toEqual({ s: { l: '', g: '', i: 's:und:#2' } });
    // the same choice again: nothing new
    expect(seriesPatchFromResult(items, res, { at: 1, s: { l: '', g: '', i: 's:und:' } }, items[0])).toBeNull();
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
    const startId = queueExternalTracks(c as any, queue, S)[0].startAudio;
    const otherId = startId === 'a:rus:lostfilm' ? 'a:rus:hdrezka' : 'a:rus:lostfilm';
    const plugin = {
      open2160: (o: unknown) => {
        sent = o;
        return Promise.resolve({ returned: true, positionMs: 600000, durationMs: 2400000, url: queue[0].url, extras: { [P2160_TRACKS.result.audioExternal]: true, [P2160_TRACKS.result.audioId]: otherId } });
      },
    };
    await play2160(plugin, c as any, queue, 0, 0, null, 0);
    expect(sent.resultKeys).toEqual(P2160_RESULT_KEYS);
    const audio = sent.extras[P2160_TRACKS.audioTracks] as string[];
    expect(JSON.parse(audio[0]).map((a: any) => a.uri)).toContain('http://u:p@ts:8090/stream/Show.S01E01.mka?link=' + H + '&index=2&play');
    expect(sent.extras[P2160_TRACKS.audioSelect]).toBe('id:' + startId);
    expect(c.preloaded).toEqual([startId === 'a:rus:lostfilm' ? 2 : 5]);
    expect(remembered).toEqual([{ hash: H, patch: { l: otherId === 'a:rus:lostfilm' ? 'LostFilm' : 'HDRezka', g: 'ru' } }]);
  });

  it('a release just added (the add answer in the library, no files yet): its files are asked for, the tracks go', async () => {
    const c: any = client();
    // TorrServerClient.files: file_stats, else data, else knownFiles
    c.files = (t: any) => (t.file_stats && t.file_stats.length ? t.file_stats : knownFiles(t.hash));
    const asked: string[] = [];
    c.get = (h: string) => {
      asked.push(h);
      rememberFiles(h, FILES);
      return Promise.resolve({ hash: h, title: 'Show S01', stat: 3, file_stats: FILES });
    };
    torrents.value = [{ hash: H, title: 'Show S01', stat: 1, data: '{"omp":{"ts":{"s":38}}}' }];
    expect(queueExternalTracks(c, queue, S).every((x) => !x.audio.length)).toBe(true);
    let sent: any = null;
    await play2160({ open2160: (o: unknown) => { sent = o; return Promise.resolve({ returned: false }); } }, c, queue, 0, 0, null, 0);
    expect(asked).toEqual([H]);
    const audio = sent.extras[P2160_TRACKS.audioTracks] as string[];
    expect(audio.length).toBe(2);
    expect(JSON.parse(audio[0]).length).toBe(2);
    expect(JSON.parse((sent.extras[P2160_TRACKS.textTracks] as string[])[0])[0].uri).toContain('index=4');
  });

  it('a screen left while the files are asked for opens no player', async () => {
    const c: any = client();
    c.files = () => [];
    c.get = () => Promise.resolve({ hash: H, title: 'X', stat: 1 });
    torrents.value = [{ hash: H, title: 'X', stat: 1 }];
    let opened = 0;
    const saved = await play2160({ open2160: () => { opened++; return Promise.resolve({ returned: false }); } }, c, queue, 0, 0, null, 0, () => true);
    expect(saved).toBeNull();
    expect(opened).toBe(0);
    // and the next launch is not blocked
    await play2160({ open2160: () => { opened++; return Promise.resolve({ returned: false }); } }, c, queue, 0, 0, null, 0);
    expect(opened).toBe(1);
  });

  it('files known: nothing is asked; a server that does not answer only delays the launch', async () => {
    const c: any = client();
    let asked = 0;
    c.get = () => {
      asked++;
      return new Promise(() => undefined);
    };
    await ensureQueueFiles(c, queue, 10);
    expect(asked).toBe(0);
    c.files = () => [];
    torrents.value = [{ hash: H, title: 'X', stat: 1 }];
    await ensureQueueFiles(c, queue, 10);
    expect(asked).toBe(1);
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
