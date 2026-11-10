// Other releases seen in the last search, so a stalled play can switch without a new search.
// Chromium 53 safe.
import { qualityRank } from '../monitor/quality';

export interface AlternateRow {
  hash: string;
  title: string;
}

let pool: AlternateRow[] = [];

export function noteAlternatePool(rows: AlternateRow[]): void {
  const out: AlternateRow[] = [];
  const seen: { [h: string]: boolean } = {};
  for (let i = 0; i < rows.length; i++) {
    const hash = (rows[i].hash || '').toLowerCase();
    if (!hash || seen[hash]) continue;
    seen[hash] = true;
    out.push({ hash: hash, title: rows[i].title || '' });
    if (out.length >= 30) break;
  }
  pool = out;
}

export function alternatePool(): AlternateRow[] {
  return pool.slice();
}

/** Next release that is already in the library. `lower` prefers a smaller quality rank. */
export function nextAlternate(currentHash: string, bias: 'any' | 'lower', known: { [hash: string]: boolean }): string {
  const cur = (currentHash || '').toLowerCase();
  const have: AlternateRow[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].hash === cur) continue;
    if (!known[pool[i].hash]) continue;
    have.push(pool[i]);
  }
  if (!have.length) return '';
  if (bias === 'lower') {
    const curTitle = titleOf(cur);
    const curRank = qualityRank(curTitle);
    let best = '';
    let bestRank = curRank;
    for (let i = 0; i < have.length; i++) {
      const rank = qualityRank(have[i].title);
      if (curTitle && rank < bestRank) {
        best = have[i].hash;
        bestRank = rank;
      }
    }
    return best;
  }
  return have[0].hash;
}

function titleOf(hash: string): string {
  for (let i = 0; i < pool.length; i++) if (pool[i].hash === hash) return pool[i].title;
  return '';
}

export interface AutoplayJob {
  hash: string;
  positionSec: number;
  episodeKey: string;
}

let job: AutoplayJob | null = null;

export function requestAutoplay(hash: string, positionSec: number, episodeKey: string): void {
  if (!hash) return;
  job = {
    hash: hash.toLowerCase(),
    positionSec: positionSec > 0 ? Math.floor(positionSec) : 0,
    episodeKey: episodeKey || '',
  };
}

export function takeAutoplay(hash: string): AutoplayJob | null {
  if (!job || job.hash !== (hash || '').toLowerCase()) return null;
  const cur = job;
  job = null;
  return cur;
}

let stash: { titleKey: string; episodeKey: string; positionSec: number } | null = null;

export function stashResume(titleKey: string, episodeKey: string, positionSec: number): void {
  if (!titleKey || !(positionSec >= 1)) return;
  stash = { titleKey: titleKey, episodeKey: episodeKey || '', positionSec: Math.floor(positionSec) };
}

export function stashedResume(titleKey: string, episodeKey: string): number {
  if (!stash || stash.titleKey !== titleKey) return 0;
  if (stash.episodeKey && episodeKey && stash.episodeKey !== episodeKey) return 0;
  return stash.positionSec;
}

export function clearStash(): void {
  stash = null;
}
