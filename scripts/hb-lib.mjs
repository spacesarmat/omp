// Pure builders for the Homebrew Channel manifest, the OMP repository (apps.json) and the in-app update feed.
export const APP_ID = 'com.spacesarmat.torrplayer';
export const REPO = 'spacesarmat/omp';
export const FEED_BASE = `https://raw.githubusercontent.com/${REPO}/gh-pages/`;

/** Bullet lines under "## <version>" in CHANGELOG.md. */
export function changelogNotes(md, version) {
  const out = [];
  let on = false;
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (on) break;
      on = h[1] === version;
      continue;
    }
    if (!on) continue;
    const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

export function buildHomebrew({ tag, version, ipkName, sha256, size, title, description, notes }) {
  const ipkUrl = `https://github.com/${REPO}/releases/download/${tag}/${ipkName}`;
  const iconUri = `https://raw.githubusercontent.com/${REPO}/main/webos/largeIcon.png`;
  const manifest = {
    id: APP_ID,
    version,
    type: 'web',
    title,
    appDescription: description,
    iconUri,
    sourceUrl: `https://github.com/${REPO}`,
    rootRequired: false,
    ipkUrl,
    ipkHash: { sha256 },
    ipkSize: size,
  };
  const apps = {
    packages: [
      {
        id: APP_ID,
        title,
        iconUri,
        manifestUrl: `${FEED_BASE}${APP_ID}.manifest.json`,
        manifest,
        pool: 'main',
        shortDescription: description,
        fullDescriptionUrl: 'full_description.html',
      },
    ],
  };
  const update = {
    version,
    ipkUrl,
    ipkHash: sha256,
    ipkSize: size,
    notes,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
  };
  return { manifest, apps, update };
}

/** APK keys of the Android feed by ABI (OMP-x.y.z-arm64.apk → arm64). */
export const APK_ABIS = ['arm64', 'armv7'];

/** ABI key of a per-ABI APK name (OMP-0.15.0-arm64.apk → 'arm64'); null for the universal APK. */
export function apkAbi(name) {
  const m = /-(arm64|armv7)\.apk$/.exec(name);
  return m ? m[1] : null;
}

/**
 * Update feed for the Android client. ipkUrl/ipkHash/ipkSize point at the universal APK (0.14.x clients read only
 * these); `apks` lists the per-ABI APKs ({ arm64: { url, sha256, size }, armv7: … }) that newer clients pick by the
 * device ABI.
 */
export function buildAndroidUpdate({ tag, version, apkName, sha256, size, notes, abis }) {
  const url = (name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  const out = {
    version,
    ipkUrl: url(apkName),
    ipkHash: sha256,
    ipkSize: size,
  };
  const apks = {};
  for (const key of APK_ABIS) {
    const a = abis && abis[key];
    if (a) apks[key] = { url: url(a.name), sha256: a.sha256, size: a.size };
  }
  if (Object.keys(apks).length) out.apks = apks;
  out.notes = notes;
  out.releaseUrl = `https://github.com/${REPO}/releases/tag/${tag}`;
  return out;
}
