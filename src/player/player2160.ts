// Android TV: «Плеер для видео» = 2160 Player. The queue goes to the player (OmpNative.open2160, Task 6) with the
// resume position and the «Пропуск» marks; where the user stopped (maybe on another item of the playlist) is saved
// like the built-in players' progress (local + TorrServer /viewed).
import type { TorrServerClient } from '../api/torrserver';
import type { OmpNativeTvPlugin, Open2160Request } from '../platform/androidNative';
import type { SkipPrefs } from '../lib/journal';
import { MIN_RESUME, WATCHED_RATIO } from '../store/progress';
import { saveItemProgress } from './progressSave';
import { itemHeading } from './heading';
import type { PlayItem } from './types';
import { t } from '../i18n';
import { baseName, type TorrentFile } from '../lib/episodes';
import { knownFiles } from '../lib/knownFiles';
import { releaseTracks } from '../lib/externalTracks';
import type { ExternalStartSettings } from '../lib/externalTrackPick';
import { torrents } from '../store/library';
import { settings } from '../store/settings';
import { rememberSeriesTracks, seriesTracksFor } from '../store/seriesTracks';
import {
  externalTracksForItem,
  p2160TrackExtras,
  p2160TrackResult,
  seriesPatchFromResult,
  P2160_RESULT_KEYS,
  type ExternalTracksForItem,
} from './externalTracks';

export const P2160_RELEASES_URL = 'https://github.com/spacesarmat/2160player/releases/latest';

export interface P2160Result {
  /** false: the player handed nothing back. */
  returned: boolean;
  positionMs?: number;
  durationMs?: number;
  ended?: boolean;
  /** The item the user stopped at. */
  url?: string;
  /** The result extras asked for by `resultKeys` (the chosen tracks), as the player handed them back. */
  extras?: { [key: string]: string | number | boolean };
}

/** The installed 2160 Player package, null when it is missing or the plugin cannot tell. */
export function p2160Package(plugin: Pick<OmpNativeTvPlugin, 'player2160'> | null): Promise<string | null> {
  if (!plugin || typeof plugin.player2160 !== 'function') return Promise.resolve(null);
  return Promise.resolve().then(() => plugin.player2160!()).then(
    (r) => (r && typeof r.package === 'string' && r.package ? r.package : null),
    () => null,
  );
}

/**
 * The Intent extra of the «Пропуск» marks: intro:<s>-<e>;credits:<s>- (ms). The marks apply to every item of the
 * queue, so credits go only for a single item (the duration is of the first one) and with a known duration.
 */
export function segmentsText(prefs: SkipPrefs | null, durationSec: number, singleItem = true): string {
  const out: string[] = [];
  if (prefs && prefs.mi) out.push('intro:' + Math.round(prefs.mi[0] * 1000) + '-' + Math.round(prefs.mi[1] * 1000));
  if (singleItem && prefs && prefs.mc && prefs.mc > 0 && durationSec > 0 && durationSec > prefs.mc) {
    out.push('credits:' + Math.round((durationSec - prefs.mc) * 1000) + '-');
  }
  return out.join(';');
}

function nonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;
}

/** Only well-typed fields of the plugin's answer. */
export function sanitizeP2160(r: unknown): P2160Result {
  const o = (r && typeof r === 'object' ? r : {}) as { [k: string]: unknown };
  if (o.returned !== true) return { returned: false };
  const out: P2160Result = { returned: true, ended: o.ended === true };
  const pos = nonNegative(o.positionMs);
  const dur = nonNegative(o.durationMs);
  if (pos !== undefined) out.positionMs = pos;
  if (dur !== undefined) out.durationMs = dur;
  if (typeof o.url === 'string' && o.url) out.url = o.url;
  const ex = o.extras && typeof o.extras === 'object' ? (o.extras as { [k: string]: unknown }) : null;
  if (ex) {
    const kept: { [key: string]: string | number | boolean } = {};
    let any = false;
    P2160_RESULT_KEYS.forEach((k) => {
      const v = ex[k];
      if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) {
        kept[k] = v;
        any = true;
      }
    });
    if (any) out.extras = kept;
  }
  return out;
}

type TracksClient = Pick<TorrServerClient, 'streamUrl' | 'videoSrc' | 'files'> & Partial<Pick<TorrServerClient, 'get'>>;

/** How long the launch waits for TorrServer's file list of a release this device does not know the files of. */
export const FILES_WAIT_MS = 5000;

/** The torrent's file list: TorrServer's (library copy), else the one this device saw last. */
function filesOfHash(c: Pick<TorrServerClient, 'files'> | null, hash: string): TorrentFile[] {
  const tor = torrents.peek().filter((x) => x.hash === hash)[0];
  if (tor && c) return c.files(tor);
  return knownFiles(hash);
}

/**
 * Asks TorrServer for the files of every queue release this device has none of (a release added a moment ago: its
 * list copy is the add answer, from before the metadata), so its external tracks are not lost. Remembered by
 * TorrServerClient.get (knownFiles). Never rejects; gives up after FILES_WAIT_MS.
 */
