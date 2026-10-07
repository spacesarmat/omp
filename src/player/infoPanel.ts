// «Инфо» of the LG player (Yellow / Info), the same panel as on Android TV (PlayerInfo.kt, «variant B»): a header (the
// episode code; a chip HDR mark · codec · size), three tiles (seeds / peers, download, bitrate), the sound, the buffer.
// From what the player already has: ffprobe, TorrServer /cache, the <video> element. Pure.
import { t } from '../i18n';
import type { CacheState, FfprobeResult, FfprobeStream } from '../api/types';
import { tracksFromProbe } from '../lib/tracks';

export interface InfoTile {
  label: string;
  value: string;
  unit: string;
}

export interface InfoPanel {
  /** The episode code («S04E02»), else the title. */
  title: string;
  /** «DV», «HDR10», «HLG»; '' for SDR / unknown. */
  hdr: string;
  /** «HEVC · 3832×1600». */
  chip: string;
  tiles: InfoTile[];
  /** «AC3 5.1»; «—» when unknown. */
  sound: string;
  /** How full the buffer bar is, 0..1. */
  bufferFill: number;
  /** «522 МБ · 17 с»; «—» when unknown. */
  buffer: string;
}

export interface InfoInput {
  title: string;
  probe: FfprobeResult | null;
  /** The audio track playing (index among the probe's audio tracks), -1 when unknown. */
  audioIndex: number;
  /** TorrServer /cache of the torrent playing; null when unknown or the last fetch failed. */
  cache: CacheState | null;
  /** Seconds the <video> has buffered ahead; null when unknown. */
  bufferedSec: number | null;
}

/** The bar fills with the player's seconds ahead against this. */
export const BUFFER_TARGET_S = 30;

const DASH = '—';

/** «HEVC», «AVC», «AV1»… from an ffprobe codec name; a Dolby Vision stream keeps its base codec (DV is the HDR mark). */
export function videoCodecName(s: FfprobeStream): string {
  const n = (s.codec_name || '').toLowerCase();
  const map: { [k: string]: string } = {
    hevc: 'HEVC', h265: 'HEVC', h264: 'AVC', avc: 'AVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8',
    mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4', vc1: 'VC-1',
  };
  return map[n] || n.toUpperCase();
}

/** «DV», «HDR10», «HLG» from an ffprobe video stream; '' for SDR / unknown. */
export function hdrMark(s: FfprobeStream): string {
  if (/^(dvh1|dvhe|dav1|dvav|dva1)$/i.test(s.codec_tag_string || '')) return 'DV';
  if (s.color_transfer === 'smpte2084') return 'HDR10';
  if (s.color_transfer === 'arib-std-b67') return 'HLG';
  return '';
}

/** «AC3», «E-AC3», «DTS»… from an ffprobe audio codec name. */
export function audioCodecName(n: string): string {
  const map: { [k: string]: string } = {
    ac3: 'AC3', eac3: 'E-AC3', dts: 'DTS', truehd: 'TrueHD', aac: 'AAC', mp3: 'MP3', mp2: 'MP2', opus: 'Opus', flac: 'FLAC', vorbis: 'Vorbis',
  };
  const k = (n || '').toLowerCase();
  return map[k] || k.toUpperCase();
}

function channelsName(n: number | undefined): string {
  if (!n) return '';
  if (n === 1) return '1.0';
  if (n === 2) return '2.0';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return t('player.info.channels', { n });
}

function num(v: number, decimals: boolean): string {
  const s = decimals ? v.toFixed(1) : String(Math.round(v));
  return t('player.info.decimal') === ',' ? s.replace('.', ',') : s;
}

/** A size as value and unit: [«3,1», «МБ»]. */
export function bytesParts(n: number): [string, string] {
  const units = [t('player.info.b'), t('player.info.kb'), t('player.info.mb'), t('player.info.gb')];
  let v = isFinite(n) && n > 0 ? n : 0;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return [num(v, u > 0 && v < 100), units[u]];
}

/** «522 МБ». */
export function bytesText(n: number): string {
  const p = bytesParts(n);
  return p[0] + ' ' + p[1];
}

/** A transfer rate (bytes per second) as value and unit: [«3,1», «МБ/с»]; [«0», «КБ/с»] for nothing. */
export function rateParts(bytesPerSec: number): [string, string] {
  if (!(bytesPerSec >= 1)) return ['0', t('player.info.perSec', { v: t('player.info.kb') })];
  const p = bytesParts(bytesPerSec);
  return [p[0], t('player.info.perSec', { v: p[1] })];
}

