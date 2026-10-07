import { describe, it, expect } from 'vitest';
import {
  sanitizeSeriesTracks, seriesTracksOf, newestSeriesTracks, nextSeriesTracks, isReset, sameDub, normDub, dubOf, findDub,
  seenDubs, withSeriesTracks, isCodecLabel, torrentChoicesCount,
} from '../../src/lib/seriesTracks';
import { serializeData, parseData, withWatch } from '../../src/lib/journal';

const data = (a: unknown, extra: object = {}) => JSON.stringify({ ...extra, omp: { v: 1, h: [], a } });

describe('dub labels', () => {
  it('normalise case, spacing, punctuation and the yo letter', () => {
    expect(normDub('  HDrezka   Studio ')).toBe('hdrezka studio');
    expect(normDub('MVO | LostFilm')).toBe('mvo lostfilm');
    expect(normDub('Ёлки-Палки')).toBe(normDub('елки палки'));
  });

  it('match equal labels or a whole-word part of a longer one', () => {
    expect(sameDub('LostFilm', 'lostfilm')).toBe(true);
    expect(sameDub('LostFilm', 'MVO | LostFilm')).toBe(true);
    expect(sameDub('HDrezka Studio', 'hdrezka studio (18+)')).toBe(true);
    expect(sameDub('Lost', 'LostFilm')).toBe(false);
    expect(sameDub('ru', 'ru LostFilm')).toBe(false);
    expect(sameDub('', 'LostFilm')).toBe(false);
    expect(sameDub('NewStudio', 'LostFilm')).toBe(false);
  });

  it('take the dub from the title, else the label without language and codec parts', () => {
    expect(dubOf({ title: 'LostFilm', label: 'RU · AC3 2.0 · LostFilm' })).toBe('LostFilm');
    expect(dubOf({ label: 'Русский · LostFilm · AC3 2.0' })).toBe('LostFilm');
    expect(dubOf({ label: 'RU · AC3 2.0 · HDrezka Studio' })).toBe('HDrezka Studio');
    expect(dubOf({ label: 'EN · DTS 5.1' })).toBe('');
    expect(dubOf({ label: 'Dub (ru)' })).toBe('Dub');
  });

  it('a codec or format name is never a dub or subtitle title', () => {
    ['SUBRIP', 'srt', 'ASS', 'SSA', 'PGS', 'HDMV_PGS_SUBTITLE', 'VobSub', 'dvd_subtitle', 'WEBVTT', 'TX3G', 'MOV_TEXT', 'DVB_SUB',
      'dvb_subtitle', 'PCM_S16LE 2.0', 'PCM_S24LE', 'AC3 5.1', 'E-AC3', 'DTS-HD MA', 'TrueHD Atmos 7.1', 'AAC stereo', 'FLAC']
      .forEach((s) => expect(isCodecLabel(s)).toBe(true));
    ['LostFilm', 'Forced', 'Надписи', 'HDrezka Studio', ''].forEach((s) => expect(isCodecLabel(s)).toBe(false));
    // untitled tracks: the describeTrack label leaves nothing
    expect(dubOf({ label: 'RU · SUBRIP' })).toBe('');
    expect(dubOf({ label: 'RU · PCM_S16LE 2.0' })).toBe('');
    expect(dubOf({ label: 'EN · HDMV_PGS_SUBTITLE' })).toBe('');
    expect(dubOf({ title: 'SUBRIP', label: 'RU · SUBRIP · SUBRIP' })).toBe('');
    // stored or seen titles that are codec names are dropped
    expect(sanitizeSeriesTracks({ at: 1, l: 'PCM_S16LE', g: 'ru', s: { l: 'SUBRIP', g: 'ru' }, k: [{ l: 'AC3 5.1', g: 'ru' }, { l: 'LostFilm', g: 'ru' }] }))
      .toEqual({ at: 1, g: 'ru', s: { l: '', g: 'ru' }, k: [{ l: 'LostFilm', g: 'ru' }] });
    expect(nextSeriesTracks(null, { l: 'PCM_S16LE 2.0', g: 'ru', k: [{ l: 'SUBRIP', g: 'ru' }] }, 5)).toEqual({ at: 5, g: 'ru' });
    expect(nextSeriesTracks(null, { s: { l: 'SUBRIP', g: 'ru' } }, 5)).toEqual({ at: 5, s: { l: '', g: 'ru' } });
    expect(seenDubs([{ label: 'RU · PCM_S16LE 2.0', language: 'ru' }, { title: 'LostFilm', language: 'ru' }])).toEqual([{ l: 'LostFilm', g: 'ru' }]);
  });

  it('find a track by dub, -1 when none', () => {
    const audio = [
      { label: 'RU · AC3 5.1 · Дубляж', title: 'Дубляж' },
      { label: 'RU · AAC 2.0 · MVO | LostFilm', title: 'MVO | LostFilm' },
    ];
    expect(findDub(audio, 'lostfilm')).toBe(1);
    expect(findDub(audio, 'HDrezka Studio')).toBe(-1);
    expect(findDub(audio, '')).toBe(-1);
  });

  it('list the dubs of a file once each', () => {
    expect(seenDubs([
      { title: 'LostFilm', language: 'rus' },
      { title: 'lostfilm', language: 'rus' },
      { label: 'EN · DTS 5.1', language: 'en' },
      { title: 'Original', language: 'eng' },
    ])).toEqual([{ l: 'LostFilm', g: 'ru' }, { l: 'Original', g: 'en' }]);
  });
});

