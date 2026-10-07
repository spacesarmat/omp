import { describe, it, expect } from 'vitest';
import {
  pickAudio, pickSub, subPrefFromChoice, pickAudioFor, pickSubFor, seriesAudioFromChoice, seriesSubFromChoice, nativeTrackStart,
} from '../../src/player/trackPrefs';

const audio = [
  { label: 'RU · AC3 5.1 · Дубляж', language: 'ru', isDefault: true },
  { label: 'RU · AAC 2.0 · MVO', language: 'ru', isDefault: false },
  { label: 'EN · AC3 5.1', language: 'en', isDefault: false },
];
const emb = [{ label: 'EN · SUBRIP', language: 'en', isDefault: false }];
const ext = [{ url: 'u', label: 'rus.forced', ext: 'srt' }];
const s = { subtitlesOn: false, subLang: 'ru' };

describe('pickAudio', () => {
  it('prefers exact label, then language, then settings', () => {
    expect(pickAudio(audio, { audioLabel: 'RU · AAC 2.0 · MVO', audioLang: 'ru' }, 'ru')).toBe(1);
    expect(pickAudio(audio, { audioLabel: 'nope', audioLang: 'en' }, 'ru')).toBe(2);
    expect(pickAudio(audio, null, 'en')).toBe(2);
    expect(pickAudio(audio, {}, 'ru')).toBe(0);
  });
});

describe('pickSub', () => {
  it('honours off and matches by label then language', () => {
    expect(pickSub(emb, ext, { sub: 'off' }, { subtitlesOn: true, subLang: 'en' })).toBe('off');
    expect(pickSub(emb, ext, { sub: { lang: 'ru', label: 'rus.forced' } }, s)).toBe('x0');
    expect(pickSub(emb, ext, { sub: { lang: 'en', label: 'other' } }, s)).toBe('e0');
    expect(pickSub(emb, ext, { sub: { lang: 'ru', label: 'other' } }, s)).toBe('x0');
    expect(pickSub(emb, ext, null, { subtitlesOn: true, subLang: 'en' })).toBe('e0');
    expect(pickSub(emb, ext, null, s)).toBe('off');
  });
});

describe('subPrefFromChoice', () => {
  it('maps choices', () => {
    expect(subPrefFromChoice('off', emb, ext)).toBe('off');
    expect(subPrefFromChoice('e0', emb, ext)).toEqual({ lang: 'en', label: 'EN · SUBRIP' });
    expect(subPrefFromChoice('x0', emb, ext)).toEqual({ lang: 'ru', label: 'rus.forced' });
  });
});

