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
