import { describe, it, expect } from 'vitest';
import { normalizeLang, guessLangFromName, tracksFromProbe, describeTrack, pickTrack, findLang } from '../../src/lib/tracks';
import type { FfprobeResult } from '../../src/api/types';

const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'hevc' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'rus', title: 'Дубляж' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'eac3', channels: 8, tags: { language: 'eng' } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'rus', title: 'Forced' }, disposition: { forced: 1 } },
  ],
};

describe('normalizeLang', () => {
  it('normalizes codes and names', () => {
    expect(normalizeLang('rus')).toBe('ru');
    expect(normalizeLang('Russian')).toBe('ru');
    expect(normalizeLang('русский')).toBe('ru');
    expect(normalizeLang('eng')).toBe('en');
    expect(normalizeLang('ukr')).toBe('uk');
    expect(normalizeLang('und')).toBe('');
    expect(normalizeLang(undefined)).toBe('');
    expect(normalizeLang('pt-BR')).toBe('pt');
  });
});

describe('guessLangFromName', () => {
  it('finds language token', () => {
    expect(guessLangFromName('rus.forced')).toBe('ru');
    expect(guessLangFromName('Show.S01E01.English')).toBe('en');
    expect(guessLangFromName('Subs')).toBe('');
  });
});

describe('tracksFromProbe', () => {
  it('extracts audio and subtitle tracks with per-kind index', () => {
    const t = tracksFromProbe(probe);
    expect(t).toEqual([
      { index: 0, kind: 'audio', codec: 'ac3', language: 'ru', title: 'Дубляж', channels: 6, isDefault: true, forced: false },
      { index: 1, kind: 'audio', codec: 'eac3', language: 'en', title: '', channels: 8, isDefault: false, forced: false },
      { index: 0, kind: 'subtitle', codec: 'subrip', language: 'ru', title: 'Forced', channels: undefined, isDefault: false, forced: true },
    ]);
    expect(tracksFromProbe(null)).toEqual([]);
  });
  it('describes tracks', () => {
    const t = tracksFromProbe(probe);
    expect(describeTrack(t[0])).toBe('RU · AC3 5.1 · Дубляж');
    expect(describeTrack(t[1])).toBe('EN · EAC3 7.1');
    expect(describeTrack(t[2])).toBe('RU · SUBRIP · Forced');
  });
});

describe('pickTrack / findLang', () => {
  const list = [{ language: 'en', isDefault: true }, { language: 'ru' }];
  it('prefers language, then default, then first', () => {
    expect(pickTrack(list, 'ru')).toBe(1);
    expect(pickTrack(list, 'de')).toBe(0);
    expect(pickTrack([{ language: 'en' }, { language: 'de', isDefault: true }], 'fr')).toBe(1);
    expect(pickTrack([], 'ru')).toBe(-1);
  });
  it('findLang is strict', () => {
    expect(findLang(list, 'ru')).toBe(1);
    expect(findLang(list, 'de')).toBe(-1);
  });
});
