import type { FfprobeResult, FfprobeStream } from '../api/types';
import { parseMkvHead } from '../lib/mkvSubs';
import { isMkvName, MKV_TAIL_BYTES } from '../viewer/prebuffer';

const EDGE = 4 * 1024 * 1024;
const PROBE_TIMEOUT = 90000;

export interface ProbeHost {
  preload(hash: string, fileIndex: number, name: string): Promise<void>;
  preloadTail(hash: string, fileIndex: number, name: string, start: number, end: number, signal?: AbortSignal, timeoutMs?: number): Promise<void>;
  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null>;
  fetchRange?(hash: string, fileIndex: number, name: string, start: number, end: number): Promise<Uint8Array | null>;
}

/** Bytes of the MKV tail to pull before ffprobe. Cues sit at the end; the track list sits at the start. */
export function probeTail(size: number): { start: number; end: number } | null {
  const n = size > EDGE ? EDGE : size > MKV_TAIL_BYTES ? MKV_TAIL_BYTES : 0;
  if (!(n > 0) || !(size > n)) return null;
  return { start: size - n, end: size - 1 };
}

export async function warmForProbe(c: ProbeHost, hash: string, fileIndex: number, name: string, size: number): Promise<void> {
  const jobs: Promise<void>[] = [c.preload(hash, fileIndex, name || 'file')];
  const tail = isMkvName(name) ? probeTail(size) : null;
  if (tail) jobs.push(c.preloadTail(hash, fileIndex, name, tail.start, tail.end, undefined, PROBE_TIMEOUT));
  await Promise.all(jobs);
}

/**
 * One ffprobe, then a single retry after the start and the MKV tail are in the server cache.
 * A cold multi-gigabyte file often answers before those bytes exist; the second call sees them.
 * Without server-side ffprobe, the MKV head still supplies its subtitle tracks.
 */
/** True when ffprobe listed at least one subtitle stream. Video-only is not enough: the track list may still be cold. */
export function hasSubtitleStreams(r: FfprobeResult | null): boolean {
  const streams = r && r.streams;
  if (!streams) return false;
  for (let i = 0; i < streams.length; i++) if (streams[i].codec_type === 'subtitle') return true;
  return false;
}

/** Union of two stream lists by ffprobe index. A later stream fills gaps and does not drop an earlier one. */
function mergeStreams(current: FfprobeStream[] | undefined, incoming: FfprobeStream[] | undefined): FfprobeStream[] {
  const byIndex: { [n: number]: FfprobeStream } = {};
  const order: number[] = [];
  const take = (list: FfprobeStream[] | undefined) => {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const stream: FfprobeStream = list[i];
      const key = stream.index;
      const prev: FfprobeStream | undefined = byIndex[key];
      if (prev === undefined) order.push(key);
      byIndex[key] = prev ? { ...prev, ...stream } : stream;
    }
  };
  take(current);
  take(incoming);
  const out: FfprobeResult['streams'] = [];
  for (let i = 0; i < order.length; i++) out.push(byIndex[order[i]]);
  return out;
}

/** Keep every stream already seen, and add any the retry found (subtitles included). */
export function adoptProbe(current: FfprobeResult | null, incoming: FfprobeResult | null): FfprobeResult | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const streams = mergeStreams(current.streams, incoming.streams);
  const base = hasSubtitleStreams(incoming) ? incoming : current;
  const curChapters = current.chapters;
  const nextChapters = incoming.chapters;
  const chapters = nextChapters && nextChapters.length && (!curChapters || nextChapters.length >= curChapters.length)
    ? nextChapters
    : curChapters;
  return chapters ? { ...base, streams: streams, chapters: chapters } : { ...base, streams: streams };
}

function mkvCodec(id: string): string {
  const c = id.toUpperCase();
  if (c === 'S_TEXT/UTF8' || c === 'S_TEXT/ASCII') return 'subrip';
  if (c === 'S_TEXT/ASS') return 'ass';
  if (c === 'S_TEXT/SSA') return 'ssa';
  if (c === 'S_TEXT/WEBVTT') return 'webvtt';
  if (c === 'S_HDMV/PGS') return 'hdmv_pgs_subtitle';
  if (c === 'S_VOBSUB') return 'dvd_subtitle';
  if (c === 'S_DVBSUB') return 'dvb_subtitle';
  return '';
}

/** Track discovery without TorrServer's optional ffprobe binary. The same cached MKV edges feed LiveSubs later. */
async function probeMkvSubs(c: ProbeHost, hash: string, fileIndex: number, name: string, size: number): Promise<FfprobeResult | null> {
  if (!c.fetchRange || !isMkvName(name) || !(size > 32)) return null;
  const tailStart = Math.max(0, size - Math.min(EDGE, size));
  const head = await c.fetchRange(hash, fileIndex, name, 0, Math.min(EDGE, size) - 1);
  const tail = await c.fetchRange(hash, fileIndex, name, tailStart, size - 1);
  if (!head || !tail) return null;
  const tracks = parseMkvHead(head, tail, tailStart).tracks;
  if (!tracks.length) return null;
  return {
    streams: tracks.map((track, ordinal) => ({
      // Synthetic ids cannot overwrite audio/video already found by the server.
      index: -1 - ordinal,
      codec_type: 'subtitle',
      codec_name: mkvCodec(track.codecId),
      ...(track.language ? { tags: { language: track.language } } : {}),
    })),
  };
}

export async function probeReliable(c: ProbeHost, hash: string, fileIndex: number, name: string, size: number): Promise<FfprobeResult | null> {
  await warmForProbe(c, hash, fileIndex, name, size);
  const first = await c.probe(hash, fileIndex);
  if (hasSubtitleStreams(first)) return first;
  await warmForProbe(c, hash, fileIndex, name, size);
  const probed = adoptProbe(first, await c.probe(hash, fileIndex));
  if (probed) return probed;
  return probeMkvSubs(c, hash, fileIndex, name, size);
}
