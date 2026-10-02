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
