// Playback hook for a popular-release cache node. With no source the local TorrServer URL is unchanged.

export interface CacheReleaseSource {
  url: string;
  infohash: string;
  title: string;
  prefixBytes: number;
}

const remembered: { [hash: string]: CacheReleaseSource } = {};

export function rememberCacheSource(hash: string, source: CacheReleaseSource | null): void {
  const id = String(hash || '').toLowerCase();
  if (!id) return;
  if (!source) {
    delete remembered[id];
    return;
  }
  remembered[id] = source;
}

export function rememberedCacheSource(hash: string): CacheReleaseSource | null {
  return remembered[String(hash || '').toLowerCase()] || null;
}

export function clearCacheSources(): void {
  const keys = Object.keys(remembered);
  for (let i = 0; i < keys.length; i++) delete remembered[keys[i]];
}

function hostOf(base: string): string {
  const rest = base.replace(/^https?:\/\//i, '');
  const hostport = rest.split('/')[0];
  if (hostport.charAt(0) === '[') {
    const end = hostport.indexOf(']');
    return end < 0 ? '' : hostport.slice(1, end).toLowerCase();
  }
  return hostport.split(':')[0].toLowerCase();
}

/** Origin only. Userinfo, localhost and link-local addresses are refused. */
export function cacheBase(raw: string): string {
  const text = String(raw || '').trim();
  if (!/^https?:\/\//i.test(text) || text.indexOf('@') >= 0) return '';
  const slash = text.indexOf('/', text.indexOf('//') + 2);
  const base = (slash < 0 ? text : text.slice(0, slash)).replace(/\/+$/, '');
  if (!base || base.indexOf('?') >= 0 || base.indexOf('#') >= 0) return '';
  const host = hostOf(base);
  if (!host || host === 'localhost' || host === '::1') return '';
  if (host.indexOf('127.') === 0 || host.indexOf('0.') === 0 || host.indexOf('169.254.') === 0) return '';
  return base;
}

/**
 * Stream URL for this release. A cache node replaces only the origin, and only for the same infohash.
 * Anything else, including a missing source, returns `localUrl` unchanged.
 */
export function rewritePlaybackUrl(localUrl: string, hash: string, source: CacheReleaseSource | null): string {
  if (!source) return localUrl;
  if (!hash || String(source.infohash || '').toLowerCase() !== String(hash).toLowerCase()) return localUrl;
  const base = cacheBase(source.url);
  if (!base) return localUrl;
  const m = /^(https?:\/\/[^/?#]+)/i.exec(localUrl);
  if (!m) return localUrl;
  return base + localUrl.slice(m[1].length);
}