describe('series dub', () => {
  const dubs = [
    { label: 'RU · AC3 5.1 · Dub', language: 'ru', isDefault: true, title: 'Dub' },
    { label: 'RU · AAC 2.0 · MVO | LostFilm', language: 'ru', isDefault: false, title: 'MVO | LostFilm' },
    { label: 'EN · AC3 5.1', language: 'en', isDefault: false },
  ];
  const settings = { audioLang: 'ru', subLang: 'ru', subtitlesOn: false };

  it('audio: the series dub by label first, then the torrent choice, then the series language, then settings', () => {
    expect(pickAudioFor(dubs, { at: 1, l: 'LostFilm', g: 'ru' }, { audioLabel: 'EN · AC3 5.1' }, 'ru')).toBe(1);
    // no such dub in this file: the torrent's own choice
    expect(pickAudioFor(dubs, { at: 1, l: 'HDrezka Studio', g: 'ru' }, { audioLabel: 'EN · AC3 5.1' }, 'ru')).toBe(2);
    // nor a torrent choice: the series language
    expect(pickAudioFor(dubs, { at: 1, l: 'HDrezka Studio', g: 'en' }, null, 'ru')).toBe(2);
    // no series record: the per-torrent choice as before
    expect(pickAudioFor(dubs, null, { audioLabel: 'RU · AAC 2.0 · MVO | LostFilm' }, 'en')).toBe(1);
    // a reset of the series drops the torrent choice too
    expect(pickAudioFor(dubs, { at: 1 }, { audioLabel: 'EN · AC3 5.1' }, 'ru')).toBe(0);
  });

  it('subtitles: series off / title / language, else the torrent, else the settings', () => {
    const embedded = [{ label: 'RU · SUBRIP · Signs', language: 'ru', isDefault: false, title: 'Signs' }, ...emb];
    expect(pickSubFor(embedded, ext, { at: 1, s: 'off' }, { sub: { lang: 'en', label: 'EN · SUBRIP' } }, s)).toBe('off');
    expect(pickSubFor(embedded, ext, { at: 1, s: { l: 'signs', g: 'ru' } }, null, s)).toBe('e0');
    expect(pickSubFor(embedded, ext, { at: 1, s: { l: 'rus.forced', g: '' } }, null, s)).toBe('x0');
    expect(pickSubFor(embedded, ext, { at: 1, s: { l: 'Full', g: 'en' } }, null, s)).toBe('e1');
    expect(pickSubFor(embedded, ext, { at: 1, l: 'LostFilm' }, { sub: { lang: 'en', label: 'EN · SUBRIP' } }, s)).toBe('e1');
    expect(pickSubFor(embedded, ext, { at: 1 }, { sub: { lang: 'en', label: 'EN · SUBRIP' } }, s)).toBe('off');
    expect(pickSubFor(embedded, ext, null, null, { subtitlesOn: true, subLang: 'en' })).toBe('e1');
  });

  it('choices become series records', () => {
    expect(seriesAudioFromChoice(dubs, 1)).toEqual({ l: 'MVO | LostFilm', g: 'ru', k: [{ l: 'Dub', g: 'ru' }, { l: 'MVO | LostFilm', g: 'ru' }] });
    expect(seriesSubFromChoice('off', emb, ext)).toBe('off');
    expect(seriesSubFromChoice('e0', [{ label: 'RU · ASS · Signs', language: 'ru', isDefault: false, title: 'Signs' }], ext)).toEqual({ l: 'Signs', g: 'ru' });
    expect(seriesSubFromChoice('x0', emb, ext)).toEqual({ l: 'rus.forced', g: 'ru' });
  });

  it('native start options: the same order as LG — series dub, torrent choice, series language, settings', () => {
    expect(nativeTrackStart(null, null, settings)).toEqual(settings);
    expect(nativeTrackStart({ at: 1, l: 'LostFilm', g: 'ru', s: { l: 'Signs', g: 'ru' } }, null, { ...settings, audioLang: 'en' })).toEqual({
      audioLang: 'ru', subLang: 'ru', subtitlesOn: true,
      audioPick: [{ l: 'LostFilm' }, { g: 'ru' }, { g: 'en' }],
      subPick: [{ l: 'Signs', g: 'ru' }, { g: 'ru' }, { off: true }],
    });
    // the torrent's own language comes before the series language (as pickAudioFor on LG)
    const both = nativeTrackStart({ at: 1, l: 'HDrezka Studio', g: 'ru' }, { audioLang: 'en', audioLabel: 'EN · AC3 5.1 · Original' }, settings);
    expect(both.audioPick).toEqual([{ l: 'HDrezka Studio' }, { l: 'Original' }, { g: 'en' }, { g: 'ru' }, { g: 'ru' }]);
    expect(both.audioLang).toBe('en');
    // subtitles off for the series: off first
    const off = nativeTrackStart({ at: 1, s: 'off' }, null, { ...settings, subtitlesOn: true });
    expect(off.subtitlesOn).toBe(false);
    expect(off.subPick).toEqual([{ off: true }, { g: 'ru' }]);
    // the torrent's own choice when the series has none
    expect(nativeTrackStart(null, { audioLang: 'en', audioLabel: 'EN · AC3 5.1 · Original', sub: { lang: 'en', label: 'eng.srt' } }, settings)).toEqual({
      audioLang: 'en', subLang: 'en', subtitlesOn: true,
      audioPick: [{ l: 'Original' }, { g: 'en' }, { g: 'ru' }],
      subPick: [{ l: 'eng.srt', g: 'en' }, { g: 'en' }, { off: true }],
    });
    // the torrent's untitled subtitles (a codec label) go by language only
    expect(nativeTrackStart(null, { sub: { lang: 'ru', label: 'RU · SUBRIP' } }, settings).subPick).toEqual([{ g: 'ru' }, { off: true }]);
    // a reset: the settings only
    expect(nativeTrackStart({ at: 1, x: true }, { audioLang: 'en', audioLabel: 'Original' }, settings)).toEqual(settings);
  });

  it('untitled subtitles are remembered by language only and found again in that language', () => {
    const untitled = [
      { label: 'EN · SUBRIP', language: 'en', isDefault: false },
      { label: 'RU · SUBRIP', language: 'ru', isDefault: false },
    ];
    const rec = seriesSubFromChoice('e1', untitled, []);
    expect(rec).toEqual({ l: '', g: 'ru' });
    expect(pickSubFor(untitled, [], { at: 1, s: rec }, null, s)).toBe('e1');
    // untitled audio with a codec the old list lacked: no dub label
    expect(seriesAudioFromChoice([{ label: 'RU · PCM_S16LE 2.0', language: 'ru', isDefault: false }], 0)).toEqual({ l: '', g: 'ru', k: [] });
  });

  it('a subtitle title counts only in the remembered language', () => {
    const forced = [
      { label: 'EN · SUBRIP · Forced', language: 'en', isDefault: false, title: 'Forced' },
      { label: 'RU · SUBRIP · Forced', language: 'ru', isDefault: false, title: 'Forced' },
    ];
    expect(pickSubFor(forced, [], { at: 1, s: { l: 'Forced', g: 'ru' } }, null, s)).toBe('e1');
    expect(pickSubFor(forced, [], { at: 1, s: { l: 'Forced', g: '' } }, null, s)).toBe('e0');
    // no title in that language: the language
    expect(pickSubFor([forced[0], { label: 'RU · SUBRIP', language: 'ru', isDefault: false }], [], { at: 1, s: { l: 'Forced', g: 'ru' } }, null, s)).toBe('e1');
  });

  it('after a reset of the series a choice of only subtitles does not bring back the torrent\'s old audio', () => {
    const afterReset = { at: 3, s: { l: 'Signs', g: 'ru' }, x: true as const };
    expect(pickAudioFor(dubs, afterReset, { audioLabel: 'EN · AC3 5.1', audioLang: 'en' }, 'ru')).toBe(0);
    expect(pickSubFor(emb, ext, { at: 3, l: 'Dub', x: true }, { sub: { lang: 'en', label: 'EN · SUBRIP' } }, s)).toBe('off');
    expect(nativeTrackStart(afterReset, { audioLang: 'en', audioLabel: 'Original' }, settings).audioPick).toBeUndefined();
  });
});
