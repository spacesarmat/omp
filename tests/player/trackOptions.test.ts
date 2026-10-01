import { describe, it, expect } from 'vitest';
import { audioOptions, embeddedSubOptions, subtitleMenu, defaultSubChoice, defaultAudioIndex } from '../../src/player/trackOptions';
import type { FfprobeResult } from '../../src/api/types';

const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'eng' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'rus' }, disposition: { default: 1 } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
  ],
};

describe('trackOptions', () => {
  it('builds audio options from probe', () => {
    expect(audioOptions(probe, null)).toEqual([
      { label: 'EN · AC3 5.1', language: 'en', isDefault: false },
      { label: 'RU · AAC 2.0', language: 'ru', isDefault: true },
    ]);
    expect(defaultAudioIndex(audioOptions(probe, null))).toBe(1);
    expect(defaultAudioIndex([])).toBe(0);
  });
  it('falls back to video.audioTracks', () => {
    const video = { audioTracks: [{ language: 'ru', label: 'Dub' }] } as unknown as HTMLVideoElement;
    expect(audioOptions(null, video)).toEqual([{ label: 'Dub (ru)', language: 'ru', isDefault: false }]);
  });
  it('builds subtitle menu', () => {
    const emb = embeddedSubOptions(probe, null);
    const menu = subtitleMenu(emb, [{ url: 'u', label: 'rus', ext: 'srt' }]);
    expect(menu).toEqual([
      { label: 'Выкл', value: 'off' },
      { label: 'EN · SUBRIP', value: 'e0' },
      { label: 'rus (файл)', value: 'x0' },
    ]);
  });
  it('picks default subtitle', () => {
    const emb = embeddedSubOptions(probe, null);
    const ext = [{ url: 'u', label: 'rus', ext: 'srt' }];
    expect(defaultSubChoice(emb, ext, { subtitlesOn: false, subLang: 'ru' })).toBe('off');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'ru' })).toBe('x0');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'en' })).toBe('e0');
    expect(defaultSubChoice(emb, ext, { subtitlesOn: true, subLang: 'de' })).toBe('off');
  });
  it('aligns audio counts: probe has 2, video has 2 → use probe labels', () => {
    const video = {
      audioTracks: [
        { language: 'eng', label: 'Track 1' },
        { language: 'rus', label: 'Track 2' },
      ],
    } as unknown as HTMLVideoElement;
    expect(audioOptions(probe, video)).toEqual([
      { label: 'EN · AC3 5.1', language: 'en', isDefault: false },
      { label: 'RU · AAC 2.0', language: 'ru', isDefault: true },
    ]);
  });
  it('aligns audio counts: probe has 2, video has 1 → use video options', () => {
    const video = { audioTracks: [{ language: 'ru', label: 'Dub' }] } as unknown as HTMLVideoElement;
    const probeWith2Audio: FfprobeResult = {
      streams: [
        { index: 0, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'eng' } },
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'rus' } },
      ],
    };
    expect(audioOptions(probeWith2Audio, video)).toEqual([
      { label: 'Dub (ru)', language: 'ru', isDefault: false },
    ]);
  });
  it('aligns subtitle counts: probe has 1, video.textTracks empty → use probe', () => {
    const video = { textTracks: [] as any } as unknown as HTMLVideoElement;
    expect(embeddedSubOptions(probe, video)).toEqual([
      { label: 'EN · SUBRIP', language: 'en', isDefault: false },
    ]);
  });
});
