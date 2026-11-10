import { beforeEach, describe, expect, it } from 'vitest';
import { getTrackPref, saveTrackPref } from '../../src/store/trackPrefs';
import { episodeProgressKey, prefForStart, probeTracks, rememberTracks, saveTitleTrack, titleMemoryKey } from '../../src/viewer/tracks';
import type { FfprobeResult } from '../../src/api/types';

beforeEach(() => {
  localStorage.clear();
});

describe('track memory', () => {
  it('collapses season, year and quality so the next episode shares a key', () => {
    const a = titleMemoryKey('Show.S01E01.2020.1080p.WEB-DL');
    const b = titleMemoryKey('Show S02E04 2020 2160p HDR');
    expect(a).toBe(b);
    expect(a.indexOf('s01')).toBe(-1);
  });

  it('applies the remembered audio and subtitles on the next hash', () => {
    rememberTracks('hash-a', 'Show S01E01 1080p', { audioLang: 'ru', audioLabel: 'LostFilm AC3', sub: { lang: 'ru', label: 'full ASS' } });
    expect(getTrackPref('hash-a')!.audioLabel).toBe('LostFilm AC3');
    const next = prefForStart('hash-b', 'Show S01E02 1080p');
    expect(next && next.audioLabel).toBe('LostFilm AC3');
    expect(next && next.sub).toEqual({ lang: 'ru', label: 'full ASS' });
  });

  it('keeps a torrent choice ahead of the series memory', () => {
    saveTitleTrack('Show', { audioLang: 'en', audioLabel: 'Original' });
    saveTrackPref('hash-a', { audioLang: 'ru', audioLabel: 'Dub' });
    expect(prefForStart('hash-a', 'Show')!.audioLabel).toBe('Dub');
    expect(prefForStart('other', 'Show')!.audioLabel).toBe('Original');
  });

  it('reads audio and subtitle streams from ffprobe', () => {
    const probe = {
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc' },
        { index: 1, codec_type: 'audio', codec_name: 'ac3', tags: { language: 'rus', title: 'LostFilm' } },
        { index: 2, codec_type: 'subtitle', codec_name: 'ass', tags: { language: 'rus', title: 'Full' } },
      ],
    } as FfprobeResult;
    const list = probeTracks(probe);
    expect(list.audio.map((t) => t.label)).toEqual(['LostFilm AC3']);
    expect(list.audio[0].language).toBe('rus');
    expect(list.subtitles[0].label).toBe('Full ASS');
  });

  it('keys a film as movie and an episode as its code', () => {
    expect(episodeProgressKey('Show.S01E03.mkv', false)).toBe('s01e03');
    expect(episodeProgressKey('Movie.mkv', true)).toBe('movie');
  });
});
