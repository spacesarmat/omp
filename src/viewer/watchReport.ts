// Batched playback signals for POST /v1/watch-signals.
// Off when «Помогать улучшать подбор» is off. Nothing is sent without a billing context.
// webOS has no native HTTP, so the same form body goes out by XHR. Phone and Android TV use native HTTP.
import { BILLING_ORIGIN } from '../billing/config';
import { billingPost } from '../billing/client';
import { billingSession, deviceId } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { settings } from '../store/settings';
import { parseEpisode } from '../lib/episodes';
import { progressTitleKey } from './tracks';
import { nativeSourceHttp } from '../platform/androidNative';
import { tvSourceContext } from '../sources/tvContext';
import type { SourceContext } from '../sources/types';
import { setWatchDeviceClass as setClass, watchDeviceClass as currentClass, type WatchClass } from './watchDevice';

export type { WatchClass };
export function setWatchDeviceClass(kind: WatchClass): void {
  setClass(kind);
}
export function watchDeviceClass(): WatchClass {
  return currentClass();
}

export interface WatchSample {
  infohash: string;
  file: number;
  title: string;
  /** Current file name. Used when the torrent title has no season or episode. */
  fileTitle?: string;
  titleKey?: string;
  season?: number;
  episode?: number;
  ttffMs?: number;
  rebufferCount?: number;
  rebufferMs?: number;
  watchedPct?: number;
  completed?: boolean;
  switched?: boolean;
  voice?: string;
  codecOk?: boolean | null;
}

let contextFn: (() => SourceContext | null) | null = null;
let poster: ((body: { [key: string]: string }) => Promise<void>) | null = null;

const queue: WatchSample[] = [];
const openAt: { [key: string]: number } = {};
const frameAt: { [key: string]: number } = {};
const rebuffers: { [key: string]: { n: number; ms: number; since: number } } = {};
const lastOpen: { [key: string]: { hash: string; file: number } } = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function setWatchContext(fn: (() => SourceContext | null) | null): void {
  contextFn = fn;
}

/** Tests replace the network. Null restores the app sender. */
export function setWatchPoster(fn: ((body: { [key: string]: string }) => Promise<void>) | null): void {
  poster = fn;
}

export function resetWatchReport(): void {
  queue.length = 0;
  const keys = Object.keys(openAt);
  for (let i = 0; i < keys.length; i++) {
    delete openAt[keys[i]];
    delete frameAt[keys[i]];
    delete rebuffers[keys[i]];
  }
  const titles = Object.keys(lastOpen);
  for (let i = 0; i < titles.length; i++) delete lastOpen[titles[i]];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function keyOf(hash: string, file: number): string {
  return hash.toLowerCase() + ':' + file;
}

function withEpisode(sample: WatchSample): WatchSample {
  if ((sample.season && sample.episode) || !sample.fileTitle) return sample;
  const info = parseEpisode(sample.fileTitle);
  const season = sample.season || (info.season !== null ? info.season : 0);
  const episode = sample.episode || (info.episode !== null ? info.episode : 0);
  return { ...sample, season: season, episode: episode };
}

function helpOn(): boolean {
  return settings.value.helpRank !== false;
}

function browserCodecs(): string {
  try {
    if (typeof document === 'undefined') return '';
    const v = document.createElement('video');
    const parts: string[] = [];
    if (v.canPlayType('video/mp4; codecs="avc1.42E01E"')) parts.push('h264');
    if (v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') || v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')) parts.push('hevc');
    if (v.canPlayType('video/mp4; codecs="av01.0.05M.08"')) parts.push('av1');
    return parts.join(',');
  } catch (e) {
    return '';
  }
}

function xhrPost(body: { [key: string]: string }): Promise<void> {
  const s = billingSession();
  const token = s ? s.access || s.token : '';
  if (!token) return Promise.resolve();
  const form = Object.keys(body)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(body[k]))
    .join('&');
  return new Promise((resolve) => {
    try {
      const x = new XMLHttpRequest();
      x.open('POST', BILLING_ORIGIN + '/v1/watch-signals');
      x.timeout = 12000;
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.setRequestHeader('X-Device-Id', deviceId());
      x.onload = () => resolve();
      x.onerror = () => resolve();
      x.ontimeout = () => resolve();
      x.send(form);
    } catch (e) {
      resolve();
    }
  });
}

function send(body: { [key: string]: string }): Promise<void> {
  if (poster) return poster(body).then(() => undefined, () => undefined);
  if (!billingSession()) return Promise.resolve();
  const ctx = contextFn ? contextFn() : tvSourceContext();
  if (!ctx) return Promise.resolve();
  if (nativeSourceHttp()) {
    return withDeviceToken(ctx, (headers) => billingPost(ctx, '/v1/watch-signals', body, { headers, timeoutMs: 12000 })).then(
      () => undefined,
      () => undefined,
    );
  }
  return xhrPost(body);
}

