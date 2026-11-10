// Precomputed best release for a title the account is watching (GET /v1/watch-best).
// A missing session or a network failure returns null. The caller keeps its own pick.
import { billingGet } from '../billing/client';
import { billingSession } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import type { SourceContext } from '../sources/types';
import { watchDeviceClass } from './watchDevice';

export interface WatchBest {
  infohash: string;
  score: number;
  reason: string;
  voice: string;
  season: number;
  episode: number;
  title: string;
}

export function fetchWatchBest(ctx: SourceContext, title: string, season: number, episode: number): Promise<WatchBest | null> {
  if (!billingSession()) return Promise.resolve(null);
  const q =
    '/v1/watch-best?titleKey=' +
    encodeURIComponent((title || '').slice(0, 80)) +
    '&season=' +
    encodeURIComponent(String(season || 0)) +
    '&episode=' +
    encodeURIComponent(String(episode || 0)) +
    '&deviceClass=' +
    encodeURIComponent(watchDeviceClass());
  return withDeviceToken(ctx, (headers) => billingGet(ctx, q, { headers, timeoutMs: 4000 })).then(
    (res) => {
      if (res.status !== 200) return null;
      try {
        const body = JSON.parse(res.text) as WatchBest;
        if (!body || typeof body.infohash !== 'string' || !/^[0-9a-f]{40}$/.test(body.infohash)) return null;
        return body;
      } catch (e) {
        return null;
      }
    },
    () => null,
  );
}
