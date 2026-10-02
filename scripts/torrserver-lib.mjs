// Pure helpers for scripts/fetch-torrserver.mjs.
export const ASSET_NAME = 'TorrServer-android-arm64';

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

export function isNewerTag(current, latest) {
  const l = String(latest || '').trim();
  return l !== '' && l !== String(current || '').trim();
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
