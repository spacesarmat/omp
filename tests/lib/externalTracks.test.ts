import { describe, it, expect } from 'vitest';
import {
  classifyFiles, releaseTracks, tracksForVideo, trackEpisode, fileTrackEpisode, externalSummary, cleanStudio, trackId,
  baseTrackId, type ReleaseTracks,
} from '../../src/lib/externalTracks';
import { playableFiles, groupBySeason, type TorrentFile } from '../../src/lib/episodes';
import { hasMainVideo } from '../../src/lib/categoryCheck';

const list = (paths: string[], size = 1000): TorrentFile[] => paths.map((path, i) => ({ id: i + 1, path, length: size }));
const byPath = (files: TorrentFile[], path: string): TorrentFile => files.filter((f) => f.path === path)[0];

/** [id, name, lang] of the tracks of the video at `path`. */
function audioOf(r: ReleaseTracks, files: TorrentFile[], path: string): string[][] {
  return r.byVideo[byPath(files, path).id].audio.map((t) => [t.id, t.name, t.lang]);
}
function subsOf(r: ReleaseTracks, files: TorrentFile[], path: string): string[][] {
  return r.byVideo[byPath(files, path).id].subtitles.map((t) => [t.id, t.name, t.lang]);
}
function filesOfAudio(r: ReleaseTracks, files: TorrentFile[], path: string): string[] {
  return r.byVideo[byPath(files, path).id].audio.map((t) => t.file.path);
}

// LostFilm-style season with two studios in «Rus Sound» and subtitles in «Rus Subs»
const ROOT = 'The.Last.of.Us.S02.1080p.WEB-DL';
const LOSTFILM = list([
  ROOT + '/The.Last.of.Us.S02E01.1080p.WEB-DL.mkv',
  ROOT + '/The.Last.of.Us.S02E02.1080p.WEB-DL.mkv',
  ROOT + '/The.Last.of.Us.S02E10.1080p.WEB-DL.mkv',
  ROOT + '/The.Last.of.Us.S02E11.1080p.WEB-DL.mkv',
  ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E01.1080p.WEB-DL.mka',
  ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E02.1080p.WEB-DL.mka',
  ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E10.1080p.WEB-DL.mka',
  ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E11.1080p.WEB-DL.mka',
  ROOT + '/Rus Sound/HDRezka Studio/The.Last.of.Us.S02E01.ac3',
  ROOT + '/Rus Sound/HDRezka Studio/The.Last.of.Us.S02E11.ac3',
  ROOT + '/Rus Sound/Кубик в Кубе/The Last of Us - S02E01.mka',
  ROOT + '/Rus Subs/The.Last.of.Us.S02E01.1080p.WEB-DL.srt',
  ROOT + '/Rus Subs/The.Last.of.Us.S02E01.1080p.WEB-DL.forced.srt',
  ROOT + '/Rus Subs/The.Last.of.Us.S02E11.1080p.WEB-DL.srt',
  ROOT + '/Eng Subs/The.Last.of.Us.S02E01.1080p.WEB-DL.SDH.srt',
  ROOT + '/The.Last.of.Us.S02.nfo',
]);

describe('classifyFiles', () => {
  it('videos, external audio, subtitles and the rest', () => {
    const c = classifyFiles(LOSTFILM);
    expect(c.videos.length).toBe(4);
    expect(c.audio.length).toBe(7);
    expect(c.subtitles.length).toBe(4);
    expect(c.other.map((f) => f.path)).toEqual([ROOT + '/The.Last.of.Us.S02.nfo']);
  });

  it('a release without video has no external tracks (an audiobook, music)', () => {
    const c = classifyFiles(list(['Book/01 - Глава 1.mp3', 'Book/02 - Глава 2.mp3', 'Book/cover.jpg']));
    expect(c.videos).toEqual([]);
    expect(c.audio).toEqual([]);
    expect(c.subtitles).toEqual([]);
    expect(releaseTracks(list(['Book/01.mp3', 'Book/02.mp3'])).audio).toEqual([]);
    expect(externalSummary(list(['Album/01.flac', 'Album/02.flac']))).toEqual({ dubs: 0, subtitles: false });
  });

  it('mixed case extensions, every external format', () => {
    const files = list([
      'Film/Film.MKV', 'Film/a.MKA', 'Film/b.AC3', 'Film/c.mp3', 'Film/d.aac', 'Film/e.dts', 'Film/f.eac3', 'Film/g.flac',
      'Film/h.SRT', 'Film/i.ass', 'Film/j.ssa', 'Film/k.vtt',
    ]);
    const c = classifyFiles(files);
    expect(c.videos.length).toBe(1);
    expect(c.audio.length).toBe(7);
    expect(c.subtitles.length).toBe(4);
  });

  it('ignores broken entries', () => {
    expect(classifyFiles([null as unknown as TorrentFile, { id: 1, path: 'a.mkv', length: 1 }]).videos.length).toBe(1);
    expect(classifyFiles(undefined as unknown as TorrentFile[]).videos).toEqual([]);
  });
});

