const FEED_BASE = 'https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/';
export const UPDATE_URL = FEED_BASE + 'update.json';
export const ANDROID_UPDATE_URL = FEED_BASE + 'update-android.json';
export const HB_REPO_URL = FEED_BASE + 'apps.json';
export const RELEASES_URL = 'https://github.com/spacesarmat/omp/releases/latest';
export const HB_SITE_URL = 'https://www.webosbrew.org/';

/** Per-ABI APK keys of update-android.json. */
export type ApkAbi = 'arm64' | 'armv7';
export const APK_ABIS: ApkAbi[] = ['arm64', 'armv7'];

export interface ApkFile {
  url: string;
  sha256: string;
  /** Bytes; 0 = not published. */
  size: number;
}

export interface UpdateInfo {
  version: string;
  /** update.json: the ipk; update-android.json: the universal APK (the only fields 0.14.x clients read). */
  ipkUrl: string;
  ipkHash: string;
  ipkSize: number;
  /**
   * update-android.json only: APKs per ABI; the native installer picks the device's one (Build.SUPPORTED_ABIS,
   * see ApkAbi.kt) and falls back to ipkUrl. Absent when the feed has no valid per-ABI entry.
   */
  apks?: Partial<Record<ApkAbi, ApkFile>>;
  notes: string[];
  releaseUrl: string;
}

const VERSION = /^[0-9]+(\.[0-9]+){1,3}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const isHttps = (v: unknown): v is string => typeof v === 'string' && v.indexOf('https://') === 0;
const positiveSize = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

/** The `apks` object: entries with an HTTPS url and a sha256 are kept, anything else is dropped. */
function sanitizeApks(v: unknown): Partial<Record<ApkAbi, ApkFile>> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Partial<Record<ApkAbi, ApkFile>> = {};
  let any = false;
  APK_ABIS.forEach((k) => {
    const e = o[k];
    if (!e || typeof e !== 'object' || Array.isArray(e)) return;
    const r = e as Record<string, unknown>;
    if (!isHttps(r.url) || typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) return;
    out[k] = { url: r.url, sha256: r.sha256.toLowerCase(), size: positiveSize(r.size) };
    any = true;
  });
  return any ? out : null;
}

/** The APK a device with this feed key (ApkAbi.key in Kotlin; null = universal) downloads. */
export function apkFor(info: UpdateInfo, key: ApkAbi | null): ApkFile {
  const e = key && info.apks ? info.apks[key] : undefined;
  return e || { url: info.ipkUrl, sha256: info.ipkHash, size: info.ipkSize };
}

/** Validates update.json from the gh-pages feed; anything malformed means "no update". */
export function sanitizeUpdateInfo(v: unknown): UpdateInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  if (!isHttps(o.ipkUrl)) return null;
  if (typeof o.ipkHash !== 'string' || !SHA256.test(o.ipkHash)) return null;
  const info: UpdateInfo = {
    version: o.version,
    ipkUrl: o.ipkUrl,
    ipkHash: o.ipkHash.toLowerCase(),
    ipkSize: positiveSize(o.ipkSize),
    notes: Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()) : [],
    releaseUrl: isHttps(o.releaseUrl) ? o.releaseUrl : RELEASES_URL,
  };
  const apks = sanitizeApks(o.apks);
  if (apks) info.apks = apks;
  return info;
}