describe('series records', () => {
  it('sanitize: need a time, drop malformed parts', () => {
    expect(sanitizeSeriesTracks(null)).toBeNull();
    expect(sanitizeSeriesTracks({ l: 'LostFilm' })).toBeNull();
    expect(sanitizeSeriesTracks({ at: 5, l: 'LostFilm', g: 'ru', s: 'off', k: [{ l: 'LostFilm', g: 'ru' }, 7, { g: 'en' }] }))
      .toEqual({ at: 5, l: 'LostFilm', g: 'ru', s: 'off', k: [{ l: 'LostFilm', g: 'ru' }] });
    expect(sanitizeSeriesTracks({ at: 5, s: { l: 'Надписи', g: 'ru' }, l: 7 })).toEqual({ at: 5, s: { l: 'Надписи', g: 'ru' } });
  });

  it('the newest record among the torrents of the series wins', () => {
    const members = [
      { data: data({ at: 10, l: 'LostFilm', g: 'ru' }) },
      { data: data({ at: 30, l: 'HDrezka Studio', g: 'ru' }) },
      { data: 'not json' },
      {},
    ];
    expect(newestSeriesTracks(members)!.l).toBe('HDrezka Studio');
    expect(newestSeriesTracks([{}, { data: '{}' }])).toBeNull();
    expect(seriesTracksOf(data({ at: 1 }))).toEqual({ at: 1 });
  });

  it('an audio choice keeps the subtitles, a subtitle choice keeps the audio, a reset drops both', () => {
    const base = { at: 1, l: 'LostFilm', g: 'ru', s: 'off' as const, k: [{ l: 'LostFilm', g: 'ru' }] };
    const audio = nextSeriesTracks(base, { l: 'HDrezka Studio', g: 'ru', k: [{ l: 'Original', g: 'en' }] }, 2);
    expect(audio).toEqual({ at: 2, l: 'HDrezka Studio', g: 'ru', s: 'off', k: [{ l: 'HDrezka Studio', g: 'ru' }, { l: 'Original', g: 'en' }, { l: 'LostFilm', g: 'ru' }] });
    const subs = nextSeriesTracks(audio, { s: { l: 'Надписи', g: 'ru' } }, 3);
    expect(subs.l).toBe('HDrezka Studio');
    expect(subs.s).toEqual({ l: 'Надписи', g: 'ru' });
    const reset = nextSeriesTracks(subs, 'reset', 4);
    expect(reset).toEqual({ at: 4, k: audio.k, x: true });
    expect(isReset(reset)).toBe(true);
    expect(isReset(subs)).toBe(false);
    expect(isReset(null)).toBe(false);
  });

  it('a reset is remembered by every later record: the torrents\' older choices no longer count', () => {
    const reset = nextSeriesTracks({ at: 1, l: 'LostFilm', g: 'ru' }, 'reset', 2);
    expect(torrentChoicesCount(reset)).toBe(false);
    const subsOnly = nextSeriesTracks(reset, { s: { l: 'Signs', g: 'ru' } }, 3);
    expect(subsOnly.x).toBe(true);
    expect(isReset(subsOnly)).toBe(false);
    expect(torrentChoicesCount(subsOnly)).toBe(false);
    expect(nextSeriesTracks(subsOnly, { l: 'LostFilm', g: 'ru' }, 4).x).toBe(true);
    expect(torrentChoicesCount(null)).toBe(true);
    expect(torrentChoicesCount({ at: 1, l: 'LostFilm' })).toBe(true);
    expect(sanitizeSeriesTracks({ at: 1, x: true })).toEqual({ at: 1, x: true });
  });

  it('lives in omp.a and survives the other journal writes', () => {
    const obj = withSeriesTracks({ lampa: 1 }, { at: 9, l: 'LostFilm' });
    const s = serializeData(obj, [{ f: 1, t: 2, d: 3, at: 4, src: 'tv' }]);
    expect(seriesTracksOf(s)).toEqual({ at: 9, l: 'LostFilm' });
    // a later history / skip / flag write keeps it
    const p = parseData(s)!;
    const again = serializeData(withWatch(p.obj, false), p.journal, { i: true, c: false });
    expect(seriesTracksOf(again)).toEqual({ at: 9, l: 'LostFilm' });
    expect(JSON.parse(again).lampa).toBe(1);
  });
});