export function ensureQueueFiles(c: TracksClient | null, queue: PlayItem[], waitMs = FILES_WAIT_MS): Promise<void> {
  if (!c || typeof c.get !== 'function') return Promise.resolve();
  const get = c.get.bind(c);
  const hashes: string[] = [];
  queue.forEach((it) => {
    if (it.hash && it.fileIndex !== undefined && hashes.indexOf(it.hash) < 0 && !filesOfHash(c, it.hash).length) hashes.push(it.hash);
  });
  if (!hashes.length) return Promise.resolve();
  const all = Promise.all(hashes.map((h) => Promise.resolve().then(() => get(h)).then(() => undefined, () => undefined)));
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    all.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The external dubs and subtitles of every queue item (its own torrent's files), with the start choice of the series'
 * record and the settings. Uris carry the server's credentials like the videos' (videoSrc).
 */
export function queueExternalTracks(c: TracksClient | null, queue: PlayItem[], s: ExternalStartSettings): ExternalTracksForItem[] {
  const byHash: { [hash: string]: ReturnType<typeof releaseTracks> } = {};
  const stream = { streamUrl: (h: string, i: number, n?: string) => (c ? c.videoSrc(c.streamUrl(h, i, n)) : '') };
  return queue.map((it) => {
    const empty: ExternalTracksForItem = { fileIndex: it.fileIndex === undefined ? -1 : it.fileIndex, audio: [], subtitles: [], startAudio: null, startSubtitle: null };
    if (!c || !it.hash || it.fileIndex === undefined) return empty;
    if (!byHash[it.hash]) byHash[it.hash] = releaseTracks(filesOfHash(c, it.hash));
    const tracks = byHash[it.hash].byVideo[it.fileIndex];
    if (!tracks || (!tracks.audio.length && !tracks.subtitles.length)) return empty;
    return externalTracksForItem(stream, it.hash, tracks, it.fileIndex, seriesTracksFor(it.hash), s);
  });
}

/**
 * TorrServer starts filling its cache with the start item's chosen external dub and subtitles while the player opens
 * the video, so switching to them (or starting with them) does not wait for the swarm. Fire and forget.
 */
export function preloadStartTracks(c: Pick<TorrServerClient, 'preload' | 'files'> | null, queue: PlayItem[], index: number, items: ExternalTracksForItem[]): void {
  const it = queue[index];
  const cur = items[index];
  if (!c || !it || !it.hash || !cur) return;
  const ids: string[] = [];
  if (cur.startAudio) ids.push(cur.startAudio);
  if (cur.startSubtitle && cur.startSubtitle !== 'off') ids.push(cur.startSubtitle);
  if (!ids.length) return;
  const r = releaseTracks(filesOfHash(c, it.hash)).byVideo[cur.fileIndex];
  if (!r) return;
  r.audio.concat(r.subtitles).forEach((tr) => {
    if (ids.indexOf(tr.id) >= 0) c.preload(it.hash!, tr.file.id, baseName(tr.file.path));
  });
}

/** Keeps the dub / subtitles the user changed to for the series (nothing when unchanged, picked by OMP, or a film). */
function rememberP2160Tracks(c: TorrServerClient | null, item: PlayItem | undefined, queue: PlayItem[], items: ExternalTracksForItem[], r: P2160Result, index: number): void {
  if (!c || !item || !item.hash || item.fileIndex === undefined || !r.extras) return;
  const res = p2160TrackResult(r.extras, item.fileIndex);
  const own = items.filter((x, i) => queue[i] && queue[i].hash === item.hash);
  const start = queue[index] && queue[index].hash === item.hash ? items[index] : undefined;
  const patch = seriesPatchFromResult(own, res, seriesTracksFor(item.hash), start);
  if (patch) rememberSeriesTracks(c, item.hash, patch);
}

/** `link` (hash) and `index` (file) of a TorrServer stream URL, null when it is not one. */
function streamRef(url: string): { hash: string; index: number } | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  let hash = '';
  let index = -1;
  url.slice(q + 1).split('&').forEach((kv) => {
    const eq = kv.indexOf('=');
    if (eq < 0) return;
    let v = kv.slice(eq + 1);
    try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
    const k = kv.slice(0, eq);
    if (k === 'link') hash = v.toLowerCase();
    else if (k === 'index' && /^\d+$/.test(v)) index = parseInt(v, 10);
  });
  return hash && index >= 0 ? { hash, index } : null;
}

/** The queue item the player's url stands for (exact url, with or without credentials, or the link/index params). */
function itemOfUrl(c: TorrServerClient | null, queue: PlayItem[], url: string): PlayItem | undefined {
  const exact = queue.find((i) => i.url === url || (c ? c.videoSrc(i.url) === url : false));
  if (exact) return exact;
  const ref = streamRef(url);
  if (!ref) return undefined;
  return queue.find((i) => !!i.hash && i.fileIndex === ref.index && i.hash.toLowerCase() === ref.hash);
}

export interface P2160Saved {
  item: PlayItem;
  /** Seconds where the user stopped. */
  time: number;
  duration: number;
  ended: boolean;
}

/**
 * Saves what the player handed back. Watched only when it reported a position at or past WATCHED_RATIO of the
 * length (a real finish, or a close near the end). `ended` with no such position does not count: 2160 Player can
 * close while the file is still opening and say it finished, and the length already stored must not be written
 * back as the position. A position of MIN_RESUME or more is kept. An url that matches no item saves nothing in a
 * queue of several items (a single item takes it).
 */
export function saveP2160Result(
  c: TorrServerClient | null,
  queue: PlayItem[],
  startIndex: number,
  r: P2160Result,
  knownDuration: number,
): P2160Saved | null {
  if (!r.returned) return null;
  let item: PlayItem | undefined = queue[startIndex];
  if (r.url) {
    const hit = itemOfUrl(c, queue, r.url);
    if (hit) item = hit;
    else if (queue.length > 1) return null;
  }
  if (!item || !item.hash || item.fileIndex === undefined) return null;
  const hash = item.hash;
  const idx = item.fileIndex;
  const known = item === queue[startIndex] ? knownDuration : 0;
  const reportedDur = r.durationMs !== undefined && r.durationMs > 0 ? r.durationMs / 1000 : 0;
  const dur = reportedDur > 0 ? reportedDur : known;
  const rawPos = r.positionMs;
  const hasPos = typeof rawPos === 'number';
  const pos = hasPos ? rawPos / 1000 : -1;
  // the length we already knew is only the denominator. It is never written as the position.
  const nearEnd = pos >= 0 && dur > 0 && pos / dur >= WATCHED_RATIO;
  if (nearEnd) {
    const time = pos > dur ? dur : pos;
    saveItemProgress(c, item, time, dur, true);
    return { item, time: time, duration: dur, ended: true };
  }
  if (!hasPos || pos < MIN_RESUME) return { item, time: 0, duration: dur, ended: false };
  if (dur > 0) saveItemProgress(c, item, pos, dur, true);
  // no duration anywhere: only the server's resume point can be kept
  else if (c) c.setViewed(hash, idx, Math.floor(pos)).catch(() => undefined);
  return { item, time: pos, duration: dur, ended: false };
}

let busy = false;

/**
 * Opens the queue in 2160 Player from `startAt` seconds (below MIN_RESUME: from the start) and saves the position it
 * hands back (resolved with what was saved, null when nothing). `cancelled`: asked once the queue's files are known;
 * true opens nothing (null). A call while one is open does nothing; rejects with the plugin's (native, translated) error.
 */
export function play2160(
  plugin: Pick<OmpNativeTvPlugin, 'open2160'>,
  c: TorrServerClient | null,
  queue: PlayItem[],
  index: number,
  startAt: number,
  prefs: SkipPrefs | null,
  knownDuration: number,
  cancelled?: () => boolean,
): Promise<P2160Saved | null> {
  if (busy) return Promise.resolve(null);
  const open = plugin.open2160;
  if (typeof open !== 'function') return Promise.reject(new Error(t('nativePlayer.unavailable')));
  busy = true;
  // the files may take a few seconds: a screen left meanwhile (Back) opens no player over the one it went back to
  return ensureQueueFiles(c, queue).then(() => (cancelled && cancelled() ? null : open2160(plugin, open, c, queue, index, startAt, prefs, knownDuration))).then(
    (saved) => {
      busy = false;
      return saved;
    },
    (e) => {
      busy = false;
      throw e;
    },
  );
}

function open2160(
  plugin: Pick<OmpNativeTvPlugin, 'open2160'>,
  open: NonNullable<OmpNativeTvPlugin['open2160']>,
  c: TorrServerClient | null,
  queue: PlayItem[],
  index: number,
  startAt: number,
  prefs: SkipPrefs | null,
  knownDuration: number,
): Promise<P2160Saved | null> {
  const fromStart = startAt < MIN_RESUME;
  const s = settings.peek();
  let tracks: ExternalTracksForItem[] = [];
  try {
    tracks = queueExternalTracks(c, queue, { audioLang: s.audioLang, subLang: s.subLang, subtitlesOn: s.subtitlesOn });
  } catch (e) {
    tracks = [];
  }
  const extras = p2160TrackExtras(tracks, index);
  const o: Open2160Request = {
    items: queue.map((i) => ({ url: c ? c.videoSrc(i.url) : i.url, title: itemHeading(i) })),
    start: index,
    positionMs: fromStart ? 0 : Math.floor(startAt) * 1000,
    fromStart,
    segments: segmentsText(prefs, knownDuration, queue.length === 1),
    resultKeys: P2160_RESULT_KEYS,
  };
  // the native side drops items without a url (Player2160.playable), which would shift the per-item track lists
  const aligned = o.items.every((i) => !!(i.url || '').trim());
  if (aligned && Object.keys(extras).length) o.extras = extras;
  preloadStartTracks(c, queue, index, tracks);
  return Promise.resolve().then(() => open.call(plugin, o)).then((raw) => {
    const r = sanitizeP2160(raw);
    const saved = saveP2160Result(c, queue, index, r, knownDuration);
    if (r.returned) rememberP2160Tracks(c, saved ? saved.item : queue[index], queue, tracks, r, index);
    return saved;
  });
}
