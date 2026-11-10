// Order of a finished search once the server has checked seeds. Until that round finishes, the list
// stays in the ordinary seed order. Chromium 53 safe: no ?., no ??, no regex u flag.
import { qualityRank } from '../monitor/quality';
import { t, tp } from '../i18n';
import { parseRelease } from './filters';
import { matchCount, queryWords } from './relevance';
import { sortResults, type SortKey } from './view';
import type { SeedDisplay } from './liveSeeds';
import type { SourceResult } from './types';

const LIVE_BASE = 2000000;
const DHT_BASE = 1000000;
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const FRESH_MAX = 15000;

export function freshnessScore(ageMs: number): number {
  if (ageMs <= 0) return FRESH_MAX;
  if (ageMs >= FRESH_WINDOW_MS) return 0;
  return Math.round(FRESH_MAX * (1 - ageMs / FRESH_WINDOW_MS));
}

function sizeScore(n: number | undefined): number {
  if (!n || n <= 0) return 0;
  const gb = n / (1024 * 1024 * 1024);
  if (gb < 0.2) return 0;
  const v = Math.round(Math.log(gb + 1) * 600);
  return v > 2000 ? 2000 : v;
}

/** 1 when the title has the asked season (or the whole series), -1 when it names a different one, 0 otherwise. */
export function seasonScore(title: string, seasons: number[]): number {
  if (!seasons.length) return 0;
  const info = parseRelease(title);
  if (info.allSeasons) return 1;
  for (let i = 0; i < seasons.length; i++) {
    if (info.seasons.indexOf(seasons[i]) >= 0) return 1;
  }
  if (info.seasons.length) return -1;
  return 0;
}

/**
 * Higher is better. A checked swarm is always above an unchecked row.
 * Inside that, more seeds win, then a fresher measurement, then the title match, the season, the quality, the size.
 */
export function rankScore(r: SourceResult, query: string, now: number): number {
  const words = queryWords(query);
  const seasons = parseRelease(query).seasons;
  const hit = words.length ? matchCount(r.Title || '', words) : 0;
  const season = seasonScore(r.Title || '', seasons);
  let score = hit * 4000 + season * 8000 + qualityRank(r.Title || '') * 100 + sizeScore(r.sizeBytes);
  if (r.seedCheck === 'live' && (r.Seed || 0) > 0) {
    const age = typeof r.seedCheckAt === 'number' ? now - r.seedCheckAt : FRESH_WINDOW_MS;
    score += LIVE_BASE + Math.min(r.Seed, 20000) * 1000 + freshnessScore(age);
  } else if (r.seedCheck === 'dht' && (r.dhtPeers || 0) > 0) {
    score += DHT_BASE + Math.min(r.dhtPeers || 0, 500) * 20;
  } else if (r.seedCheck === 'live') {
    // The scrape answered and nobody is seeding. Still above a row we could not check.
    score += 100000;
  } else {
    score += Math.min(r.Seed > 0 ? r.Seed : 0, 20000);
  }
  return score;
}

export function rankSearchResults<T extends SourceResult>(list: T[], query: string, now: number): T[] {
  return list
    .map((r, i) => ({ r: r, i: i, s: rankScore(r, query, now) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

function roundStarted(list: { seedCheck?: string }[]): boolean {
  for (let i = 0; i < list.length; i++) if (list[i].seedCheck) return true;
  return false;
}

/** Seed sort uses the checked ranking once a round has finished. Date and size stay as they were. */
export function orderSearch<T extends SourceResult>(list: T[], sort: SortKey, query: string, now: number): T[] {
  if (sort === 'seeds' && roundStarted(list)) return rankSearchResults(list, query, now);
  return sortResults(list, sort) as T[];
}

/** Server counts replace the tracker line. A device scrape that is not live does not cover them. */
export function applyLiveCounts(r: SourceResult, view: SeedDisplay): SeedDisplay {
  if (r.seedCheck === 'live') return { mode: 'live', seeders: r.Seed || 0, leechers: r.Peer || 0 };
  return view;
}

/** «не проверено», or a DHT peer count when scrape did not answer. Empty when the row is checked or not yet asked. */
export function seedSuffix(r: SourceResult): string {
  if (r.seedCheck === 'unverified') return t('sources.seedUnverified');
  if (r.seedCheck === 'dht' && (r.dhtPeers || 0) > 0) return tp('sources.dhtPeers', r.dhtPeers || 0);
  return '';
}