export function flushWatch(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!queue.length) return;
  if (!helpOn()) {
    queue.length = 0;
    return;
  }
  const items = queue.splice(0, 20);
  const payload = JSON.stringify({
    help: true,
    deviceClass: currentClass(),
    codecs: browserCodecs(),
    items,
  });
  void send({ payload, deviceId: deviceId(), deviceClass: currentClass(), help: '1' });
  if (queue.length) schedule();
}

function schedule(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushWatch();
  }, 15000);
  const timer = flushTimer as { unref?: () => void };
  if (timer.unref) timer.unref();
}

export function enqueueWatch(sample: WatchSample): void {
  const hash = (sample.infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return;
  if (!helpOn()) return;
  const filled = withEpisode(sample);
  queue.push({
    infohash: hash,
    file: filled.file || 0,
    title: (filled.title || '').slice(0, 300),
    titleKey: filled.titleKey,
    season: filled.season,
    episode: filled.episode,
    ttffMs: sample.ttffMs || 0,
    rebufferCount: sample.rebufferCount || 0,
    rebufferMs: sample.rebufferMs || 0,
    watchedPct: sample.watchedPct || 0,
    completed: sample.completed === true,
    switched: sample.switched === true,
    voice: (sample.voice || '').slice(0, 40),
    codecOk: sample.codecOk === true || sample.codecOk === false ? sample.codecOk : null,
  });
  if (queue.length >= 20) flushWatch();
  else schedule();
}

/** A file started. A different release of the same title marks the previous one as switched away. */
export function watchOpen(sample: WatchSample): void {
  const hash = (sample.infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return;
  const title = (sample.title || '').slice(0, 120);
  // Quality and codec stay in the torrent title. The switch is by the shared title key.
  const group = title ? progressTitleKey(title) : '';
  const prev = group ? lastOpen[group] : undefined;
  if (prev && prev.hash !== hash) {
    enqueueWatch({
      infohash: prev.hash,
      file: prev.file,
      title: sample.title,
      fileTitle: sample.fileTitle,
      switched: true,
      watchedPct: 0,
      codecOk: null,
    });
  }
  if (group) lastOpen[group] = { hash: hash, file: sample.file || 0 };
  const k = keyOf(hash, sample.file || 0);
  openAt[k] = Date.now();
  delete frameAt[k];
  rebuffers[k] = { n: 0, ms: 0, since: 0 };
}

export function watchFrame(hash: string, file: number): void {
  const k = keyOf(hash, file);
  if (!openAt[k] || frameAt[k]) return;
  frameAt[k] = Date.now();
}

export function watchBuffer(hash: string, file: number, on: boolean): void {
  const k = keyOf(hash, file);
  const row = rebuffers[k];
  if (!row || !frameAt[k]) return;
  const now = Date.now();
  if (on) {
    if (!row.since) row.since = now;
    return;
  }
  if (row.since) {
    row.n += 1;
    row.ms += Math.max(0, now - row.since);
    row.since = 0;
  }
}

export function watchClose(sample: WatchSample & { time?: number; duration?: number; error?: boolean }): void {
  const hash = (sample.infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return;
  const file = sample.file || 0;
  const k = keyOf(hash, file);
  const opened = openAt[k] || 0;
  const framed = frameAt[k] || 0;
  const buf = rebuffers[k] || { n: 0, ms: 0, since: 0 };
  if (buf.since) {
    buf.n += 1;
    buf.ms += Math.max(0, Date.now() - buf.since);
  }
  const dur = sample.duration && sample.duration > 0 ? sample.duration : 0;
  const time = sample.time && sample.time > 0 ? sample.time : 0;
  const pct = dur > 0 ? Math.round((Math.min(time, dur) / dur) * 100) : sample.watchedPct || 0;
  enqueueWatch({
    infohash: hash,
    file,
    title: sample.title,
    fileTitle: sample.fileTitle,
    titleKey: sample.titleKey,
    season: sample.season,
    episode: sample.episode,
    ttffMs: framed && opened ? Math.max(0, framed - opened) : 0,
    rebufferCount: buf.n,
    rebufferMs: buf.ms,
    watchedPct: pct,
    completed: sample.completed === true || pct >= 90,
    switched: sample.switched === true,
    voice: sample.voice,
    codecOk: sample.error ? false : framed ? true : sample.codecOk,
  });
  delete openAt[k];
  delete frameAt[k];
  delete rebuffers[k];
  flushWatch();
}

/** 2160 Player returns one result, without frame timing. Still one vote. */
export function reportPlayResult(sample: WatchSample): void {
  enqueueWatch(sample);
  flushWatch();
}
