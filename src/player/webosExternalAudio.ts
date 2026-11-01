// External dubs (src/lib/externalTracks.ts) on the LG webOS player. The <video> element cannot take a second
// file, so each dub is one more row in the same audio list and, when chosen, a separate <audio> element
// (src/player/externalDubSync.ts). Ids stay the release's own («a:rus:lostfilm»): the series record is still the
// studio and the language (omp.a), and a built-in choice is still embedded index `e`, the same as 2160 Player.
//
// What the webOS HTML media element can decode (the TV's media service, not Chrome's; webOS 3.x is Chromium 53,
// and later webOS keeps that service):
// - Plays, when the set's license has the codec: AAC and HE-AAC, MP3, AC-3, E-AC-3 (E-AC-3 mostly from webOS 3.5),
//   WAV/LPCM. Containers we ask it to open: mka, mkv, m4a, m4b, mp4, mp3, aac, ac3, eac3, wav.
// - mka is Matroska audio. The TV plays Matroska for video, so an mka of AAC, MP3, AC-3 or E-AC-3 often plays in
//   <audio>. Some sets accept mka only on <video>; a refusal is a media error and the built-in track comes back.
// - Does not decode in the media element: DTS, DTS-HD, TrueHD (passthrough on optical/ARC in LG's own player; the
//   media element has no passthrough), FLAC (the Music app on webOS 4+ plays FLAC files; the HTML pipeline on
//   webOS 3.x does not), Opus, Vorbis, ALAC, APE, WavPack. Those extensions never start a dub; the torrent screen
//   says so only when every external dub is one of them. An mka hides its codec, so it is always tried.
// - webOS 1-3 has one hardware media pipeline. The built-in tracks are disabled and the video muted while a dub
//   plays. If that still stops the picture, the link drops the dub and the built-in track returns.
//
// Chromium 53: no lookbehind, no named groups, no Object.values.
import type { Torrent } from '../api/types';
import { baseName, type TorrentFile } from '../lib/episodes';
import { releaseTracks, type ExternalTrack } from '../lib/externalTracks';
import { pickExternalStart } from '../lib/externalTrackPick';
import { knownFiles } from '../lib/knownFiles';
import { normalizeLang } from '../lib/tracks';
import type { SeriesTracks } from '../lib/seriesTracks';
import type { TrackOption } from './trackOptions';
import { pickAudioFor, seriesAudioFromChoice } from './trackPrefs';
import type { TrackPref } from '../store/trackPrefs';
import { torrents } from '../store/library';

/** Extensions the media element is asked to play. Anything else is treated as undecodable (see the file header). */
const PLAYABLE_EXT: { [k: string]: true } = {
  mka: true, mkv: true, m4a: true, m4b: true, aac: true, mp3: true, mp4: true, wav: true,
  ac3: true, eac3: true, ec3: true,
};

export interface WebosAudioOption extends TrackOption {
  /** Stable id («a:rus:lostfilm»). Absent on a built-in track. */
  externalId?: string;
  /** TorrServer stream, already passed through videoSrc. */
  externalUrl?: string;
  /** TorrServer file index, for preload. */
  externalFile?: number;
  /** File name passed to preload. */
  externalName?: string;
}

export interface DubStreamClient {
  streamUrl(hash: string, fileIndex: number, name?: string): string;
  videoSrc(url: string): string;
  files(t: Torrent): TorrentFile[];
}

/** The release's file list: the library copy, else the list this device saw last. */
export function filesForHash(c: Pick<DubStreamClient, 'files'> | null, hash: string): TorrentFile[] {
  const list = torrents.value;
  for (let i = 0; i < list.length; i++) {
    if (list[i].hash === hash) return c ? c.files(list[i]) : knownFiles(hash);
  }
  return knownFiles(hash);
}

/** External dubs of one episode; [] when the file list has none or `fileIndex` is missing. */
export function episodeExternalAudio(files: TorrentFile[], fileIndex: number | undefined): ExternalTrack[] {
  if (fileIndex === undefined || !files || !files.length) return [];
  const ep = releaseTracks(files).byVideo[fileIndex];
  return ep && ep.audio ? ep.audio : [];
}

