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

// A prerelease is the pending stable: 0.20.2-beta.2 -> 0.20.2. A plain release steps the patch: 0.20.2 -> 0.20.3.
export function bumpPatch(version) {
  const raw = String(version).trim();
  const pre = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(raw);
  if (pre) return `${pre[1]}.${pre[2]}.${pre[3]}`;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (!m) throw new Error(`Bad version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function torrserverNote(tag, english = false) {
  return english ? `The built-in TorrServer is updated to ${tag}` : `Встроенный TorrServer обновлён до ${tag}`;
}

export function insertChangelog(text, version, tag, note) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = note || torrserverNote(tag);
  const entry = `## ${version}${eol}${eol}- ${line}${eol}${eol}`;
  const idx = text.search(/^## /m);
  if (idx < 0) return text.replace(/\s*$/, '') + eol + eol + entry.replace(/\s+$/, '') + eol;
  return text.slice(0, idx) + entry + text.slice(idx);
}

const UNRELEASED_HEADING = /^## (Не выпущено|Unreleased)[ \t]*\r?$/im;
const TORRSERVER_LINE = /^- (Встроенный TorrServer обновлён до|The built-in TorrServer is updated to) [^\r\n]*\r?\n/m;

/**
 * Puts the TorrServer line into the unreleased section («## Не выпущено» / «## Unreleased»), creating the section
 * above the latest version when missing. An older TorrServer line in that section is replaced, so two bumps before
 * a release leave one line. The OMP version is not touched: the release PR moves the section under its version.
 */
export function insertUnreleased(text, note, english = false) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const bullet = `- ${note}${eol}`;
  const m = UNRELEASED_HEADING.exec(text);
  if (m) {
    const bodyStart = m.index + m[0].length + (text[m.index + m[0].length] === '\n' ? 1 : 0);
    const next = text.slice(bodyStart).search(/^## /m);
    const bodyEnd = next < 0 ? text.length : bodyStart + next;
    let body = text.slice(bodyStart, bodyEnd);
    const noteIsTorr = /^(Встроенный TorrServer обновлён до|The built-in TorrServer is updated to) /.test(note);
    if (noteIsTorr && TORRSERVER_LINE.test(body)) body = body.replace(TORRSERVER_LINE, bullet);
    else {
      const lead = /^(\r?\n)*/.exec(body)[0];
      body = (lead || eol) + bullet + body.slice(lead.length);
      if (!/\r?\n\r?\n$/.test(body) && next >= 0) body = body.replace(/(\r?\n)*$/, eol + eol);
    }
    return text.slice(0, bodyStart) + body + text.slice(bodyEnd);
  }
  const heading = english ? 'Unreleased' : 'Не выпущено';
  const entry = `## ${heading}${eol}${eol}${bullet}${eol}`;
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
export const WINDOWS_ASSET = 'TorrServer-windows-amd64.exe';
const MIN_BIN = 20 * 1024 * 1024;
const MAX_BIN = 120 * 1024 * 1024;

function matrixParts(tag) {
  const m = /^MatriX\.(\d+)(?:\.(\d+))?$/.exec(String(tag).trim());
  if (!m) return null;
  return [Number(m[1]), m[2] ? Number(m[2]) : 0];
}

/** 1 / 0 / -1, or null when either tag is not MatriX.N or MatriX.N.M. */
export function compareMatrix(a, b) {
  const pa = matrixParts(a);
  const pb = matrixParts(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function assetPin(release, tag, name) {
  const asset = ((release && release.assets) || []).find((a) => a && a.name === name);
  if (!asset) throw new Error('Asset ' + name + ' not found / нет ассета ' + name);
  const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
  if (url !== URL_PREFIX + tag + '/' + name) throw new Error('Pin url does not match the tag: ' + url);
  const size = asset.size;
  if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) throw new Error('Pin size is invalid');
  return { tag, asset: name, url, sha256: parseDigest(asset.digest), size };
}

/** Windows desktop binary of [tag]. Same checks as the Android pin. */
export function windowsPin(release, tag) {
  return assetPin(release, tag, WINDOWS_ASSET);
}

/**
 * Whether an upstream release is safe to pin: stable, a newer MatriX tag, arm64 and windows assets
 * with sha256 and a plausible size. { ok:false } is a skip, not a crash.
 */
export function assessRelease(release, currentTag) {
  if (!release || typeof release !== 'object') return { ok: false, reason: 'no release' };
  if (release.draft || release.prerelease) return { ok: false, reason: 'not a stable release' };
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  let current;
  try {
    current = parseVersionFile(currentTag);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!matrixParts(tag)) return { ok: false, reason: 'unexpected tag ' + tag };
  const cmp = compareMatrix(tag, current);
  if (cmp === null) return { ok: false, reason: 'cannot compare ' + tag };
  if (cmp <= 0) return { ok: false, reason: tag + ' is not newer than ' + current };
  try {
    const arm = pinFromRelease(release, tag);
    if (arm.size < MIN_BIN || arm.size > MAX_BIN) return { ok: false, reason: 'arm64 size ' + arm.size };
    const win = windowsPin(release, tag);
    if (win.size < MIN_BIN || win.size > MAX_BIN) return { ok: false, reason: 'windows size ' + win.size };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, reason: '' };
}

/** Rust integer with underscores, matching the desktop pin (`63_884_288`). */
export function rustNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
}

const RUST_BLOCK = /id: "torrserver"\.to_string\(\),\r?\n([ \t]*)version: "[^"]+"\.to_string\(\),\r?\n[ \t]*url: "[^"]+"\.to_string\(\),\r?\n[ \t]*sha256: "[^"]+"\.to_string\(\),\r?\n[ \t]*max_bytes: [\d_]+,/;

/** The Windows TorrServer pin inside desktop/src-tauri/src/platform.rs. */
export function readRustPin(text) {
  const m = RUST_BLOCK.exec(text);
  if (!m) throw new Error('desktop TorrServer pin not found');
  return {
    tag: /version: "([^"]+)"/.exec(m[0])[1],
    url: /url: "([^"]+)"/.exec(m[0])[1],
    sha256: /sha256: "([^"]+)"/.exec(m[0])[1],
    size: Number(/max_bytes: ([\d_]+)/.exec(m[0])[1].replace(/_/g, '')),
  };
}

