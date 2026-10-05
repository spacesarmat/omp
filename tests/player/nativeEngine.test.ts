import { describe, it, expect, beforeEach } from 'vitest';
import {
  engineFor, assSubsShown, sanitizeNativeEngine, engineLogText, rememberProbe, knownProbe, clearProbes,
  playerEngineOptions, isPlayerEngine, vlcAvailable, vlcUnavailable,
} from '../../src/player/nativeEngine';
import type { FfprobeResult } from '../../src/api/types';

function probe(subs: { codec: string; lang?: string; title?: string; def?: boolean }[]): FfprobeResult {
  return {
    streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc' } as any].concat(subs.map((s, i) => ({
      index: i + 1, codec_type: 'subtitle', codec_name: s.codec,
      tags: { ...(s.lang ? { language: s.lang } : {}), ...(s.title ? { title: s.title } : {}) },
      disposition: { default: s.def ? 1 : 0 },
    }))),
  };
}

const on = { subtitlesOn: true, subLang: 'ru' };
const off = { subtitlesOn: false, subLang: 'ru' };

describe('engine choice', () => {
  it('the torrent choice wins over the setting', () => {
    expect(engineFor('auto', null)).toBe('auto');
    expect(engineFor('auto', { engine: 'vlc' })).toBe('vlc');
    expect(engineFor('vlc', { engine: 'builtin' })).toBe('builtin');
    expect(engineFor('builtin', { audioLang: 'ru' })).toBe('builtin');
  });

  it('settings choices: names and texts of the mockup', () => {
    expect(playerEngineOptions().map((o) => o.value)).toEqual(['auto', 'builtin', 'vlc']);
    expect(playerEngineOptions().map((o) => o.name)).toEqual(['Авто', 'Встроенный', 'VLC']);
    expect(playerEngineOptions()[0].text).toBe('Встроенный плеер; если он не может открыть файл или в нём субтитры ASS — VLC с того же места');
    expect(isPlayerEngine('auto')).toBe(true);
    expect(isPlayerEngine('mpv')).toBe(false);
  });
});

describe('vlcAvailable', () => {
  it('asks the plugin; unknown counts as available (the player falls back by itself)', async () => {
    expect(await vlcAvailable({ vlcAvailable: () => Promise.resolve({ available: false }) })).toBe(false);
    expect(await vlcAvailable({ vlcAvailable: () => Promise.resolve({ available: true }) })).toBe(true);
    expect(await vlcAvailable({ vlcAvailable: () => Promise.reject(new Error('x')) })).toBe(true);
    expect(await vlcAvailable({} as any)).toBe(true);
    expect(await vlcAvailable(null)).toBe(true);
    expect(vlcUnavailable()).toBe('VLC недоступен на этом устройстве');
  });
});

describe('assSubsShown (ffprobe)', () => {
  it('subtitles on: the preferred language decides', () => {
    expect(assSubsShown(probe([{ codec: 'subrip', lang: 'eng' }, { codec: 'ass', lang: 'rus' }]), on, null)).toBe(true);
    expect(assSubsShown(probe([{ codec: 'ass', lang: 'eng' }, { codec: 'subrip', lang: 'rus' }]), on, null)).toBe(false);
    expect(assSubsShown(probe([{ codec: 'ssa', lang: 'ru' }]), on, null)).toBe(true);
  });

  it('no language match: the default track', () => {
    expect(assSubsShown(probe([{ codec: 'subrip', lang: 'eng' }, { codec: 'ass', lang: 'jpn', def: true }]), on, null)).toBe(true);
    expect(assSubsShown(probe([{ codec: 'ass', lang: 'eng' }]), on, null)).toBe(false);
  });

  it('subtitles off, none, or no probe: false', () => {
    expect(assSubsShown(probe([{ codec: 'ass', lang: 'rus', def: true }]), off, null)).toBe(false);
    expect(assSubsShown(probe([]), on, null)).toBe(false);
    expect(assSubsShown(null, on, null)).toBe(false);
  });

  it('the torrent remembered choice: off, the same title, else its language', () => {
    const p = probe([{ codec: 'subrip', lang: 'rus', title: 'Полные' }, { codec: 'ass', lang: 'rus', title: 'Надписи' }]);
    expect(assSubsShown(p, on, { sub: 'off' })).toBe(false);
    expect(assSubsShown(p, off, { sub: { lang: 'ru', label: 'Надписи' } })).toBe(true);
    expect(assSubsShown(p, on, { sub: { lang: 'ru', label: 'Полные' } })).toBe(false);
    expect(assSubsShown(probe([{ codec: 'ass', lang: 'eng' }]), off, { sub: { lang: 'en', label: 'English' } })).toBe(true);
  });
});

describe('nativePlayerEngine event', () => {
  it('sanitizes and gives the log text', () => {
    expect(sanitizeNativeEngine({ index: 0, engine: 'vlc', reason: 'format', session: 3 })).toEqual({ index: 0, engine: 'vlc', reason: 'format' });
    expect(sanitizeNativeEngine({ index: -1, engine: 'vlc', reason: 'format' })).toBeNull();
    expect(sanitizeNativeEngine({ index: 0, engine: 'x', reason: 'format' })).toBeNull();
    expect(sanitizeNativeEngine({ index: 0, engine: 'vlc', reason: 'x' })).toBeNull();
    expect(sanitizeNativeEngine(null)).toBeNull();
    expect(engineLogText({ index: 0, engine: 'vlc', reason: 'format' })).toBe('плеер: переключение на VLC (формат)');
    expect(engineLogText({ index: 0, engine: 'vlc', reason: 'ass' })).toBe('плеер: переключение на VLC (субтитры ASS)');
    expect(engineLogText({ index: 0, engine: 'builtin', reason: 'manual' })).toBeNull();
  });
});

describe('probe memory', () => {
  beforeEach(() => clearProbes());
  it('remembers answers per file, the oldest dropped past the limit', () => {
    const p = probe([{ codec: 'ass' }]);
    expect(knownProbe('h', 1)).toBeUndefined();
    rememberProbe('h', 1, p);
    rememberProbe('h', 2, null);
    expect(knownProbe('h', 1)).toBe(p);
    expect(knownProbe('h', 2)).toBeNull();
    for (let i = 0; i < 60; i++) rememberProbe('x', i, null);
    expect(knownProbe('h', 1)).toBeUndefined();
    expect(knownProbe('x', 59)).toBeNull();
  });
});
