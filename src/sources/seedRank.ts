// Order of a finished search once the server has checked seeds. Until that round finishes, the list
// stays in the ordinary seed order. Chromium 53 safe: no ?., no ??, no regex u flag.
import { qualityRank } from '../monitor/quality';
import { t } from '../i18n';
import { seedCheckLine } from './dhtPeers';
import { parseRelease } from './filters';
import { infohashOf, phoneSeedBits, trackerTargets, type SeedDisplay } from './liveSeeds';
import { matchCount, queryWords } from './relevance';
import { sortResults, type SortKey } from './view';
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
  } else if (r.seedCheck === 'dht' && r.dhtEstimate && (r.dhtSeeds || 0) > 0) {
    score += DHT_BASE + Math.min(r.dhtSeeds || 0, 500) * 20;
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

/** «не проверено». A DHT address count is not a seed status. */
export function seedSuffix(r: SourceResult): string {
  if (r.seedCheck === 'unverified') return t('sources.seedUnverified');
  return '';
}

function trackerListed(r: SourceResult): boolean {
  const hash = infohashOf(r);
  return !!hash && trackerTargets(r.Magnet || '', hash).length > 0;
}

/** Indexer counts, as the row shows them before a check. Empty when the feed had no seeds. */
export function indexerSeedLine(r: SourceResult): string {
  return phoneSeedBits({ mode: 'search', seeders: r.Seed || 0, leechers: r.Peer || 0 }).text;
}

/**
 * The one line of a finished check. Empty until the row is marked.
 * «не проверено» comes first so a clipped card still shows it.
 * A DHT sample and a missing tracker address stay in the same line.
 */
export function seedStatusLine(r: SourceResult): string {
  if (r.seedCheck === 'live') {
    return seedCheckLine({ ok: true, seeders: r.Seed || 0, leechers: r.Peer || 0 }, null);
  }
  if (r.seedCheck === 'dht') {
    const reason = r.noTracker || !trackerListed(r) ? 'notrackers' : 'timeout';
    const dht =
      r.dhtEstimate && typeof r.dhtSeeds === 'number'
        ? { ok: true as const, peers: r.dhtPeers || 0, estimate: true, seedsEstimate: r.dhtSeeds }
        : null;
    const line = seedCheckLine({ ok: false, reason: reason }, dht);
    if (line) return line;
    return trackerListed(r) ? t('sources.seedUnverified') : t('sources.seedsNoTracker');
  }
  if (r.seedCheck === 'unverified') {
    // The server found no announce URL. Say that, including when DHT returned addresses but no bloom estimate.
    if (r.noTracker || (infohashOf(r) && !trackerListed(r))) return t('sources.seedsNoTracker');
    const base = indexerSeedLine(r);
    const mark = t('sources.seedUnverified');
    return base ? mark + ' · ' + base : mark;
  }
  return '';
}

export interface SeedLineProbe {
  phase: string;
  line: string;
}

/**
 * One status for the row. A settled manual check wins, then the server round.
 * A device scrape must not cover either of those. «Нет адреса трекера» is only for a row that cannot be checked.
 */
export function visibleSeedLine(
  r: SourceResult,
  opts: { indexerText: string; liveText: string; liveMode: string; probe: SeedLineProbe; trackers: boolean; canCheck: boolean },
): string {
  const probe = opts.probe;
  if ((probe.phase === 'done' || probe.phase === 'err') && probe.line) return probe.line;
  if (r.seedCheck) return seedStatusLine(r);
  // While a manual check runs, keep the tracker numbers. Do not flash «Нет адреса» or a failed scrape.
  if (probe.phase === 'busy') return opts.indexerText;
  // A row that cannot be checked keeps the old note, and only when the tracker published a count.
  // A feed row with no seed data stays quiet.
  if (!opts.trackers && !opts.canCheck) return opts.indexerText ? t('sources.seedsNoTracker') : '';
  if (opts.liveMode === 'live') return opts.liveText;
  return opts.indexerText;
}
