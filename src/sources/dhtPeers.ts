// Manual «Проверить сиды» can also ask billing for a DHT peer count.
// DHT does not split seeders and leechers: the number is how many peers the lookup saw, an estimate.
// No device token, or no native HTTP (webOS): the tracker line is unchanged. Chromium 53 safe.
import { billingGet } from '../billing/client';
import { billingSession } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { t, tp } from '../i18n';
import { nativeSourceHttp } from '../platform/androidNative';
import type { ProbeResult } from './liveSeedsRun';
import type { SourceContext } from './types';

export const DHT_TIMEOUT_MS = 15000;

export type DhtPeersResult =
  | { ok: true; peers: number; estimate?: boolean; seedsEstimate?: number }
  | { ok: false; reason: 'skip' | 'bad' };

function defaultDhtContext(): SourceContext | null {
  const http = nativeSourceHttp();
  if (!http) return null;
  return { http: http, client: null };
}

let contextOf: () => SourceContext | null = defaultDhtContext;

/** The phone passes phoneSourceContext so a near-expiry token can refresh from the Keystore. */
export function setDhtPeersContext(fn: (() => SourceContext | null) | null): void {
  contextOf = fn || defaultDhtContext;
}

/** Signed in on a build that can call billing (phone, Android TV). webOS has no native HTTP, so this is false. */
export function dhtSeedCheckAvailable(): boolean {
  if (!billingSession()) return false;
  return !!contextOf();
}

/**
 * Phone or Android TV, not signed in. DHT is not asked: there is no billing session.
 * webOS has no native HTTP, so the hint would be a lie there.
 */
export function dhtNeedsSubscriptionHint(): boolean {
  return !billingSession() && !!contextOf();
}

/** One honest line. Not a peer count: the check did not run. */
export function withDhtSubscriptionHint(line: string): string {
  const hint = t('sources.dhtNeedsSub');
  if (!hint || line.indexOf(hint) >= 0) return line;
  return line ? line + '. ' + hint : hint;
}

/** `{ peers, source: "dht", approx: true }` or null. A BEP 33 seed estimate is optional and is not the address count. */
export function parseDhtPeersBody(text: string): { peers: number; estimate?: boolean; seedsEstimate?: number } | null {
  let v: { peers?: unknown; source?: unknown; approx?: unknown; estimate?: unknown; seedsEstimate?: unknown };
  try {
    v = JSON.parse(text) as { peers?: unknown; source?: unknown; approx?: unknown; estimate?: unknown; seedsEstimate?: unknown };
  } catch (e) {
    return null;
  }
  if (!v || typeof v.peers !== 'number') return null;
  if (v.peers < 0 || v.peers !== Math.floor(v.peers) || v.peers > 100000) return null;
  if (v.source !== 'dht' || v.approx !== true) return null;
  const out: { peers: number; estimate?: boolean; seedsEstimate?: number } = { peers: v.peers };
  const seeds = v.seedsEstimate;
  if (v.estimate === true && typeof seeds === 'number' && seeds >= 0 && seeds === Math.floor(seeds) && seeds <= 1000000) {
    out.estimate = true;
    out.seedsEstimate = seeds;
  }
  return out;
}

/** «~12 сидов по DHT». A BEP 33 estimate, not a verified scrape and not a count of addresses. */
export function dhtSeedLine(n: number): string {
  return '~' + tp('sources.seeds', n) + ' ' + t('sources.dhtVia');
}

/** «≈12 пиров онлайн · по DHT». The count is a sample, so it stays approximate. */
export function dhtPeerLine(peers: number): string {
  return '≈' + tp('sources.dhtPeers', peers) + ' · ' + t('sources.dhtVia');
}

function estimateText(dht: DhtPeersResult | null): string {
  if (!dht || !dht.ok || !dht.estimate || typeof dht.seedsEstimate !== 'number') return '';
  return dhtSeedLine(dht.seedsEstimate);
}

/**
 * One status. A tracker scrape stands alone: DHT address counts are not seeds and are not appended.
 * No announce URL keeps that reason and, when BEP 33 answered, the seed estimate on the same line.
 */
export function seedCheckLine(tracker: ProbeResult, dht: DhtPeersResult | null): string {
  const est = estimateText(dht);
  if (tracker.ok) return tp('sources.seeds', tracker.seeders) + ' · ' + tp('sources.leechers', tracker.leechers) + ' · ' + t('sources.seedsNow');
  if (!tracker.ok && (tracker.reason === 'notrackers' || tracker.reason === 'nohash')) {
    const why = tracker.note || t('sources.seedsNoTracker');
    return est ? why + ' · ' + est : why;
  }
  if (est) return est;
  if (!tracker.ok && tracker.note) return tracker.note;
  if (!tracker.ok && tracker.reason === 'timeout') return t('sources.seedsTimeout');
  return t('sources.seedsNoTracker');
}

/** One lookup. Never rejects: a miss is `{ ok: false, reason: 'skip' }` and the tracker line stays. */
export function askDhtPeers(infohash: string): Promise<DhtPeersResult> {
  const hash = (infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return Promise.resolve({ ok: false, reason: 'skip' });
  if (!billingSession()) return Promise.resolve({ ok: false, reason: 'skip' });
  const ctx = contextOf();
  if (!ctx) return Promise.resolve({ ok: false, reason: 'skip' });
  return withDeviceToken(ctx, (headers) => billingGet(ctx, '/v1/dht-peers?infohash=' + hash, { headers: headers, timeoutMs: DHT_TIMEOUT_MS })).then(
    (res) => {
      if (res.status !== 200) return { ok: false, reason: 'skip' };
      const parsed = parseDhtPeersBody(res.text);
      if (!parsed) return { ok: false, reason: 'bad' };
      const out: { ok: true; peers: number; estimate?: boolean; seedsEstimate?: number } = { ok: true, peers: parsed.peers };
      if (parsed.estimate) {
        out.estimate = true;
        out.seedsEstimate = parsed.seedsEstimate;
      }
      return out;
    },
    () => ({ ok: false, reason: 'skip' }),
  );
}