export function writeRustPin(text, pin) {
  const m = RUST_BLOCK.exec(text);
  if (!m) throw new Error('desktop TorrServer pin not found');
  const indent = m[1];
  const block = [
    'id: "torrserver".to_string(),',
    indent + 'version: "' + pin.tag + '".to_string(),',
    indent + 'url: "' + pin.url + '".to_string(),',
    indent + 'sha256: "' + pin.sha256 + '".to_string(),',
    indent + 'max_bytes: ' + rustNum(pin.size) + ',',
  ].join(text.includes('\r\n') ? '\r\n' : '\n');
  return text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
}

export function patchPinLiteral(text, from, to) {
  const needle = "pinVersion: '" + from + "'";
  if (!text.includes(needle)) throw new Error('pinVersion not found');
  return text.split(needle).join("pinVersion: '" + to + "'");
}

/** Replaces the previous Windows pin's tag, sha256 and size in the desktop test. */
export function patchDesktopTest(text, prev, pin) {
  let out = text.split(prev.tag).join(pin.tag);
  out = out.split(prev.sha256).join(pin.sha256);
  const oldRust = rustNum(prev.size);
  const newRust = rustNum(pin.size);
  if (oldRust !== newRust) out = out.split(oldRust).join(newRust);
  if (String(prev.size) !== String(pin.size)) out = out.split(String(prev.size)).join(String(pin.size));
  return out;
}

/** Release notes for a PR body: one paragraph, hyphens only, cut at 800 characters. */
export function releaseSummary(body) {
  let text = String(body || '');
  text = text.replace(/\u2014/g, '-').replace(/\u2013/g, '-').replace(/\u2011/g, '-');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/\[[^\]]*]\([^)]*\)/g, ' ');
  text = text.replace(/\(\s*\)/g, ' ');
  text = text.replace(/[#*`>]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 800) text = text.slice(0, 797).replace(/\s+\S*$/, '') + '...';
  return text;
}

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
