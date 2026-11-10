// Audio and subtitle choice remembered per series or title, then applied on the next episode.
// Chromium 53 safe.
import type { FfprobeResult, FfprobeStream } from '../api/types';
import { episodeLabel } from '../lib/episodes';
import { getTrackPref, saveTrackPref, type TrackPref } from '../store/trackPrefs';
import { loadJson, saveJson, isObject } from '../store/storage';

const KEY = 'tsp.titleTracks';

export interface ProbeTrack {
  language: string;
  label: string;
}

export function probeTracks(probe: FfprobeResult | null): { audio: ProbeTrack[]; subtitles: ProbeTrack[] } {
  const audio: ProbeTrack[] = [];
  const subtitles: ProbeTrack[] = [];
  const streams = probe && probe.streams ? probe.streams : [];
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (s.codec_type === 'audio') audio.push(trackOf(s, audio.length));
    else if (s.codec_type === 'subtitle') subtitles.push(trackOf(s, subtitles.length));
  }
  return { audio: audio, subtitles: subtitles };
}

function tag(s: FfprobeStream, name: string): string {
  const tags = s.tags || {};
  const v = tags[name] || tags[name.toUpperCase()] || '';
  return typeof v === 'string' ? v.trim() : '';
}

function trackOf(s: FfprobeStream, n: number): ProbeTrack {
  const lang = tag(s, 'language').toLowerCase().slice(0, 12);
  const title = tag(s, 'title').slice(0, 80);
  const codec = (s.codec_name || '').toUpperCase();
  let label = title || lang || (s.codec_type === 'subtitle' ? 'sub ' : 'audio ') + (n + 1);
  if (codec && label.indexOf(codec) < 0) label = label + ' ' + codec;
  return { language: lang, label: label.slice(0, 80) };
}

/** Stable key: letters and digits of the title, without year, quality and episode code. */
export function titleMemoryKey(title: string): string {
  let s = String(title || '').toLowerCase();
  s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  s = s.replace(/s\d{1,2}[ ._-]*e\d{1,3}/gi, ' ');
  s = s.replace(/\bs\d{1,2}\b/gi, ' ');
  s = s.replace(/(?:2160|1080|720|480)p/gi, ' ');
  s = s.replace(/\b(?:web-?dl|webrip|bluray|bdrip|hdrip|hdtv|hdr10|hdr|hevc|x265|x264|avc)\b/gi, ' ');
  s = s.replace(/(?:^|[^0-9])(?:19|20)\d{2}(?=[^0-9]|$)/g, ' ');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const ok = (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 1072 && code <= 1103) || code === 1105;
    if (ok) out += s.charAt(i);
    else if (out && out.charAt(out.length - 1) !== ' ') out += ' ';
  }
  return out.replace(/ +/g, ' ').trim().slice(0, 80);
}

export function episodeProgressKey(path: string, film: boolean): string {
  const label = episodeLabel(path || '');
  if (label) return label.toLowerCase();
  if (film) return 'movie';
  const name = String(path || '').split('/').pop() || '';
  return name ? 'f:' + name.toLowerCase().slice(0, 48) : 'movie';
}

function readAll(): { [key: string]: TrackPref } {
  return sanitize(loadJson<unknown>(KEY, {}, isObject));
}

function sanitize(v: unknown): { [key: string]: TrackPref } {
  const out: { [key: string]: TrackPref } = {};
  if (!isObject(v)) return out;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) {
    const p = v[keys[i]];
    if (!isObject(p)) continue;
    const pref: TrackPref = {};
    if (typeof p.audioLang === 'string') pref.audioLang = p.audioLang.slice(0, 12);
    if (typeof p.audioLabel === 'string') pref.audioLabel = p.audioLabel.slice(0, 80);
    if (p.sub === 'off') pref.sub = 'off';
    else if (isObject(p.sub) && typeof p.sub.lang === 'string' && typeof p.sub.label === 'string') {
      pref.sub = { lang: p.sub.lang.slice(0, 12), label: p.sub.label.slice(0, 80) };
    }
    if (pref.audioLang || pref.audioLabel || pref.sub) out[keys[i]] = pref;
  }
  return out;
}

export function getTitleTrack(title: string): TrackPref | null {
  const key = titleMemoryKey(title);
  if (!key) return null;
  return readAll()[key] || null;
}

export function saveTitleTrack(title: string, patch: TrackPref): void {
  const key = titleMemoryKey(title);
  if (!key) return;
  const all = readAll();
  all[key] = { ...all[key], ...patch };
  saveJson(KEY, all);
}

/** This torrent's own choice, else the choice remembered for the series or title. */
export function prefForStart(hash: string | undefined, title: string): TrackPref | null {
  const own = hash ? getTrackPref(hash) : null;
  if (own && (own.audioLang || own.audioLabel || own.sub)) return own;
  return getTitleTrack(title);
}

/** Writes the torrent choice and the series/title choice. The next episode reads the title one. */
export function rememberTracks(hash: string | undefined, title: string, patch: TrackPref): void {
  if (hash) saveTrackPref(hash, patch);
  if (title) saveTitleTrack(title, patch);
}
