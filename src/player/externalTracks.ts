// The hand-off of a release's external dubs and subtitles (src/lib/externalTracks.ts) to 2160 Player.
//
// TODO(2160 Player): the player is adding Intent extras for external tracks; their keys are not published yet. Once they
// are, the only missing piece is a thin adapter that implements `ExternalTracksAdapter` below: `toExtras` turns the
// `ExternalTracksForItem` of every queue item into the player's extras, `fromResult` reads the chosen tracks back from
// the player's result. Nothing in this file invents a key. What goes to the player, per item:
//   - audio: [{ id, uri, lang, name, mime? }]: uri = the TorrServer stream of that file index (like the video's own uri),
//     lang = ISO 639-2 («rus», «und» when unknown), name = the studio («LostFilm»), mime = a hint from the extension;
//   - subtitles: the same, plus forced / sdh flags and charset? (unknown here: the player detects cp1251 by itself);
//   - start: which external dub / subtitles to select at start (null: the player's own choice, 'off': no subtitles);
//   - the result: which track ids the user ended with (and for which item), read back with `chosenTracks` and kept for
//     the series with `seriesPatchFor` (rememberSeriesTracks, src/store/seriesTracks.ts) like a choice in OMP's players.
// The same lists must go with every item of the queue, so the next episode (autoplay) starts with its own files.
import type { TorrServerClient } from '../api/torrserver';
import { baseName, type TorrentFile } from '../lib/episodes';
import { normalizeLang } from '../lib/tracks';
import type { SeriesTracks, SeriesTracksPatch } from '../lib/seriesTracks';
import { releaseTracks, type EpisodeTracks, type ExternalTrack } from '../lib/externalTracks';
import { pickExternalStart, type EmbeddedTrack, type ExternalStartSettings } from '../lib/externalTrackPick';

export interface PlayerExternalTrack {
  /** Stable across the episodes («a:rus:lostfilm»): what the player hands back. */
  id: string;
  /** The TorrServer stream of the file. */
  uri: string;
  /** ISO 639-2, «und» when unknown. */
  lang: string;
  /** Display name: the studio, '' when unknown (the player shows the language then). */
  name: string;
  mime?: string;
}

export interface PlayerExternalSubtitle extends PlayerExternalTrack {
  forced?: true;
  sdh?: true;
  /** Text encoding when known («windows-1251»); absent: the player detects it. */
  charset?: string;
}

export interface ExternalTracksForItem {
  /** The video's TorrServer file index. */
  fileIndex: number;
  audio: PlayerExternalTrack[];
  subtitles: PlayerExternalSubtitle[];
  /** The external dub to select at start; null: the player's own choice. */
  startAudio: string | null;
  /** The external subtitles to select at start, 'off', or null: the player's own choice. */
  startSubtitle: string | 'off' | null;
}

/** What the player hands back about the tracks, once its result has been read by the adapter. */
export interface ExternalTracksResult {
  /** The video (file index) the user ended on. */
  fileIndex?: number;
  /** The external dub chosen; null: an embedded track. Absent: the player did not say. */
  audioId?: string | null;
  /** The external subtitles chosen, 'off', or null: embedded ones. Absent: the player did not say. */
  subtitleId?: string | 'off' | null;
}

/** To be implemented when 2160 Player publishes its keys (see the top of this file). */
export interface ExternalTracksAdapter {
  toExtras(items: ExternalTracksForItem[]): { [key: string]: unknown };
  fromResult(raw: unknown): ExternalTracksResult;
}

type StreamClient = Pick<TorrServerClient, 'streamUrl'>;

function toPlayer(c: StreamClient, hash: string, t: ExternalTrack): PlayerExternalTrack {
  const out: PlayerExternalTrack = { id: t.id, uri: c.streamUrl(hash, t.file.id, baseName(t.file.path)), lang: t.lang, name: t.name };
  if (t.mime) out.mime = t.mime;
  return out;
}

function toPlayerSub(c: StreamClient, hash: string, t: ExternalTrack): PlayerExternalSubtitle {
  const out: PlayerExternalSubtitle = toPlayer(c, hash, t);
  if (t.forced) out.forced = true;
  if (t.sdh) out.sdh = true;
  return out;
}

/** One item of the queue: its external tracks with their stream uris and the start choice. */
export function externalTracksForItem(
  c: StreamClient,
  hash: string,
  tracks: EpisodeTracks,
  fileIndex: number,
  series: SeriesTracks | null,
  s: ExternalStartSettings,
  embedded?: { audio?: EmbeddedTrack[]; subtitles?: EmbeddedTrack[] },
): ExternalTracksForItem {
  const start = pickExternalStart(tracks, series, s, embedded);
  return {
    fileIndex,
    audio: tracks.audio.map((t) => toPlayer(c, hash, t)),
    subtitles: tracks.subtitles.map((t) => toPlayerSub(c, hash, t)),
    startAudio: start.audio,
    startSubtitle: start.subtitle,
  };
}

/** Every video of the queue (`fileIndexes`, in queue order) with its own external tracks. */
export function externalTracksForQueue(
  c: StreamClient,
  hash: string,
  files: TorrentFile[],
  fileIndexes: number[],
  series: SeriesTracks | null,
  s: ExternalStartSettings,
): ExternalTracksForItem[] {
  const r = releaseTracks(files);
  return fileIndexes.map((i) => externalTracksForItem(c, hash, r.byVideo[i] || { audio: [], subtitles: [] }, i, series, s));
}

/** The result's ids, kept only when they name a track of that item (anything else: the player did not say). */
export function chosenTracks(items: ExternalTracksForItem[], res: ExternalTracksResult): { item: ExternalTracksForItem; audio?: PlayerExternalTrack | null; subtitle?: PlayerExternalSubtitle | 'off' | null } | null {
  const item = items.filter((x) => x.fileIndex === res.fileIndex)[0] || (items.length === 1 ? items[0] : undefined);
  if (!item) return null;
  const out: { item: ExternalTracksForItem; audio?: PlayerExternalTrack | null; subtitle?: PlayerExternalSubtitle | 'off' | null } = { item };
  if (res.audioId === null) out.audio = null;
  else if (typeof res.audioId === 'string') {
    const a = item.audio.filter((x) => x.id === res.audioId)[0];
    if (a) out.audio = a;
  }
  if (res.subtitleId === null || res.subtitleId === 'off') out.subtitle = res.subtitleId;
  else if (typeof res.subtitleId === 'string') {
    const t = item.subtitles.filter((x) => x.id === res.subtitleId)[0];
    if (t) out.subtitle = t;
  }
  return out;
}

/**
 * The series' record of an external choice (rememberSeriesTracks): the dub by its studio + language, the subtitles by
 * name + language or off. An embedded choice (null) is the player's own business: nothing here. null when nothing to keep.
 */
export function seriesPatchFor(chosen: ReturnType<typeof chosenTracks>): SeriesTracksPatch | null {
  if (!chosen) return null;
  const patch: { l?: string; g?: string; s?: 'off' | { l: string; g: string } } = {};
  if (chosen.audio) {
    patch.l = chosen.audio.name;
    patch.g = normalizeLang(chosen.audio.lang);
  }
  if (chosen.subtitle === 'off') patch.s = 'off';
  else if (chosen.subtitle) patch.s = { l: chosen.subtitle.name, g: normalizeLang(chosen.subtitle.lang) };
  return patch.l !== undefined || patch.s !== undefined ? patch : null;
}
