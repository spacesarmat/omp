import { describe, it, expect } from 'vitest';
import { releaseTracks } from '../../src/lib/externalTracks';
import { pickExternalAudio, pickExternalSubtitle, pickExternalStart } from '../../src/lib/externalTrackPick';
import type { SeriesTracks } from '../../src/lib/seriesTracks';
import type { TorrentFile } from '../../src/lib/episodes';

const list = (paths: string[]): TorrentFile[] => paths.map((path, i) => ({ id: i + 1, path, length: 1 }));

const FILES = list([
  'S/Show.S01E01.mkv',
  'S/Show.S01E02.mkv',
  'S/Rus Sound/LostFilm/Show.S01E01.mka',
  'S/Rus Sound/LostFilm/Show.S01E02.mka',
  'S/Rus Sound/HDRezka Studio/Show.S01E01.mka',
  'S/Rus Sound/HDRezka Studio/Show.S01E02.mka',
  'S/Ukr Sound/Show.S01E02.mka',
  'S/Rus Subs/Show.S01E01.forced.srt',
  'S/Rus Subs/Show.S01E01.srt',
  'S/Eng Subs/Show.S01E01.srt',
  'S/Eng Subs/Show.S01E02.srt',
]);
const R = releaseTracks(FILES);
const E1 = R.byVideo[1];
const E2 = R.byVideo[2];
const S = { audioLang: 'ru', subLang: 'ru', subtitlesOn: false };
const rec = (r: Partial<SeriesTracks>): SeriesTracks => ({ at: 1, ...r });

describe('pickExternalAudio', () => {
  it('no choice yet: the first dub in the settings language', () => {
    expect(pickExternalAudio(E1.audio, null, S)).toBe('a:rus:hdrezka-studio');
    expect(pickExternalAudio(E2.audio, null, { audioLang: 'uk' })).toBe('a:ukr:');
    // the default is Russian when the setting is empty
    expect(pickExternalAudio(E1.audio, null, { audioLang: '' })).toBe('a:rus:hdrezka-studio');
  });

  it('the series\' dub by studio + language, found again in the next episode', () => {
    const r = rec({ l: 'LostFilm', g: 'ru' });
    expect(pickExternalAudio(E1.audio, r, S)).toBe('a:rus:lostfilm');
    expect(pickExternalAudio(E2.audio, r, S)).toBe('a:rus:lostfilm');
    // a longer remembered title of the same dub («MVO | LostFilm» from an embedded track)
    expect(pickExternalAudio(E2.audio, rec({ l: 'MVO | LostFilm', g: 'ru' }), S)).toBe('a:rus:lostfilm');
  });

  it('the dub is missing in this episode: the series\' language, then the settings', () => {
    expect(pickExternalAudio(E2.audio, rec({ l: 'Кубик в Кубе', g: 'uk' }), S)).toBe('a:ukr:');
    expect(pickExternalAudio(E1.audio, rec({ l: 'Кубик в Кубе', g: 'uk' }), S)).toBe('a:rus:hdrezka-studio');
  });

  it('an embedded track that answers first leaves the choice to the player', () => {
    const embedded = [{ title: 'LostFilm', language: 'ru' }];
    expect(pickExternalAudio(E1.audio, rec({ l: 'LostFilm', g: 'ru' }), S, embedded)).toBeNull();
    expect(pickExternalAudio(E1.audio, null, S, [{ language: 'ru', title: 'Дубляж' }])).toBeNull();
    // the video has only English: the Russian external dub
    expect(pickExternalAudio(E1.audio, null, S, [{ language: 'en' }])).toBe('a:rus:hdrezka-studio');
  });

  it('a reset series record counts as no record', () => {
    expect(pickExternalAudio(E1.audio, rec({ x: true }), S)).toBe('a:rus:hdrezka-studio');
  });

  it('nothing in the wanted language: the player\'s own choice', () => {
    expect(pickExternalAudio(E1.audio, null, { audioLang: 'de' })).toBeNull();
    expect(pickExternalAudio([], rec({ l: 'LostFilm' }), S)).toBeNull();
  });
});

describe('pickExternalSubtitle', () => {
  it('off in the series record wins', () => {
    expect(pickExternalSubtitle(E1.subtitles, rec({ s: 'off' }), { subLang: 'ru', subtitlesOn: true })).toBe('off');
  });

  it('settings: off means the player\'s own choice; on picks full subtitles before forced ones', () => {
    expect(pickExternalSubtitle(E1.subtitles, null, { subLang: 'ru', subtitlesOn: false })).toBeNull();
    expect(pickExternalSubtitle(E1.subtitles, null, { subLang: 'ru', subtitlesOn: true })).toBe('s:rus:');
    expect(pickExternalSubtitle(E1.subtitles, null, { subLang: 'en', subtitlesOn: true })).toBe('s:eng:');
  });

  it('the series\' subtitles by name: «Forced» is not the full ones', () => {
    expect(pickExternalSubtitle(E1.subtitles, rec({ s: { l: 'Forced', g: 'ru' } }), { subLang: 'ru', subtitlesOn: false })).toBe('s:rus::forced');
    // by language when the name is not there (episode 2 has only English)
    expect(pickExternalSubtitle(E2.subtitles, rec({ s: { l: '', g: 'en' } }), { subLang: 'ru', subtitlesOn: false })).toBe('s:eng:');
    expect(pickExternalSubtitle(E2.subtitles, rec({ s: { l: 'Forced', g: 'ru' } }), { subLang: 'ru', subtitlesOn: false })).toBeNull();
  });

  it('the studio\'s forced subtitles only: full ones of the language (another studio) first', () => {
    const files = list([
      'S/Show.S01E01.mkv', 'S/Show.S01E02.mkv',
      'S/Rus Subs/LostFilm/Forced/Show.S01E02.srt', 'S/Rus Subs/HDRezka/Show.S01E02.srt',
      'S/Rus Subs/LostFilm/Forced/Show.S01E01.srt',
    ]);
    const r = releaseTracks(files);
    const s = { subLang: 'ru', subtitlesOn: false };
    expect(pickExternalSubtitle(r.byVideo[2].subtitles, rec({ s: { l: 'LostFilm', g: 'ru' } }), s)).toBe('s:rus:hdrezka');
    // the forced ones themselves were chosen: found by their name
    expect(pickExternalSubtitle(r.byVideo[2].subtitles, rec({ s: { l: 'LostFilm · Forced', g: 'ru' } }), s)).toBe('s:rus:lostfilm:forced');
    // nothing else in the language: the studio's forced ones
    expect(pickExternalSubtitle(r.byVideo[1].subtitles, rec({ s: { l: 'LostFilm', g: 'ru' } }), s)).toBe('s:rus:lostfilm:forced');
  });

  it('embedded subtitles in the language leave the choice to the player', () => {
    expect(pickExternalSubtitle(E1.subtitles, null, { subLang: 'ru', subtitlesOn: true }, [{ language: 'ru' }])).toBeNull();
    // forced embedded ones do not count as full subtitles
    expect(pickExternalSubtitle(E1.subtitles, null, { subLang: 'ru', subtitlesOn: true }, [{ language: 'ru', forced: true }])).toBe('s:rus:');
  });
});

describe('pickExternalStart', () => {
  it('both at once', () => {
    expect(pickExternalStart(E1, rec({ l: 'LostFilm', g: 'ru', s: { l: '', g: 'en' } }), S)).toEqual({ audio: 'a:rus:lostfilm', subtitle: 's:eng:' });
    expect(pickExternalStart({ audio: [], subtitles: [] }, null, S)).toEqual({ audio: null, subtitle: null });
  });
});
