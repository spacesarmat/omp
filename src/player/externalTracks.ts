// The hand-off of a release's external dubs and subtitles (src/lib/externalTracks.ts) to 2160 Player, by its Intent API
// (2160 Player docs/API.md §3.7, spacesarmat/2160player PR #20). The format is preliminary: every key name and value
// format of it lives in P2160_TRACKS below and nowhere else (the Kotlin side puts and reads the keys it is given), so a
// change of the player's format is a change of this one object. What goes to the player:
//   - AUDIO_TRACKS / TEXT_TRACKS: String[], element i = the JSON array of the tracks of queue item i
//     ({ uri, language, name, mime, id, charset }); uri = the TorrServer stream of that file index (like the video's);
//   - AUDIO_SELECT / TEXT_SELECT: the start item's choice («id:<id>», «off»), from the series' record and the settings
//     (pickExternalStart); the player carries it to the next items of the playlist by id, then name, then language;
//   - the result: which track the user ended with (external by id, embedded by name + language), kept for the series
//     (rememberSeriesTracks, src/store/seriesTracks.ts) like a choice in OMP's own players.
import type { TorrServerClient } from '../api/torrserver';
import { baseName, type TorrentFile } from '../lib/episodes';
import { normalizeLang } from '../lib/tracks';
import { dubOf, isReset, sameDub, type SeriesTracks, type SeriesTracksPatch } from '../lib/seriesTracks';
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
  /** An embedded dub chosen: its title and language as the player tells them. */
  audioName?: string;
  audioLang?: string;
  /** Embedded subtitles chosen: their title and language. */
  subtitleName?: string;
  subtitleLang?: string;
}

/**
 * 2160 Player's Intent keys and value formats for external tracks (preliminary, §3.7). The one place to change them.
 * Chromium 53: no Object.values, so the result keys are listed by P2160_RESULT_KEYS.
 */
export const P2160_TRACKS = {
  audioTracks: 'tv.p2160.extra.AUDIO_TRACKS',
  textTracks: 'tv.p2160.extra.TEXT_TRACKS',
  audioSelect: 'tv.p2160.extra.AUDIO_SELECT',
  textSelect: 'tv.p2160.extra.TEXT_SELECT',
  selectId: 'id:',
  selectOff: 'off',
  result: {
    audioId: 'tv.p2160.extra.AUDIO_ID',
    audioName: 'tv.p2160.extra.AUDIO_NAME',
    audioLang: 'tv.p2160.extra.AUDIO_LANGUAGE',
    audioExternal: 'tv.p2160.extra.AUDIO_EXTERNAL',
    audioEmbeddedIndex: 'tv.p2160.extra.AUDIO_EMBEDDED_INDEX',
    audioExternalIndex: 'tv.p2160.extra.AUDIO_EXTERNAL_INDEX',
    textOff: 'tv.p2160.extra.TEXT_OFF',
    textId: 'tv.p2160.extra.TEXT_ID',
    textName: 'tv.p2160.extra.TEXT_NAME',
    textLang: 'tv.p2160.extra.TEXT_LANGUAGE',
    textExternal: 'tv.p2160.extra.TEXT_EXTERNAL',
    textEmbeddedIndex: 'tv.p2160.extra.TEXT_EMBEDDED_INDEX',
    textExternalIndex: 'tv.p2160.extra.TEXT_EXTERNAL_INDEX',
  },
};

/** The result keys the native side reads back from the player's answer. */
export const P2160_RESULT_KEYS: string[] = (() => {
  const r = P2160_TRACKS.result as { [k: string]: string };
  const out: string[] = [];
  for (const k in r) if (Object.prototype.hasOwnProperty.call(r, k)) out.push(r[k]);
  return out;
})();

/** The extras the player gets (String or String[] values); every key starts with this. */
export const P2160_EXTRA_PREFIX = 'tv.p2160.extra.';

export type P2160Extras = { [key: string]: string | string[] };

function trackJson(t: PlayerExternalTrack | PlayerExternalSubtitle): { [k: string]: string } {
  const o: { [k: string]: string } = { uri: t.uri, id: t.id };
  const lang = normalizeLang(t.lang) ? t.lang : '';
  if (lang) o.language = lang;
  if (t.name) o.name = t.name;
  if (t.mime) o.mime = t.mime;
  const cs = (t as PlayerExternalSubtitle).charset;
  if (cs) o.charset = cs;
  return o;
}

