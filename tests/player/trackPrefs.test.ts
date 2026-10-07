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

  it('native start options: the dub and subtitle titles with their languages', () => {
    expect(nativeTrackStart(null, null, settings)).toEqual(settings);
    expect(nativeTrackStart({ at: 1, l: 'LostFilm', g: 'ru', s: { l: 'Signs', g: 'ru' } }, null, { ...settings, audioLang: 'en' }))
      .toEqual({ audioLang: 'ru', subLang: 'ru', subtitlesOn: true, dubLabel: 'LostFilm', subLabel: 'Signs' });
    expect(nativeTrackStart({ at: 1, s: 'off' }, null, { ...settings, subtitlesOn: true }).subtitlesOn).toBe(false);
    // the torrent's own choice when the series has none
    expect(nativeTrackStart(null, { audioLang: 'en', audioLabel: 'EN · AC3 5.1 · Original', sub: { lang: 'en', label: 'eng.srt' } }, settings))
      .toEqual({ audioLang: 'en', subLang: 'en', subtitlesOn: true, dubLabel: 'Original', subLabel: 'eng.srt' });
    // a reset: the settings only
    expect(nativeTrackStart({ at: 1 }, { audioLang: 'en', audioLabel: 'Original' }, settings)).toEqual(settings);
  });
});
