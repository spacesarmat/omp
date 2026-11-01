// The hand-off of a release's external dubs and subtitles (src/lib/externalTracks.ts) to 2160 Player, by its Intent API
// (2160 Player docs/API.md §3.7, released in 2160 Player 0.2.17). Every key name and value format of it lives in
// P2160_TRACKS below and nowhere else (the Kotlin side puts and reads the keys it is given), so a change of the
// player's format is a change of this one object. What goes to the player:
//   - AUDIO_TRACKS / TEXT_TRACKS: String[], element i = the JSON array of the tracks of queue item i
//     ({ uri, language, name, mime, id, charset }; charset for subtitles only); uri = the TorrServer stream of that
//     file index (like the video's). OMP sends no delayMs (it knows no offset) and no per-track select (the start
//     choice goes as *_SELECT, which beats both the track's select and the player's history of the file);
//   - AUDIO_SELECT / TEXT_SELECT: the start item's choice («id:<id>», «off», «embedded:<n>»), from the series' record
//     and the settings (pickExternalStart); the player carries it to the next items of the playlist by id, then name,
//     then language. «embedded:<n>» is a built-in track the user picked (omp.a.e). OMP does not send «index:<n>».
//     TEXT_SELECT is not cleared when the audio choice is a built-in track: subtitles stay selected. 2160 Player
//     0.2.17 itself hides an external subtitle on screen when the audio track changes. OMP does not send TEXT_OFF
//     for that. A result is saved as off only when the player reports TEXT_OFF;
//   - the result: which track the user ended with (AUDIO_ID / TEXT_ID with AUDIO_EXTERNAL / TEXT_EXTERNAL = true for
//     an external one, by its id; an embedded one by AUDIO_NAME + AUDIO_LANGUAGE; TEXT_OFF), kept for the series
//     (rememberSeriesTracks, src/store/seriesTracks.ts) like a choice in OMP's own players, only when changed by hand.
// A TorrServer link has a query, so the player does not look for sidecar files itself: AUDIO_TRACKS is the only way
// it gets them. A file it can not open gives a warning and the video goes on with its own track.
import type { TorrServerClient } from '../api/torrserver';
import { baseName, type TorrentFile } from '../lib/episodes';
import { normalizeLang } from '../lib/tracks';
import { dubOf, isReset, sameDub, type SeriesSub, type SeriesTracks, type SeriesTracksPatch } from '../lib/seriesTracks';
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
  /** Built-in audio to select (`embedded:N`). Wins over startAudio. */
  startEmbedded?: number;
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
  /** Built-in audio index (AUDIO_EMBEDDED_INDEX, or AUDIO_ID «embedded:N»). */
  audioEmbedded?: number;
  /** Embedded subtitles chosen: their title and language. */
  subtitleName?: string;
  subtitleLang?: string;
}

