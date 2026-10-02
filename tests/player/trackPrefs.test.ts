import { describe, it, expect } from 'vitest';
import { pickAudio, pickSub, subPrefFromChoice } from '../../src/player/trackPrefs';

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
