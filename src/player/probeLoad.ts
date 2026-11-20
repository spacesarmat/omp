import type { FfprobeResult } from '../api/types';
import { isMkvName, MKV_TAIL_BYTES } from '../viewer/prebuffer';

const EDGE = 4 * 1024 * 1024;
const PROBE_TIMEOUT = 90000;

export interface ProbeHost {
  preload(hash: string, fileIndex: number, name: string): Promise<void>;
  preloadTail(hash: string, fileIndex: number, name: string, start: number, end: number, signal?: AbortSignal, timeoutMs?: number): Promise<void>;
  probe(hash: string, fileIndex: number): Promise<FfprobeResult | null>;
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
 */
export async function probeReliable(c: ProbeHost, hash: string, fileIndex: number, name: string, size: number): Promise<FfprobeResult | null> {
  await warmForProbe(c, hash, fileIndex, name, size);
  const first = await c.probe(hash, fileIndex);
  if (first && first.streams && first.streams.length) return first;
  await warmForProbe(c, hash, fileIndex, name, size);
  return c.probe(hash, fileIndex);
}
