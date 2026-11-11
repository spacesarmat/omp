// Pure builders for the Homebrew Channel manifest, the OMP repository (apps.json) and the in-app update feed.
export const APP_ID = 'com.spacesarmat.torrplayer';
export const REPO = 'spacesarmat/omp';
export const FEED_BASE = `https://raw.githubusercontent.com/${REPO}/gh-pages/`;

/** The text of the update feed's `notes` when no bullet is left for the TV (old apps show `notes` as they are). */
export const FIXES_NOTE = 'Исправления и улучшения';

/** Whether a bullet marked `mark` ('' = unmarked) shows on `platform` ('lg' | 'atv' | 'phone'); «[tv]» is both TVs. */
function markShownOn(mark, platform) {
  if (!mark) return true;
  if (mark === 'tv') return platform !== 'phone';
  return mark === platform;
}

/** A «[tech]» bullet: technical or admin-only, never shown to users (app, feeds, release body, Telegram). */
export const TECH_MARK = /^\[tech\]\s*/i;

/** Whether a changelog bullet (without its leading "- ") is a «[tech]» one. */
export function isTech(item) {
  return TECH_MARK.test(item);
}

/**
 * Bullet lines under "## <version>" in CHANGELOG.md, without the «[tv]» / «[lg]» / «[atv]» / «[phone]» markers.
 * With `platform` ('lg' | 'atv' | 'phone'): the unmarked bullets and those that platform shows.
 * «[tech]» bullets are skipped unless `includeTech` is set (then they keep their «[tech]» marker).
 */
export function changelogNotes(md, version, platform, { includeTech = false } = {}) {
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
    // the markers say which app shows a bullet in «Что нового»; release notes list them all, unmarked
    if (!m) continue;
    if (isTech(m[1])) {
      if (includeTech) out.push(m[1]);
      continue;
    }
    const mark = /^\[(tv|lg|atv|phone)\]\s*/i.exec(m[1]);
    if (platform && !markShownOn(mark ? mark[1].toLowerCase() : '', platform)) continue;
    out.push(mark ? m[1].slice(mark[0].length) : m[1]);
  }
  return out;
}

/**
 * The notes of one update feed: `notesTv` / `notesPhone` for the apps that read them (0.17.0 and later), and
 * `notes` for older apps: the TV's bullets, «Исправления и улучшения» when there is none. `tv` is the TV that reads
 * the feed: 'lg' for update.json (LG TVs only), 'atv' for update-android.json (the phone and Android TV alike; the
 * phone reads notesPhone). Never a marker, never a «[tech]» bullet.
 */
export function feedNotes(md, version, tv) {
  const notesTv = changelogNotes(md, version, tv);
  const notesPhone = changelogNotes(md, version, 'phone');
  return { notes: notesTv.length ? notesTv : [FIXES_NOTE], notesTv, notesPhone };
}

export function buildHomebrew({ tag, version, ipkName, sha256, size, title, description, notes, notesTv, notesPhone }) {
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
  if (notesTv) update.notesTv = notesTv;
  if (notesPhone) update.notesPhone = notesPhone;
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
 * APK paths from the command line → the universal one and the per-ABI ones by file name. Throws without a universal
 * APK (0.14.x clients need it) or with two files for one slot. No paths → null (no Android feed).
 */
export function splitApks(paths) {
  if (!paths.length) return null;
  let universal = null;
  const abis = {};
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    const key = apkAbi(name);
    if (key ? abis[key] : universal) throw new Error(`two APKs for ${key || 'universal'}: ${name}`);
    if (key) abis[key] = p;
    else universal = p;
  }
  if (!universal) throw new Error('the universal APK (OMP-x.y.z.apk) is required for the Android feed');
  return { universal, abis };
}

/**
 * Update feed for the Android client. ipkUrl/ipkHash/ipkSize point at the universal APK (0.14.x clients read only
 * these); `apks` lists the per-ABI APKs ({ arm64: { url, sha256, size }, armv7: … }) that newer clients pick by the
 * device ABI.
 */
export function buildAndroidUpdate({ tag, version, apkName, sha256, size, notes, notesTv, notesPhone, abis }) {
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
  if (notesTv) out.notesTv = notesTv;
  if (notesPhone) out.notesPhone = notesPhone;
  out.releaseUrl = `https://github.com/${REPO}/releases/tag/${tag}`;
  return out;
}


function releaseFile(tag, name, sha256, size) {
  return {
    url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
    sha256,
    size,
  };
}

export function buildWindowsUpdate({ tag, version, nsisName, sha256, notes, size, portable }) {
  const update = {
    version,
    url: `https://github.com/${REPO}/releases/download/${tag}/${nsisName}`,
    sha256,
    notes,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
  };
  if (typeof size === 'number') update.size = size;
  if (portable) {
    update.assets = {
      nsis: releaseFile(tag, nsisName, sha256, typeof size === 'number' ? size : 0),
      portable: releaseFile(tag, portable.name, portable.sha256, portable.size),
    };
  }
  return update;
}

/** macOS feed. `url` is the Apple Silicon disk image when both exist, else the Intel one. */
export function buildMacosUpdate({ tag, version, notes, arm64, x64 }) {
  const primary = arm64 || x64;
  const update = {
    version,
    url: `https://github.com/${REPO}/releases/download/${tag}/${primary.name}`,
    sha256: primary.sha256,
    size: primary.size,
    notes,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
  };
  const assets = {};
  if (arm64) assets.arm64 = releaseFile(tag, arm64.name, arm64.sha256, arm64.size);
  if (x64) assets.x64 = releaseFile(tag, x64.name, x64.sha256, x64.size);
  if (Object.keys(assets).length) update.assets = assets;
  return update;
}

/** Linux feed. `url` is the AppImage used by auto-update. The deb is an extra download. */
export function buildLinuxUpdate({ tag, version, notes, appimage, deb }) {
  const update = {
    version,
    url: `https://github.com/${REPO}/releases/download/${tag}/${appimage.name}`,
    sha256: appimage.sha256,
    size: appimage.size,
    notes,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
  };
  update.assets = {
    appimage: releaseFile(tag, appimage.name, appimage.sha256, appimage.size),
  };
  if (deb) update.assets.deb = releaseFile(tag, deb.name, deb.sha256, deb.size);
  return update;
}
