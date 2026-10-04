// Pure helpers for scripts/torrserver-pin.mjs and scripts/torrserver-bump.mjs.
export const ASSET_NAME = 'TorrServer-android-arm64';
/** The pinned download the app reads (res/raw): tag, asset, url, sha256, size. Committed; written by torrserver-bump. */
export const PIN_PATH = 'android/app/src/main/res/raw/torrserver.json';
/** The binary android:sync used to place in the APK; removed when a dev tree still has it. */
export const LEGACY_LIB = 'android/app/src/main/jniLibs/arm64-v8a/libtorrserver.so';
const URL_PREFIX = 'https://github.com/YouROK/TorrServer/releases/download/';
const MAX_SIZE = 256 * 1024 * 1024;

export function parseVersionFile(text) {
  const tag = String(text).trim();
  if (!tag) throw new Error('torrserver.version is empty / файл torrserver.version пуст');
  if (!/^[A-Za-z0-9._-]+$/.test(tag)) throw new Error(`Bad tag in torrserver.version: ${tag}`);
  return tag;
}

export function pickAsset(release) {
  const asset = ((release && release.assets) || []).find((a) => a && a.name === ASSET_NAME);
  if (!asset) throw new Error(`Asset ${ASSET_NAME} not found in release / в выпуске нет ассета ${ASSET_NAME}`);
  return asset;
}

export function parseDigest(digest) {
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(typeof digest === 'string' ? digest : '');
  if (!m) throw new Error('Asset has no valid sha256 digest / у ассета нет корректного digest sha256');
  return m[1].toLowerCase();
}

export function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`Bad version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function insertChangelog(text, version, tag) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const entry = `## ${version}${eol}${eol}- Встроенный TorrServer обновлён до ${tag}${eol}${eol}`;
  const idx = text.search(/^## /m);
  if (idx < 0) return text.replace(/\s*$/, '') + eol + eol + entry.replace(/\s+$/, '') + eol;
  return text.slice(0, idx) + entry + text.slice(idx);
}

// Replaces the first "version" field, and with lock=true also the one inside packages[""].
// Dependency versions are never touched.
export function setRootVersion(text, version, lock = false) {
  const re = /^(\s*"version":\s*")[^"]*(")/m;
  if (!re.test(text)) throw new Error('No "version" field found');
  let out = text.replace(re, `$1${version}$2`);
  if (lock) {
    const re2 = /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]*(")/;
    if (!re2.test(out)) throw new Error('No packages[""].version found');
    out = out.replace(re2, `$1${version}$2`);
  }
  return out;
}

/** The pin for [tag] from a GitHub API release: the arm64 asset's URL, sha256 digest and size. */
export function pinFromRelease(release, tag) {
  if (!release || release.tag_name !== tag) throw new Error(`Release is not ${tag} / выпуск не ${tag}`);
  const asset = pickAsset(release);
  return checkPin({ tag, asset: asset.name, url: asset.browser_download_url, sha256: parseDigest(asset.digest), size: asset.size });
}

/** Validates a pin object; returns it with only the known fields. */
export function checkPin(p) {
  if (!p || typeof p !== 'object') throw new Error('Pin is not an object');
  const tag = parseVersionFile(typeof p.tag === 'string' ? p.tag : '');
  const url = typeof p.url === 'string' ? p.url : '';
  if (p.asset !== ASSET_NAME) throw new Error('Pin asset must be ' + ASSET_NAME);
  if (url !== URL_PREFIX + tag + '/' + ASSET_NAME) throw new Error('Pin url does not match the tag: ' + url);
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new Error('Pin sha256 is invalid');
  if (!Number.isInteger(p.size) || p.size <= 0 || p.size > MAX_SIZE) throw new Error('Pin size is invalid');
  return { tag, asset: p.asset, url, sha256: p.sha256, size: p.size };
}

export function formatPin(p) {
  return JSON.stringify(checkPin(p), null, 2) + '\n';
}

/** Parses the pin file and checks it matches torrserver.version. */
export function parsePin(text, tag) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error('torrserver.json is not JSON / файл torrserver.json повреждён');
  }
  const pin = checkPin(p);
  if (pin.tag !== tag) {
    throw new Error(`torrserver.json is for ${pin.tag}, torrserver.version says ${tag}: run node scripts/torrserver-bump.mjs ${tag}`);
  }
  return pin;
}
