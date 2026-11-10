// Asks billing for a cache node. Called only when the last /v1/me turned the feature on.
import { billingGet, billingPost } from '../billing/client';
import { cacheNodesOn } from '../billing/entitlement';
import { withDeviceToken } from '../billing/tokens';
import { allowTypedCleartext } from '../cleartextSync';
import type { SourceContext } from '../sources/types';
import { rememberCacheSource, type CacheReleaseSource } from './cacheNode';

function parseSource(text: string, hash: string): CacheReleaseSource | null {
  let body: { enabled?: boolean; source?: { url?: string; infohash?: string; title?: string; prefixBytes?: number } | null };
  try {
    body = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!body || body.enabled !== true || !body.source) return null;
  const infohash = String(body.source.infohash || '').toLowerCase();
  if (infohash !== hash) return null;
  const url = String(body.source.url || '');
  if (!/^https?:\/\//i.test(url) || url.indexOf('@') >= 0) return null;
  const prefix = body.source.prefixBytes;
  return {
    url: url,
    infohash: infohash,
    title: String(body.source.title || ''),
    prefixBytes: typeof prefix === 'number' && isFinite(prefix) && prefix > 0 ? Math.floor(prefix) : 0,
  };
}

/** Public HTTP has to be on the native allow-list before a player opens the URL. HTTPS needs no list. */
function allowPlayback(source: CacheReleaseSource | null): Promise<CacheReleaseSource | null> {
  if (!source || source.url.indexOf('http://') !== 0) return Promise.resolve(source);
  return allowTypedCleartext(source.url).then(
    () => source,
    () => null,
  );
}

/** Resolves a cache node for this infohash, or null when the feature is off or billing has none. */
export function prepareCachePlayback(hash: string, ctx: SourceContext | null): Promise<CacheReleaseSource | null> {
  if (!cacheNodesOn()) return Promise.resolve(null);
  const id = String(hash || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(id) || !ctx || !ctx.http) return Promise.resolve(null);
  return withDeviceToken(ctx, (headers) =>
    billingGet(ctx, '/v1/cache/source?infohash=' + id, { headers: headers, timeoutMs: 4000 }).then((res) => {
      billingPost(ctx, '/v1/cache/interest', { infohash: id, event: 'play' }, { headers: headers, timeoutMs: 4000 }).then(
        () => undefined,
        () => undefined,
      );
      return res;
    }),
  ).then(
    (res) => {
      const source = res.status === 200 ? parseSource(res.text, id) : null;
      return allowPlayback(source).then((ready) => {
        rememberCacheSource(id, ready);
        return ready;
      });
    },
    () => {
      rememberCacheSource(id, null);
      return null;
    },
  );
}