/**
 * 2160 Player's Intent keys and value formats for external tracks (§3.7, 2160 Player 0.2.17). The one place to change
 * them.
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

function trackJson(t: PlayerExternalTrack): { [k: string]: string } {
  const o: { [k: string]: string } = { uri: t.uri, id: t.id };
  const lang = normalizeLang(t.lang) ? t.lang : '';
  if (lang) o.language = lang;
  if (t.name) o.name = t.name;
  if (t.mime) o.mime = t.mime;
  return o;
}

/** A subtitle's JSON: a track's plus `charset`, which the player reads for subtitles only. */
function subtitleJson(t: PlayerExternalSubtitle): { [k: string]: string } {
  const o = trackJson(t);
  if (t.charset) o.charset = t.charset;
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
  if (anyText) out[P2160_TRACKS.textTracks] = items.map((x) => JSON.stringify(x.subtitles.map(subtitleJson)));
  const cur = items[start];
  if (cur && typeof cur.startEmbedded === 'number') out[P2160_TRACKS.audioSelect] = 'embedded:' + String(cur.startEmbedded);
  else if (cur && cur.startAudio) out[P2160_TRACKS.audioSelect] = P2160_TRACKS.selectId + cur.startAudio;
  if (cur && cur.startSubtitle === 'off') {
    // «off» only matters when there is something to switch off: the player's own default is kept otherwise
    if (cur.subtitles.length) out[P2160_TRACKS.textSelect] = P2160_TRACKS.selectOff;
  } else if (cur && cur.startSubtitle) out[P2160_TRACKS.textSelect] = P2160_TRACKS.selectId + cur.startSubtitle;
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** A built-in track index: 0..63. -1 and anything else mean the player did not name one. */
function embeddedIndex(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 && v < 64 && Math.floor(v) === v ? v : undefined;
}

function embeddedFromId(id: string): number | undefined {
  const m = /^embedded:(\d{1,2})$/.exec(id);
  if (!m) return undefined;
  return embeddedIndex(parseInt(m[1], 10));
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
    const idx = embeddedIndex(o[k.audioEmbeddedIndex]);
    const fromId = embeddedFromId(aId);
    if (idx !== undefined) out.audioEmbedded = idx;
    else if (fromId !== undefined) out.audioEmbedded = fromId;
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
  const item: ExternalTracksForItem = {
    fileIndex,
    audio: tracks.audio.map((t) => toPlayer(c, hash, t)),
    subtitles: tracks.subtitles.map((t) => toPlayerSub(c, hash, t)),
    startAudio: start.audio,
    startSubtitle: start.subtitle,
  };
  if (typeof start.embedded === 'number') item.startEmbedded = start.embedded;
  return item;
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
  const patch: { l?: string; g?: string; s?: 'off' | SeriesSub } = {};
  if (chosen.audio) {
    patch.l = chosen.audio.name;
    patch.g = normalizeLang(chosen.audio.lang);
  }
  if (chosen.subtitle === 'off') patch.s = 'off';
  else if (chosen.subtitle) {
    const l = chosen.subtitle.name;
    const g = normalizeLang(chosen.subtitle.lang);
    // no title and no language (a nameless .ass): only its id finds it in the next episode; the «#2» part stays, so
    // the second of two nameless files (an .srt and an .ass) is the one found again
    patch.s = l || g ? { l, g } : { l, g, i: chosen.subtitle.id };
  }
  return patch.l !== undefined || patch.s !== undefined ? patch : null;
}

/**
 * What to remember for the series from the player's answer: the external choice (seriesPatchFor), else an embedded dub
 * by its title + language and embedded subtitles by title + language. Only a change by hand counts: a track OMP itself
 * asked for (`start` = the start item, or the item's own pick) is no new choice, so a fallback dub picked because the
 * series' one was missing never replaces it; an embedded track counts when OMP had asked for an external one, or when
 * its index is not the built-in index OMP itself sent (`startEmbedded`). Otherwise it may be the player's own default.
 * A built-in choice keeps the subtitles: TEXT_OFF is recorded only when the player says subtitles are off, and OMP
 * never sends TEXT_OFF just because the audio changed. Parts equal to the series' record are dropped, so a plain
 * return writes nothing. null when nothing to keep.
 */
export function seriesPatchFromResult(
  items: ExternalTracksForItem[],
  res: ExternalTracksResult,
  current: SeriesTracks | null,
  start?: ExternalTracksForItem,
): SeriesTracksPatch | null {
  const chosen = chosenTracks(items, res);
  const item = chosen ? chosen.item : undefined;
  const autoAudio = [item ? item.startAudio : null, start ? start.startAudio : null].filter((x): x is string => !!x);
  const autoSub = [item ? item.startSubtitle : null, start ? start.startSubtitle : null].filter((x): x is string => !!x);
  const r: ExternalTracksResult = { ...res };
  if (typeof r.audioId === 'string' && autoAudio.indexOf(r.audioId) >= 0) delete r.audioId;
  // -1: OMP did not ask for a built-in track. Index 0 is a real choice.
  const sentEmbedded = start && typeof start.startEmbedded === 'number' ? start.startEmbedded : -1;
  const sameEmbedded = sentEmbedded >= 0 && (r.audioEmbedded === undefined || r.audioEmbedded === sentEmbedded);
  if (r.audioId === null && !autoAudio.length && (sentEmbedded < 0 || sameEmbedded)) delete r.audioId;
  if (typeof r.subtitleId === 'string' && autoSub.indexOf(r.subtitleId) >= 0) delete r.subtitleId;
  if ((r.subtitleId === null || r.subtitleId === 'off') && !autoSub.length) delete r.subtitleId;
  res = r;
  const ext = seriesPatchFor(chosenTracks(items, res));
  const patch: { l?: string; g?: string; s?: 'off' | SeriesSub; e?: number } = ext && ext !== 'reset' ? { ...ext } : {};
  if (patch.l === undefined && res.audioId === null) {
    if (typeof res.audioEmbedded === 'number') patch.e = res.audioEmbedded;
    const l = dubOf({ title: res.audioName });
    if (l) {
      patch.l = l;
      patch.g = normalizeLang(res.audioLang);
    } else if (typeof res.audioEmbedded === 'number' && res.audioLang) {
      patch.g = normalizeLang(res.audioLang);
    }
  }
  // An embedded subtitle here is whatever was on screen, including the player's own default. 2160 Player
  // does not say the user picked it. Remember it when OMP had asked for something else: an external subtitle,
  // or subtitles off. A plain resume (nothing asked) must not write the default (MHA E01 wrote s: Crunchyroll).
  const asked = [item ? item.startSubtitle : null, start ? start.startSubtitle : null];
  const askedSub = asked.some((s) => !!s && s !== 'off') || asked.some((s) => s === 'off');
  if (patch.s === undefined && askedSub && res.subtitleId === null && (res.subtitleName || res.subtitleLang)) {
    const l = dubOf({ title: res.subtitleName });
    if (l) patch.s = { l, g: normalizeLang(res.subtitleLang) };
  }
  const rec = current && !isReset(current) ? current : null;
  const hadE = rec && typeof rec.e === 'number' ? rec.e : -1;
  const nextE = patch.e !== undefined ? patch.e : -1;
  // same label is not "unchanged" when the choice moves between a built-in track and an external file
  if (hadE === nextE && rec && patch.l !== undefined && sameDub(rec.l, patch.l) && normalizeLang(rec.g) === (patch.g || '')) {
    delete patch.l;
    delete patch.g;
  }
  if (rec && patch.e !== undefined && rec.e === patch.e) delete patch.e;
  if (rec && patch.s !== undefined) {
    const was = rec.s;
    const same = patch.s === 'off'
      ? was === 'off'
      : !!was && was !== 'off' && normalizeLang(was.g) === patch.s.g && (was.i || '') === (patch.s.i || '') &&
        (was.l === patch.s.l || sameDub(was.l, patch.s.l));
    if (same) delete patch.s;
  }
  return patch.l !== undefined || patch.g !== undefined || patch.s !== undefined || patch.e !== undefined ? patch : null;
}