/** True when the extension is one the media element is asked to open. */
export function webosMayPlayDub(ext: string): boolean {
  return !!PLAYABLE_EXT[(ext || '').toLowerCase()];
}

/**
 * The torrent-screen warning. True only when the release has external dubs and none of them use a container the
 * media element can open (every file is DTS, FLAC, Opus, ...). One mka is enough to stay quiet: the codec inside
 * it is not known until the player tries.
 */
export function webosExternalBlocked(files: TorrentFile[]): boolean {
  const audio = releaseTracks(files || []).audio;
  if (!audio.length) return false;
  for (let i = 0; i < audio.length; i++) if (webosMayPlayDub(audio[i].ext)) return false;
  return true;
}

/** «RU · MKA · LostFilm»: language, container, studio. The studio is also `title`, so the series record keeps it. */
export function externalAudioLabel(t: ExternalTrack): string {
  const lang = normalizeLang(t.lang);
  const parts = [lang ? lang.toUpperCase() : '', (t.ext || '').toUpperCase(), t.name || ''];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
  return out.join(' · ');
}

export function externalOption(t: ExternalTrack, url: string): WebosAudioOption {
  const opt: WebosAudioOption = {
    label: externalAudioLabel(t),
    language: normalizeLang(t.lang),
    isDefault: false,
    externalId: t.id,
    externalUrl: url,
    externalFile: t.file.id,
    externalName: baseName(t.file.path),
  };
  if (t.name) opt.title = t.name;
  return opt;
}

/** The stream url of one dub, with the server's credentials, the same way the video src is built. */
export function dubStreamUrl(c: Pick<DubStreamClient, 'streamUrl' | 'videoSrc'> | null, hash: string, t: ExternalTrack): string {
  if (!c || !hash) return '';
  return c.videoSrc(c.streamUrl(hash, t.file.id, baseName(t.file.path)));
}

/** Built-in rows first (their index is the <video> audio track), then the episode's external dubs. */
export function mergeWebosAudio(
  builtin: TrackOption[],
  external: ExternalTrack[],
  urlOf: (t: ExternalTrack) => string,
): WebosAudioOption[] {
  const out: WebosAudioOption[] = [];
  for (let i = 0; i < builtin.length; i++) out.push(builtin[i]);
  for (let i = 0; i < external.length; i++) out.push(externalOption(external[i], urlOf(external[i])));
  return out;
}

/**
 * Which row to start on. A saved built-in index (`e`) wins when it still matches this file. Otherwise the same
 * order as the built-in player, over the combined list: built-in rows are first, so a studio or a language that
 * the video already has stays on the video. An external row is chosen when it is the first match.
 */
export function webosAudioIndex(
  builtin: TrackOption[],
  external: ExternalTrack[],
  series: SeriesTracks | null,
  pref: TrackPref | null,
  audioLang: string,
): number {
  const all = mergeWebosAudio(builtin, external, () => '');
  if (!all.length) return -1;
  const embedded: { title?: string; label?: string; language?: string }[] = [];
  for (let i = 0; i < builtin.length; i++) {
    embedded.push({ title: builtin[i].title, label: builtin[i].label, language: builtin[i].language });
  }
  const start = pickExternalStart(
    { audio: external, subtitles: [] },
    series,
    { audioLang: audioLang || '', subLang: '', subtitlesOn: false },
    { audio: embedded },
  );
  if (typeof start.embedded === 'number' && start.embedded >= 0 && start.embedded < builtin.length) return start.embedded;
  return pickAudioFor(all, series, pref, audioLang);
}

/**
 * What a hand-made audio choice writes for the series. An external dub stores the studio and the language and
 * clears a built-in index. A built-in row stores that index too (`e`), so the next episode and 2160 Player can
 * tell it from an external file of the same name.
 */
export function webosSeriesAudioPatch(audio: WebosAudioOption[], i: number) {
  const base = seriesAudioFromChoice(audio, i);
  const opt = audio[i];
  if (opt && opt.externalId) return base;
  return { ...base, e: i };
}
