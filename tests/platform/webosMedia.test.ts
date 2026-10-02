import { describe, it, expect } from 'vitest';
import { selectAudioTrack, selectTextTrack, audioTrackList, textTrackList } from '../../src/platform/webosMedia';

function fakeVideo(audio: any[], text: any[]): HTMLVideoElement {
  const at: any = audio.slice();
  const tt: any = text.slice();
  return { audioTracks: at, textTracks: tt } as unknown as HTMLVideoElement;
}

describe('webosMedia', () => {
  it('enables only the chosen audio track', () => {
    const v = fakeVideo([{ enabled: true, language: 'en', label: '' }, { enabled: false, language: 'ru', label: 'Dub' }], []);
    expect(selectAudioTrack(v, 1)).toBe(true);
    expect((v as any).audioTracks.map((t: any) => t.enabled)).toEqual([false, true]);
    expect(audioTrackList(v)).toEqual([{ language: 'en', label: 'Дорожка 1' }, { language: 'ru', label: 'Dub' }]);
  });
  it('shows chosen text track and disables others', () => {
    const v = fakeVideo([], [{ mode: 'showing' }, { mode: 'disabled' }]);
    expect(selectTextTrack(v, 1)).toBe(true);
    expect((v as any).textTracks.map((t: any) => t.mode)).toEqual(['disabled', 'showing']);
    selectTextTrack(v, -1);
    expect((v as any).textTracks.map((t: any) => t.mode)).toEqual(['disabled', 'disabled']);
  });
  it('filters text tracks by kind (subtitles/captions only)', () => {
    const tracks = [
      { kind: 'metadata', mode: 'hidden' },
      { kind: 'subtitles', mode: 'disabled', language: 'ru', label: 'R' },
      { kind: 'captions', mode: 'disabled', language: 'en', label: '' },
    ];
    const v = fakeVideo([], tracks);
    expect(textTrackList(v)).toEqual([
      { language: 'ru', label: 'R' },
      { language: 'en', label: 'Субтитры 2' },
    ]);
    expect(selectTextTrack(v, 1)).toBe(true);
    const modes = (v as any).textTracks.map((t: any) => t.mode);
    expect(modes).toEqual(['hidden', 'disabled', 'showing']);
  });
  it('returns false without track APIs and Luna', () => {
    const v = {} as HTMLVideoElement;
    expect(selectAudioTrack(v, 0)).toBe(false);
    expect(selectTextTrack(v, 0)).toBe(false);
  });
});
