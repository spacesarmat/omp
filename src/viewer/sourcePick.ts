// Default search row: seeds (tracker or DHT), quality, codec fit, size against the measured speed.
// The list sort stays the caller's. This only scores and explains the highlight. Chromium 53 safe.
import { t } from '../i18n';
import { qualityRank } from '../monitor/quality';
import { parseReleaseInfo } from '../lib/releaseInfo';
import { rankScore } from '../sources/seedRank';
import type { SourceResult } from '../sources/types';

export interface DeviceCaps {
  /** tv: HEVC, HDR and Dolby Vision are fine. phone: they cost points. */
  kind: 'tv' | 'phone';
}

export interface RankContext {
  device: DeviceCaps;
  /** Bytes per second from the last playback. 0: unknown, size is not punished. */
  speedBps: number;
  now: number;
}

export type PickReason = 'seeds' | 'dht' | 'codec' | 'speed' | 'quality';

const GB = 1024 * 1024 * 1024;

export function deviceCaps(kind: 'tv' | 'phone'): DeviceCaps {
  return { kind: kind };
}

function resOf(title: string): number {
  const info = parseReleaseInfo(title);
  if (info.resolution === '2160p') return 2160;
  if (info.resolution === '1080p') return 1080;
  if (info.resolution === '720p') return 720;
  if (info.resolution === '480p') return 480;
  return 0;
}

/** Higher is a better fit. A phone loses points for DV, HDR and 4K. A TV gains them. */
export function codecFit(title: string, device: DeviceCaps): number {
  const info = parseReleaseInfo(title || '');
  const res = resOf(title || '');
  const hevc = info.codec === 'HEVC' || info.codec === 'AV1';
  const dv = info.hdr === 'DV';
  const hdr = info.hdr === 'HDR' || info.hdr === 'HDR10+';
  if (device.kind === 'phone') {
    let n = 0;
    if (dv) n -= 8;
    else if (hdr) n -= 4;
    if (res >= 2160) n -= 3;
    if (hevc && res >= 2160) n -= 2;
    if (info.codec === 'AVC' || (!hevc && !dv && !hdr && res > 0 && res <= 1080)) n += 2;
    return n;
  }
  let n = 0;
  if (res >= 2160) n += 2;
  if (hevc) n += 1;
  if (dv || hdr) n += 2;
  return n;
}

/**
 * Size against the link. A two-hour guess: bitrate = size / 7200.
 * Unknown speed adds nothing, so a fast file is not punished before the first measurement.
 */
export function speedFit(sizeBytes: number | undefined, speedBps: number): number {
  if (!speedBps || speedBps <= 0 || !sizeBytes || sizeBytes <= 0) return 0;
  const bitrate = sizeBytes / 7200;
  if (speedBps >= bitrate) return 3;
  if (speedBps < bitrate * 0.4) return -6;
  if (sizeBytes > 20 * GB && speedBps < 1024 * 1024) return -4;
  return 0;
}

export function smartScore(r: SourceResult, query: string, ctx: RankContext): number {
  // rankScore adds the community bonus from billing (omp_rank) when viewers have samples.
  // Codec, link speed and quality stay the local tie-break on top of that.
  const base = rankScore(r, query, ctx.now);
  return base + codecFit(r.Title || '', ctx.device) * 5000 + speedFit(r.sizeBytes, ctx.speedBps) * 4000 + qualityRank(r.Title || '') * 10;
}

export function rankViewerSources<T extends SourceResult>(list: T[], query: string, ctx: RankContext): T[] {
  return list
    .map((r, i) => ({ r: r, i: i, s: smartScore(r, query, ctx) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

function seedKind(r: SourceResult): 'live' | 'dht' | 'weak' {
  if (r.seedCheck === 'live' && (r.Seed || 0) > 0) return 'live';
  if (r.seedCheck === 'dht' && r.dhtEstimate && (r.dhtSeeds || 0) > 0) return 'dht';
  if ((r.Seed || 0) > 0 && r.seedCheck !== 'unverified') return 'live';
  return 'weak';
}

/** Why the first row beat the second. One short reason. */
export function pickReason(best: SourceResult, next: SourceResult | null, ctx: RankContext): PickReason {
  if (!next) {
    if (seedKind(best) === 'dht') return 'dht';
    if (seedKind(best) === 'live') return 'seeds';
    return ctx.device.kind === 'phone' ? 'codec' : 'quality';
  }
  const seedB = seedKind(best) === 'live' ? (best.Seed || 0) : seedKind(best) === 'dht' ? (best.dhtSeeds || 0) : 0;
  const seedN = seedKind(next) === 'live' ? (next.Seed || 0) : seedKind(next) === 'dht' ? (next.dhtSeeds || 0) : 0;
  const codecB = codecFit(best.Title || '', ctx.device);
  const codecN = codecFit(next.Title || '', ctx.device);
  const speedB = speedFit(best.sizeBytes, ctx.speedBps);
  const speedN = speedFit(next.sizeBytes, ctx.speedBps);
  const qualB = qualityRank(best.Title || '');
  const qualN = qualityRank(next.Title || '');
  if (codecB > codecN && (seedB <= seedN || codecB - codecN >= 3)) return 'codec';
  if (speedB > speedN && ctx.speedBps > 0) return 'speed';
  if (seedKind(best) === 'dht' && seedKind(next) !== 'live') return 'dht';
  if (seedB > seedN) return 'seeds';
  if (qualB > qualN) return 'quality';
  if (seedKind(best) === 'dht') return 'dht';
  return 'seeds';
}

export function pickBadge(reason: PickReason, device: DeviceCaps): string {
  if (reason === 'dht') return t('viewer.pickDht');
  if (reason === 'codec') return device.kind === 'phone' ? t('viewer.pickCodecPhone') : t('viewer.pickCodecTv');
  if (reason === 'speed') return t('viewer.pickSpeed');
  if (reason === 'quality') return t('viewer.pickQuality');
  return t('viewer.pickSeeds');
}

export interface SourcePick<T> {
  row: T;
  index: number;
  reason: PickReason;
  badge: string;
}

/** The row to highlight. Null on an empty list. Order of `list` is kept. */
export function pickDefaultSource<T extends SourceResult>(list: T[], query: string, ctx: RankContext): SourcePick<T> | null {
  if (!list.length) return null;
  const ranked = rankViewerSources(list, query, ctx);
  const best = ranked[0];
  let index = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === best) index = i;
  const reason = pickReason(best, ranked.length > 1 ? ranked[1] : null, ctx);
  return { row: best, index: index, reason: reason, badge: pickBadge(reason, ctx.device) };
}