/**
 * The player's extras for the queue (`items` in queue order, `start` = the start item): {} when no item has an external
 * track, so a release without them launches exactly as before.
 */
export function p2160TrackExtras(items: ExternalTracksForItem[], start: number): P2160Extras {
  const out: P2160Extras = {};
  const anyAudio = items.some((x) => x.audio.length > 0);
  const anyText = items.some((x) => x.subtitles.length > 0);
  if (anyAudio) out[P2160_TRACKS.audioTracks] = items.map((x) => JSON.stringify(x.audio.map(trackJson)));
  if (anyText) out[P2160_TRACKS.textTracks] = items.map((x) => JSON.stringify(x.subtitles.map(trackJson)));
  const cur = items[start];
  if (cur && cur.startAudio) out[P2160_TRACKS.audioSelect] = P2160_TRACKS.selectId + cur.startAudio;
  if (cur && cur.startSubtitle === 'off') {
    // «off» only matters when there is something to switch off: the player's own default is kept otherwise
    if (cur.subtitles.length) out[P2160_TRACKS.textSelect] = P2160_TRACKS.selectOff;
  } else if (cur && cur.startSubtitle) out[P2160_TRACKS.textSelect] = P2160_TRACKS.selectId + cur.startSubtitle;
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The tracks part of the player's answer (`raw`: result key → value as the native side read it). An absent key means
 * the player did not say (an older 2160 Player answers none of them).
 */
export function p2160TrackResult(raw: unknown, fileIndex?: number): ExternalTracksResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { [k: string]: unknown };
  const k = P2160_TRACKS.result;
  const out: ExternalTracksResult = {};
  if (fileIndex !== undefined) out.fileIndex = fileIndex;
  const aId = str(o[k.audioId]);
  if (o[k.audioExternal] === true && aId) out.audioId = aId;
  else if (o[k.audioExternal] === false) {
    out.audioId = null;
    const n = str(o[k.audioName]);
    const g = str(o[k.audioLang]);
    if (n) out.audioName = n;
    if (g) out.audioLang = g;
  }
  const tId = str(o[k.textId]);
  if (o[k.textOff] === true) out.subtitleId = 'off';
  else if (o[k.textExternal] === true && tId) out.subtitleId = tId;
  else if (o[k.textExternal] === false) {
    out.subtitleId = null;
    const n = str(o[k.textName]);
    const g = str(o[k.textLang]);
    if (n) out.subtitleName = n;
    if (g) out.subtitleLang = g;
  }
  return out;
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

/**
 * What to remember for the series from the player's answer: the external choice (seriesPatchFor), else an embedded dub
 * by its title + language and embedded subtitles by title + language. Parts equal to the series' record are dropped,
 * so a plain return writes nothing. null when nothing to keep.
 */
export function seriesPatchFromResult(items: ExternalTracksForItem[], res: ExternalTracksResult, current: SeriesTracks | null): SeriesTracksPatch | null {
  const ext = seriesPatchFor(chosenTracks(items, res));
  const patch: { l?: string; g?: string; s?: 'off' | { l: string; g: string } } = ext && ext !== 'reset' ? { ...ext } : {};
  if (patch.l === undefined && res.audioId === null) {
    const l = dubOf({ title: res.audioName });
    if (l) {
      patch.l = l;
      patch.g = normalizeLang(res.audioLang);
    }
  }
  if (patch.s === undefined && res.subtitleId === null && (res.subtitleName || res.subtitleLang)) {
    patch.s = { l: dubOf({ title: res.subtitleName }), g: normalizeLang(res.subtitleLang) };
  }
  const rec = current && !isReset(current) ? current : null;
  if (rec && patch.l !== undefined && sameDub(rec.l, patch.l) && normalizeLang(rec.g) === (patch.g || '')) {
    delete patch.l;
    delete patch.g;
  }
  if (rec && patch.s !== undefined) {
    const was = rec.s;
    const same = patch.s === 'off'
      ? was === 'off'
      : !!was && was !== 'off' && normalizeLang(was.g) === patch.s.g && (was.l === patch.s.l || sameDub(was.l, patch.s.l));
    if (same) delete patch.s;
  }
  return patch.l !== undefined || patch.s !== undefined ? patch : null;
}
