const FEED_BASE = 'https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/';
export const UPDATE_URL = FEED_BASE + 'update.json';
export const HB_REPO_URL = FEED_BASE + 'apps.json';
export const RELEASES_URL = 'https://github.com/spacesarmat/omp/releases/latest';
export const HB_SITE_URL = 'https://www.webosbrew.org/';

export interface UpdateInfo {
  version: string;
  ipkUrl: string;
  ipkHash: string;
  ipkSize: number;
  notes: string[];
  releaseUrl: string;
}

const VERSION = /^[0-9]+(\.[0-9]+){1,3}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const isHttps = (v: unknown): v is string => typeof v === 'string' && v.indexOf('https://') === 0;

/** Validates update.json from the gh-pages feed; anything malformed means "no update". */
export function sanitizeUpdateInfo(v: unknown): UpdateInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  if (!isHttps(o.ipkUrl)) return null;
  if (typeof o.ipkHash !== 'string' || !SHA256.test(o.ipkHash)) return null;
  return {
    version: o.version,
    ipkUrl: o.ipkUrl,
    ipkHash: o.ipkHash.toLowerCase(),
    ipkSize: typeof o.ipkSize === 'number' && isFinite(o.ipkSize) && o.ipkSize > 0 ? o.ipkSize : 0,
    notes: Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()) : [],
    releaseUrl: isHttps(o.releaseUrl) ? o.releaseUrl : RELEASES_URL,
  };
}
