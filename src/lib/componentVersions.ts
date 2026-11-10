import { compareVersions } from './version';

/** GitHub latest-release documents. The app reads them on launch and ignores anything it cannot check. */
export const PLAYER_LATEST_URL = 'https://api.github.com/repos/spacesarmat/2160player/releases/latest';
export const TORR_LATEST_URL = 'https://api.github.com/repos/YouROK/TorrServer/releases/latest';

const PLAYER_REPO = 'spacesarmat/2160player';
const TORR_REPO = 'YouROK/TorrServer';
const SHA256 = /^[0-9a-f]{64}$/;
const MATRIX = /^MatriX\.(\d+)(?:\.(\d+))?$/;
const LEGACY = /^(\d+)\.(\d+)\.(\d+)$/;
const PLAYER = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;
const MAX_ASSET = 256 * 1024 * 1024;

export type PlayerAbi = 'arm64' | 'armv7';

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
  size: number;
}

export interface PlayerRelease {
  /** v0.2.25 */
  tag: string;
  /** 0.2.25, compared with PackageInfo.versionName. */
  version: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export interface TorrRelease {
  tag: string;
  releaseUrl: string;
}

/** A version string OMP is willing to compare. null: unknown, the caller stays quiet. */
export function playerVersionOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 32 || !PLAYER.test(s)) return null;
  return s;
}

/** First line of TorrServer /echo, or a pin tag. null when it is not a known version. */
export function torrServerVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const line = raw.trim().split(/\r?\n/, 1)[0].trim();
  if (!line || line.length > 64) return null;
  if (MATRIX.test(line) || LEGACY.test(line)) return line;
  return null;
}

function matrixParts(tag: string): number[] | null {
  const m = MATRIX.exec(tag);
  if (!m) return null;
  return [Number(m[1]), m[2] ? Number(m[2]) : 0];
}

function legacyParts(tag: string): number[] | null {
  const m = LEGACY.exec(tag);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpNums(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * -1 / 0 / 1. MatriX.150 > MatriX.147.2 > MatriX.147. A 1.2.x echo is older than any MatriX tag.
 * null when either side is not a version we know (the prompt must not guess).
 */
export function compareTorr(a: string, b: string): number | null {
  const am = matrixParts(a);
  const bm = matrixParts(b);
  if (am && bm) return cmpNums(am, bm);
  const al = legacyParts(a);
  const bl = legacyParts(b);
  if (al && bl) return cmpNums(al, bl);
  if (al && bm) return -1;
  if (am && bl) return 1;
  return null;
}

/** True when [installed] is strictly older than [latest]. Unknown versions are not older. */
export function isOlder(installed: string | null, latest: string | null, torr: boolean): boolean {
  if (!installed || !latest) return false;
  if (torr) {
    const d = compareTorr(installed, latest);
    return d !== null && d < 0;
  }
  return compareVersions(installed, latest) < 0;
}

function releaseObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function downloadUrl(repo: string, tag: string, name: string): string {
  return 'https://github.com/' + repo + '/releases/download/' + tag + '/' + name;
}

function takeAsset(raw: unknown, repo: string, tag: string): ReleaseAsset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const name = typeof a.name === 'string' ? a.name : '';
  if (!name || name.length > 180 || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return null;
  const url = typeof a.browser_download_url === 'string' ? a.browser_download_url : '';
  if (url !== downloadUrl(repo, tag, name)) return null;
  const digest = typeof a.digest === 'string' ? a.digest : '';
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(digest);
  if (!m || !SHA256.test(m[1].toLowerCase())) return null;
  const size = a.size;
  if (typeof size !== 'number' || !isFinite(size) || size <= 0 || size > MAX_ASSET || Math.floor(size) !== size) return null;
  return { name, url, sha256: m[1].toLowerCase(), size };
}

function assetList(raw: unknown, repo: string, tag: string): ReleaseAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleaseAsset[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = takeAsset(raw[i], repo, tag);
    if (a) out.push(a);
  }
  return out;
}

/** Stable 2160 Player release, or null when the document is not one we can use. */
export function parsePlayerRelease(raw: unknown): PlayerRelease | null {
  const o = releaseObject(raw);
  if (!o || o.draft === true || o.prerelease === true) return null;
  const tag = typeof o.tag_name === 'string' ? o.tag_name.trim() : '';
  const parsed = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!parsed || !playerVersionOrNull(parsed[1])) return null;
  return {
    tag,
    version: parsed[1],
    releaseUrl: 'https://github.com/' + PLAYER_REPO + '/releases/tag/' + tag,
    assets: assetList(o.assets, PLAYER_REPO, tag),
  };
}

