// Subscription filters over search results and the «seen» keys of a result. Chromium 53 safe.
import { parseSize } from '../sources/html';
import { normalizeTitle } from '../sources/merge';
import { qualityOf } from '../sources/view';
import type { SourceResult } from '../sources/types';
import type { SubQuality, Subscription } from './types';

const GB = 1024 * 1024 * 1024;
/** Sizes within one 2 % step share a bucket: the same release reported by two sites (6.71 GB vs 7206328852 bytes). */
const BUCKET = Math.log(1.02);

/** The title's quality (2160p/4K/UHD, 1080p, 720p) meets the subscription; '' accepts anything. */
export function matchesQuality(title: string, q: SubQuality): boolean {
  if (!q) return true;
  return qualityOf(title) >= parseInt(q, 10);
}

/** Size in bytes from sizeBytes or the Size text; null when unknown. */
export function resultSize(r: SourceResult): number | null {
  if (typeof r.sizeBytes === 'number' && r.sizeBytes > 0) return r.sizeBytes;
  const s = parseSize(r.Size || '');
  return s && s > 0 ? s : null;
}

/** Quality, minimum seeds and maximum size of the subscription (an unknown size passes). */
export function matchesSubscription(sub: Subscription, r: SourceResult): boolean {
  if (!matchesQuality(r.Title, sub.quality)) return false;
  if (sub.minSeeds && (r.Seed || 0) < sub.minSeeds) return false;
  if (sub.maxSizeGb) {
    const size = resultSize(r);
    if (size !== null && size > sub.maxSizeGb * GB) return false;
  }
  return true;
}

export function filterForSubscription(sub: Subscription, list: SourceResult[]): SourceResult[] {
  return list.filter((r) => matchesSubscription(sub, r));
}

/**
 * Seen keys of a result: `h:<infohash>` when known, and always `t:<normalized title>:<size bucket>` — a release seen
 * with its hash on one site is still recognized on a site that gives no hash.
 */
export function resultKeys(r: SourceResult): string[] {
  const keys: string[] = [];
  if (r.hash) keys.push('h:' + r.hash);
  const b = bucketOf(r);
  keys.push(titleKey(r, b === null ? '?' : String(b)));
  return keys;
}

function bucketOf(r: SourceResult): number | null {
  const size = resultSize(r);
  return size ? Math.round(Math.log(size) / BUCKET) : null;
}

function titleKey(r: SourceResult, bucket: string): string {
  return 't:' + normalizeTitle(r.Title) + ':' + bucket;
}

/** The stored «seen» entry of one result: its keys joined by '|' (titles are normalized, they hold no '|'). */
export function seenEntry(r: SourceResult): string {
  return resultKeys(r).join('|');
}

export type SeenIndex = { [key: string]: boolean };

/** Every key of the seen entries, for isSeen. */
export function seenIndex(entries: string[]): SeenIndex {
  const index: SeenIndex = {};
  entries.forEach((e) =>
    e.split('|').forEach((k) => {
      if (k) index[k] = true;
    }),
  );
  return index;
}

/**
 * Any key of the result is among the seen entries (or their index); the neighbouring size buckets count too (no flip
 * at a bucket edge).
 */
export function isSeen(r: SourceResult, seen: string[] | SeenIndex): boolean {
  const index = Array.isArray(seen) ? seenIndex(seen) : seen;
  const keys = resultKeys(r);
  const b = bucketOf(r);
  if (b !== null) keys.push(titleKey(r, String(b - 1)), titleKey(r, String(b + 1)));
  for (let i = 0; i < keys.length; i++) if (index[keys[i]] === true) return true;
  return false;
}