/** A bitrate (bit/s) as value and unit: [«15,1», «Мбит/с»]. */
export function bitrateParts(bps: number): [string, string] {
  const mbit = bps / 1e6;
  return [num(mbit, mbit < 100), t('player.info.mbit')];
}

const EPISODE = /\bS\d{1,2}E\d{1,3}(?:-E?\d{1,3})?\b/i;

/** The header's short title: the episode code («S04E02») when the title has one, else the title. */
export function shortTitle(title: string): string {
  const m = EPISODE.exec(title || '');
  return m ? m[0].toUpperCase() : title || '';
}

/** Seconds buffered ahead of the playing position (the <video>'s buffered range around it); null when unknown. */
export function bufferedAhead(v: { buffered?: TimeRanges; currentTime: number } | null): number | null {
  if (!v || !v.buffered) return null;
  const b = v.buffered;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) return Math.max(0, b.end(i) - v.currentTime);
  }
  return b.length ? 0 : null;
}

export function infoPanel(p: InfoInput): InfoPanel {
  const video = p.probe ? p.probe.streams.filter((s) => s.codec_type === 'video')[0] : undefined;
  const chip: string[] = [];
  if (video) {
    const codec = videoCodecName(video);
    if (codec) chip.push(codec);
    if (video.width && video.height) chip.push(video.width + '×' + video.height);
  }
  const tor = p.cache && p.cache.Torrent;
  const none: [string, string] = [DASH, ''];
  const seeds: [string, string] = tor ? [(tor.connected_seeders || 0) + ' / ' + (tor.active_peers || 0), ''] : none;
  const down = tor ? rateParts(tor.download_speed || 0) : none;
  const br = (video && +(video.bit_rate || 0)) || (p.probe && p.probe.format && +(p.probe.format.bit_rate || 0)) || 0;
  const rate = br > 0 ? bitrateParts(br) : none;
  const audio = tracksFromProbe(p.probe).filter((x) => x.kind === 'audio');
  const a = p.audioIndex >= 0 ? audio[p.audioIndex] : audio.filter((x) => x.isDefault)[0] || audio[0];
  const sound = a ? [audioCodecName(a.codec), channelsName(a.channels)].filter(Boolean).join(' ') : '';
  const server = tor ? tor.preloaded_bytes || 0 : 0;
  const ahead = server > 0 ? server : p.cache && p.cache.Filled > 0 ? p.cache.Filled : 0;
  const parts: string[] = [];
  if (ahead > 0) parts.push(bytesText(ahead));
  if (p.bufferedSec !== null) parts.push(t('player.info.seconds', { v: Math.floor(p.bufferedSec) }));
  let fill = 0;
  if (p.bufferedSec !== null) fill = p.bufferedSec / BUFFER_TARGET_S;
  else if (server > 0 && p.cache && p.cache.Capacity > 0) fill = server / p.cache.Capacity;
  return {
    title: shortTitle(p.title),
    hdr: video ? hdrMark(video) : '',
    chip: chip.join(' · '),
    tiles: [
      { label: t('player.info.seedsPeers'), value: seeds[0], unit: seeds[1] },
      { label: t('player.info.download'), value: down[0], unit: down[1] },
      { label: t('player.info.bitrate'), value: rate[0], unit: rate[1] },
    ],
    sound: sound || DASH,
    bufferFill: Math.max(0, Math.min(1, fill)),
    buffer: parts.length ? parts.join(' · ') : DASH,
  };
}

/** The video in one line for the error box: «HEVC · 3840×2160 · HDR10 · 25,0 Мбит/с»; '' without ffprobe. */
export function videoSummary(probe: FfprobeResult | null): string {
  const video = probe ? probe.streams.filter((s) => s.codec_type === 'video')[0] : undefined;
  if (!video) return '';
  const parts: string[] = [videoCodecName(video)];
  if (video.width && video.height) parts.push(video.width + '×' + video.height);
  const hdr = hdrMark(video);
  if (hdr) parts.push(hdr);
  const br = +(video.bit_rate || (probe && probe.format && probe.format.bit_rate) || 0);
  if (br > 0) {
    const r = bitrateParts(br);
    parts.push(r[0] + ' ' + r[1]);
  }
  return parts.filter(Boolean).join(' · ');
}
