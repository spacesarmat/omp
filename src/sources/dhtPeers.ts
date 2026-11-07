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

export type DhtPeersResult = { ok: true; peers: number } | { ok: false; reason: 'skip' | 'bad' };

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

/** `{ peers, source: "dht", approx: true }` or null. Anything else is not shown. */
export function parseDhtPeersBody(text: string): { peers: number } | null {
  let v: { peers?: unknown; source?: unknown; approx?: unknown };
  try {
    v = JSON.parse(text) as { peers?: unknown; source?: unknown; approx?: unknown };
  } catch (e) {
    return null;
  }
  if (!v || typeof v.peers !== 'number') return null;
  if (v.peers < 0 || v.peers !== Math.floor(v.peers) || v.peers > 100000) return null;
  if (v.source !== 'dht' || v.approx !== true) return null;
  return { peers: v.peers };
}

/** «≈12 пиров онлайн · по DHT». The count is a sample, so it stays approximate. */
export function dhtPeerLine(peers: number): string {
  return '≈' + tp('sources.dhtPeers', peers) + ' · ' + t('sources.dhtVia');
}

/**
 * Tracker line, DHT line beside it, or the DHT line alone when the tracker did not answer.
 * A skipped DHT call leaves the tracker text as it was.
 */
export function seedCheckLine(tracker: ProbeResult, dht: DhtPeersResult | null): string {
  const dhtText = dht && dht.ok ? dhtPeerLine(dht.peers) : '';
  if (tracker.ok && dhtText) {
    return tp('sources.seeds', tracker.seeders) + ' · ' + tp('sources.leechers', tracker.leechers) + ' · ' + t('sources.seedsNow') + ' · ' + dhtText;
  }
  if (tracker.ok) return tp('sources.seeds', tracker.seeders) + ' · ' + tp('sources.leechers', tracker.leechers) + ' · ' + t('sources.seedsNow');
  if (dhtText) return dhtText;
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
      return { ok: true, peers: parsed.peers };
    },
    () => ({ ok: false, reason: 'skip' }),
  );
}