describe('releaseTracks: a LostFilm-style season', () => {
  const r = releaseTracks(LOSTFILM);

  it('every dub goes to its own episode, S02E01 never to S02E11', () => {
    expect(filesOfAudio(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E01.1080p.WEB-DL.mkv')).toEqual([
      ROOT + '/Rus Sound/HDRezka Studio/The.Last.of.Us.S02E01.ac3',
      ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E01.1080p.WEB-DL.mka',
      ROOT + '/Rus Sound/Кубик в Кубе/The Last of Us - S02E01.mka',
    ]);
    expect(filesOfAudio(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E11.1080p.WEB-DL.mkv')).toEqual([
      ROOT + '/Rus Sound/HDRezka Studio/The.Last.of.Us.S02E11.ac3',
      ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E11.1080p.WEB-DL.mka',
    ]);
    expect(filesOfAudio(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E10.1080p.WEB-DL.mkv')).toEqual([
      ROOT + '/Rus Sound/LostFilm/The.Last.of.Us.S02E10.1080p.WEB-DL.mka',
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it('studio from the folder, Russian from «Rus Sound», stable ids', () => {
    expect(audioOf(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E01.1080p.WEB-DL.mkv')).toEqual([
      ['a:rus:hdrezka-studio', 'HDRezka Studio', 'rus'],
      ['a:rus:lostfilm', 'LostFilm', 'rus'],
      ['a:rus:кубик-в-кубе', 'Кубик в Кубе', 'rus'],
    ]);
    // the same dub in the next episode has the same id
    expect(audioOf(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E02.1080p.WEB-DL.mkv')).toEqual([['a:rus:lostfilm', 'LostFilm', 'rus']]);
  });

  it('subtitles: language from the folder, forced and SDH from the name', () => {
    expect(subsOf(r, LOSTFILM, ROOT + '/The.Last.of.Us.S02E01.1080p.WEB-DL.mkv')).toEqual([
      ['s:eng::sdh', 'SDH', 'eng'],
      ['s:rus::forced', 'Forced', 'rus'],
      ['s:rus:', '', 'rus'],
    ]);
    const forced = r.subtitles.filter((t) => t.forced)[0];
    expect(forced.mime).toBe('application/x-subrip');
    expect(r.subtitles.filter((t) => t.sdh)[0].lang).toBe('eng');
  });

  it('MIME hints and file index', () => {
    const t = r.audio.filter((x) => x.ext === 'ac3')[0];
    expect(t.mime).toBe('audio/ac3');
    expect(t.file.id).toBe(byPath(LOSTFILM, ROOT + '/Rus Sound/HDRezka Studio/The.Last.of.Us.S02E01.ac3').id);
    expect(r.audio.filter((x) => x.ext === 'mka')[0].mime).toBe('audio/x-matroska');
  });

  it('the episode list stays the videos', () => {
    expect(playableFiles(LOSTFILM).map((f) => f.path)).toEqual([
      ROOT + '/The.Last.of.Us.S02E01.1080p.WEB-DL.mkv',
      ROOT + '/The.Last.of.Us.S02E02.1080p.WEB-DL.mkv',
      ROOT + '/The.Last.of.Us.S02E10.1080p.WEB-DL.mkv',
      ROOT + '/The.Last.of.Us.S02E11.1080p.WEB-DL.mkv',
    ]);
    const g = groupBySeason(playableFiles(LOSTFILM));
    expect(g.length).toBe(1);
    expect(g[0].files.length).toBe(4);
  });

  it('summary: 3 dubs and subtitles', () => {
    expect(externalSummary(LOSTFILM)).toEqual({ dubs: 3, subtitles: true });
  });
});

describe('releaseTracks: tracks next to the video', () => {
  it('same name plus a suffix: studio and language from the suffix', () => {
    const files = list([
      'Show.S01.720p/Show.S01E01.720p.mkv',
      'Show.S01.720p/Show.S01E02.720p.mkv',
      'Show.S01.720p/Show.S01E01.720p.LostFilm.mka',
      'Show.S01.720p/Show.S01E01.720p.Rus.NewStudio.ac3',
      'Show.S01.720p/Show.S01E02.720p.NewStudio.ac3',
      'Show.S01.720p/Show.S01E01.720p.rus.srt',
      'Show.S01.720p/Show.S01E01.720p.eng.forced.ass',
      'Show.S01.720p/Show.S01E02.720p_Eng_SDH.srt',
    ]);
    const r = releaseTracks(files);
    expect(audioOf(r, files, 'Show.S01.720p/Show.S01E01.720p.mkv')).toEqual([
      ['a:rus:lostfilm', 'LostFilm', 'rus'],
      ['a:rus:newstudio', 'NewStudio', 'rus'],
    ]);
    expect(audioOf(r, files, 'Show.S01.720p/Show.S01E02.720p.mkv')).toEqual([['a:rus:newstudio', 'NewStudio', 'rus']]);
    expect(subsOf(r, files, 'Show.S01.720p/Show.S01E01.720p.mkv')).toEqual([
      ['s:eng::forced', 'Forced', 'eng'],
      ['s:rus:', '', 'rus'],
    ]);
    expect(subsOf(r, files, 'Show.S01.720p/Show.S01E02.720p.mkv')).toEqual([['s:eng::sdh', 'SDH', 'eng']]);
  });

  it('«Show.E1» is not the start of «Show.E10»', () => {
    const files = list(['S/Show.E1.mkv', 'S/Show.E10.mkv', 'S/Show.E10.rus.srt', 'S/Show.E1.rus.srt']);
    const r = releaseTracks(files);
    expect(r.byVideo[1].subtitles.map((t) => t.file.path)).toEqual(['S/Show.E1.rus.srt']);
    expect(r.byVideo[2].subtitles.map((t) => t.file.path)).toEqual(['S/Show.E10.rus.srt']);
  });

  it('a shorter track name that starts one video name', () => {
    const files = list(['S/Show.S01E01.1080p.mkv', 'S/Show.S01E02.1080p.mkv', 'S/Sound/Show.S01E02.mka']);
    expect(releaseTracks(files).byVideo[2].audio.length).toBe(1);
    expect(releaseTracks(files).byVideo[1].audio.length).toBe(0);
  });
});

describe('releaseTracks: season packs', () => {
  it('several seasons, the same file names in season folders, studio above or below the season', () => {
    const files = list([
      'Show/Season 1/01.mkv',
      'Show/Season 1/02.mkv',
      'Show/Season 2/01.mkv',
      'Show/Season 2/02.mkv',
      'Show/Audio/HDRezka Studio/Season 1/01.mka',
      'Show/Audio/HDRezka Studio/Season 2/02.mka',
      'Show/Audio/Season 2/AlexFilm/01.mka',
      'Show/Subs/Сезон 1/02.srt',
    ]);
    const r = releaseTracks(files);
    expect(audioOf(r, files, 'Show/Season 1/01.mkv')).toEqual([['a:rus:hdrezka-studio', 'HDRezka Studio', 'rus']]);
    expect(audioOf(r, files, 'Show/Season 1/02.mkv')).toEqual([]);
    expect(audioOf(r, files, 'Show/Season 2/01.mkv')).toEqual([['a:rus:alexfilm', 'AlexFilm', 'rus']]);
    expect(audioOf(r, files, 'Show/Season 2/02.mkv')).toEqual([['a:rus:hdrezka-studio', 'HDRezka Studio', 'rus']]);
    expect(subsOf(r, files, 'Show/Season 1/02.mkv')).toEqual([['s:und:', '', 'und']]);
    expect(r.unmatched).toEqual([]);
  });

  it('SxxEyy names across seasons in one folder', () => {
    const files = list([
      'Pack/Show.S01E01.mkv', 'Pack/Show.S02E01.mkv',
      'Pack/Rus Sound/Jaskier/Show.S02E01.mka', 'Pack/Rus Sound/Jaskier/Show.S01E01.mka',
    ]);
    const r = releaseTracks(files);
    expect(filesOfAudio(r, files, 'Pack/Show.S01E01.mkv')).toEqual(['Pack/Rus Sound/Jaskier/Show.S01E01.mka']);
    expect(filesOfAudio(r, files, 'Pack/Show.S02E01.mkv')).toEqual(['Pack/Rus Sound/Jaskier/Show.S02E01.mka']);
  });

  it('a track without a season in a pack of several: only when one video has that episode number', () => {
    const files = list(['P/Show.S01E01.mkv', 'P/Show.S02E01.mkv', 'P/Show.S02E09.mkv', 'P/Sound/TVShows/Серия 09.mka', 'P/Sound/TVShows/Серия 01.mka']);
    const r = releaseTracks(files);
    expect(filesOfAudio(r, files, 'P/Show.S02E09.mkv')).toEqual(['P/Sound/TVShows/Серия 09.mka']);
    expect(r.unmatched.map((t) => t.file.path)).toEqual(['P/Sound/TVShows/Серия 01.mka']);
  });

  it('episode numbers in many forms, leading zeros, mixed case and Cyrillic', () => {
    const files = list([
      'Сериал/Сериал.s01e01.WEBRip.mkv', 'Сериал/Сериал.s01e02.WEBRip.mkv', 'Сериал/Сериал.s01e03.WEBRip.mkv',
      'Сериал/Сериал.s01e04.WEBRip.mkv', 'Сериал/Сериал.s01e05.WEBRip.mkv',
      'Сериал/Озвучка/Пифагор/1x01.mka', 'Сериал/Озвучка/Пифагор/E002.mka', 'Сериал/Озвучка/Пифагор/Сериал - 03 [1080p].mka',
      'Сериал/Озвучка/Пифагор/04 серия.mka', 'Сериал/Озвучка/Пифагор/005.mka',
    ]);
    const r = releaseTracks(files);
    for (let i = 1; i <= 5; i++) {
      const v = r.videos[i - 1];
      expect(r.byVideo[v.id].audio.map((t) => [t.id, t.name, t.lang])).toEqual([['a:rus:пифагор', 'Пифагор', 'rus']]);
    }
  });
});

describe('releaseTracks: films', () => {
  it('a single video: every track is the film\'s, studio and language from folders and suffixes', () => {
    const files = list([
      'Dune.Part.Two.2024.2160p/Dune.Part.Two.2024.2160p.mkv',
      'Dune.Part.Two.2024.2160p/Dune.Part.Two.2024.2160p.Rus.DUB.mka',
      'Dune.Part.Two.2024.2160p/Sound/[Eng] Original/Dune.dts',
      'Dune.Part.Two.2024.2160p/Sound/Ukr/Dune.eac3',
      'Dune.Part.Two.2024.2160p/Sound/Red Head Sound/Dune.Part.Two.flac',
      'Dune.Part.Two.2024.2160p/Subs/Dune.Part.Two.2024.2160p.rus.forced.srt',
      'Dune.Part.Two.2024.2160p/Subs/Eng/full.srt',
    ]);
    const r = releaseTracks(files);
    expect(audioOf(r, files, 'Dune.Part.Two.2024.2160p/Dune.Part.Two.2024.2160p.mkv')).toEqual([
      ['a:rus:', '', 'rus'],
      ['a:eng:original', 'Original', 'eng'],
      ['a:rus:red-head-sound', 'Red Head Sound', 'rus'],
      ['a:ukr:', '', 'ukr'],
    ]);
    expect(subsOf(r, files, 'Dune.Part.Two.2024.2160p/Dune.Part.Two.2024.2160p.mkv')).toEqual([
      ['s:rus::forced', 'Forced', 'rus'],
      ['s:eng:', '', 'eng'],
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it('a year or a resolution is never an episode number', () => {
    expect(trackEpisode('Film.2026.1080p.mka')).toBeNull();
    expect(trackEpisode('2026.mka')).toBeNull();
    expect(trackEpisode('1080p.mka')).toBeNull();
    expect(trackEpisode('720p.srt')).toBeNull();
    expect(trackEpisode('Show 2026 - 1080p.mka')).toBeNull();
    expect(trackEpisode('Film.1920x1080.mka')).toBeNull();
  });

  it('a film with 4 DTS dubs stays a film (the dubs are not part of its size)', () => {
    const files: TorrentFile[] = [
      { id: 1, path: 'F/Film.2026.mkv', length: 20e9 },
      { id: 2, path: 'F/Sound/A/Film.dts', length: 4e9 },
      { id: 3, path: 'F/Sound/B/Film.dts', length: 4e9 },
      { id: 4, path: 'F/Sound/C/Film.dts', length: 4e9 },
      { id: 5, path: 'F/Sound/D/Film.dts', length: 4e9 },
    ];
    expect(hasMainVideo(files)).toBe(true);
    expect(playableFiles(files).map((f) => f.id)).toEqual([1]);
  });
});

describe('releaseTracks: no external tracks', () => {
  it('only videos: empty lists, nothing unmatched', () => {
    const files = list(['S/Show.S01E01.mkv', 'S/Show.S01E02.mkv', 'S/poster.jpg']);
    const r = releaseTracks(files);
    expect(r.audio).toEqual([]);
    expect(r.subtitles).toEqual([]);
    expect(r.byVideo[1]).toEqual({ audio: [], subtitles: [] });
    expect(externalSummary(files)).toEqual({ dubs: 0, subtitles: false });
    expect(tracksForVideo(files, 99)).toEqual({ audio: [], subtitles: [] });
  });

  it('names that say nothing: unmatched, still counted in the summary', () => {
    const files = list(['S/a.mkv', 'S/b.mkv', 'S/Rus Sound/LostFilm/x.mka']);
    const r = releaseTracks(files);
    expect(r.unmatched.length).toBe(1);
    expect(externalSummary(files)).toEqual({ dubs: 1, subtitles: false });
  });
});

describe('ids, names and episodes', () => {
  it('two files of one id for one episode get #2', () => {
    const files = list(['S/Show.S01E01.mkv', 'S/Show.S01E02.mkv', 'S/Subs/Show.S01E01.rus.srt', 'S/Subs/Show.S01E01.rus.ass']);
    const ids = releaseTracks(files).byVideo[1].subtitles.map((t) => t.id);
    expect(ids).toEqual(['s:rus:', 's:rus:#2']);
    expect(ids.map(baseTrackId)).toEqual(['s:rus:', 's:rus:']);
  });

  it('summary counts a dub once across the episodes', () => {
    const files = list(['S/Show.S01E01.mkv', 'S/Show.S01E02.mkv', 'S/Sound/A/Show.S01E01.mka', 'S/Sound/A/Show.S01E02.mka']);
    expect(externalSummary(files)).toEqual({ dubs: 1, subtitles: false });
  });

  it('cleanStudio', () => {
    expect(cleanStudio('[LostFilm]')).toBe('LostFilm');
    expect(cleanStudio('01. HDRezka Studio')).toBe('HDRezka Studio');
    expect(cleanStudio('Kubik_v_Kube')).toBe('Kubik v Kube');
    expect(cleanStudio('HDRezka.Studio')).toBe('HDRezka Studio');
  });

  it('language from a studio folder: explicit words, Cyrillic, known studios; unknown is «und»', () => {
    const files = list([
      'F/Film.mkv', 'F/Sound/Rus - Jaskier/a.mka', 'F/Sound/Кураж-Бамбей/b.mka', 'F/Sound/Студія Омікрон і Ко/c.mka', 'F/Sound/Some Studio/d.mka',
    ]);
    const r = releaseTracks(files);
    expect(r.audio.map((t) => [t.studio, t.lang])).toEqual([
      ['Jaskier', 'rus'],
      ['Some Studio', 'und'],
      ['Кураж-Бамбей', 'rus'],
      ['Студія Омікрон і Ко', 'ukr'],
    ]);
  });

  it('trackId', () => {
    expect(trackId('audio', 'rus', 'HDRezka Studio')).toBe('a:rus:hdrezka-studio');
    expect(trackId('subtitle', '', '', true, true)).toBe('s:und::forced+sdh');
  });

  it('trackEpisode forms', () => {
    expect(trackEpisode('Show.S01E11.mka')).toEqual({ season: 1, episode: 11 });
    expect(trackEpisode('show.s1.e2.srt')).toEqual({ season: 1, episode: 2 });
    expect(trackEpisode('Show 3x07.mka')).toEqual({ season: 3, episode: 7 });
    expect(trackEpisode('Show.E05.mka')).toEqual({ season: null, episode: 5 });
    expect(trackEpisode('Episode 12.mka')).toEqual({ season: null, episode: 12 });
    expect(trackEpisode('Серия 5.ac3')).toEqual({ season: null, episode: 5 });
    expect(trackEpisode('5 серия.ac3')).toEqual({ season: null, episode: 5 });
    expect(trackEpisode('Show - 07 [1080p].mka')).toEqual({ season: null, episode: 7 });
    expect(trackEpisode('07.mka')).toEqual({ season: null, episode: 7 });
    expect(trackEpisode('007. Title.mka')).toEqual({ season: null, episode: 7 });
    expect(trackEpisode('Show.mka')).toBeNull();
    expect(fileTrackEpisode('Show/Season 03/07.mka')).toEqual({ season: 3, episode: 7 });
    expect(fileTrackEpisode('Show/Сезон 2/Серия 1.mka')).toEqual({ season: 2, episode: 1 });
    expect(fileTrackEpisode('Show.S04.1080p/Rus Sound/LostFilm/07.mka')).toEqual({ season: 4, episode: 7 });
  });
});