/** Stable MatriX TorrServer release, or null. */
export function parseTorrRelease(raw: unknown): TorrRelease | null {
  const o = releaseObject(raw);
  if (!o || o.draft === true || o.prerelease === true) return null;
  const tag = typeof o.tag_name === 'string' ? o.tag_name.trim() : '';
  if (!torrServerVersion(tag) || !MATRIX.test(tag)) return null;
  return {
    tag,
    releaseUrl: 'https://github.com/' + TORR_REPO + '/releases/tag/' + tag,
  };
}

function named(assets: ReleaseAsset[], name: string): ReleaseAsset | null {
  for (let i = 0; i < assets.length; i++) if (assets[i].name === name) return assets[i];
  return null;
}

/**
 * APK for this device. arm64 / armv7 prefer their own file, then the arm build (fits phones and TVs),
 * then universal. null when the release published none of those: the dialog only offers the page.
 */
export function pickPlayerApk(release: PlayerRelease, abi: PlayerAbi | null): ReleaseAsset | null {
  const v = release.version;
  const arm64 = named(release.assets, '2160player-' + v + '-arm64-v8a-release.apk');
  const armv7 = named(release.assets, '2160player-' + v + '-armeabi-v7a-release.apk');
  const arm = named(release.assets, '2160player-' + v + '-arm-release.apk');
  const universal = named(release.assets, '2160player-' + v + '-universal-release.apk');
  if (abi === 'arm64') return arm64 || arm || universal;
  if (abi === 'armv7') return armv7 || arm || universal;
  return arm || universal || arm64 || armv7;
}

export interface TorrReading {
  version: string;
  source: 'remote' | 'embedded';
  /** OMP's pinned tag, when this reading is the embedded server. */
  pin?: string;
  /** On-disk binary is older than the pin. The existing sheet already offers that download. */
  embeddedOutdated?: boolean;
  mobileData?: boolean;
}

export interface ComponentOffer {
  kind: 'player' | 'torrserver';
  installed: string;
  latest: string;
  releaseUrl: string;
  /** Present when Update can hand this APK to the system installer. */
  apk?: { url: string; sha256: string };
  /** Embedded TorrServer, and the pin is exactly [latest]: the existing downloader can install it. */
  installEmbedded?: boolean;
  mobileData?: boolean;
}

export function decideOffers(input: {
  playerInstalled: string | null;
  playerRelease: unknown;
  torr: TorrReading | null;
  torrRelease: unknown;
  abi: PlayerAbi | null;
  skipped: { player?: string; torrserver?: string };
}): ComponentOffer[] {
  const out: ComponentOffer[] = [];
  const player = parsePlayerRelease(input.playerRelease);
  const installedPlayer = playerVersionOrNull(input.playerInstalled);
  if (player && installedPlayer && isOlder(installedPlayer, player.version, false) && input.skipped.player !== player.version) {
    const apk = pickPlayerApk(player, input.abi);
    const offer: ComponentOffer = {
      kind: 'player',
      installed: installedPlayer,
      latest: player.version,
      releaseUrl: player.releaseUrl,
    };
    if (apk) offer.apk = { url: apk.url, sha256: apk.sha256 };
    out.push(offer);
  }
  const torrRel = parseTorrRelease(input.torrRelease);
  const reading = input.torr;
  const installedTorr = reading ? torrServerVersion(reading.version) : null;
  if (torrRel && reading && installedTorr && isOlder(installedTorr, torrRel.tag, true) && input.skipped.torrserver !== torrRel.tag) {
    if (!(reading.source === 'embedded' && reading.embeddedOutdated)) {
      const pin = reading.pin ? torrServerVersion(reading.pin) : null;
      const offer: ComponentOffer = {
        kind: 'torrserver',
        installed: installedTorr,
        latest: torrRel.tag,
        releaseUrl: torrRel.releaseUrl,
      };
      if (reading.source === 'embedded' && pin && compareTorr(pin, torrRel.tag) === 0 && isOlder(installedTorr, pin, true)) {
        offer.installEmbedded = true;
        if (reading.mobileData) offer.mobileData = true;
      }
      out.push(offer);
    }
  }
  return out;
}
