// Helpers for scripts/player2160-bump.mjs. The pin is player2160.version (0.2.25) plus the gitlink
// android/vendor/2160player. player-core is built from that commit; the coordinate in android/app/build.gradle
// matches the version.
import { insertUnreleased } from './torrserver-lib.mjs';

const PLAYER_LINE = /^- (?:\[phone\] Встроенный плеер 2160 обновлён до|\[atv\] На Android TV плеер 2160 обновлён до|\[tech\] Сабмодуль android\/vendor\/2160player обновлён до|\[phone\] The embedded 2160 Player is updated to|\[atv\] On Android TV the embedded 2160 Player is updated to|\[tech\] The android\/vendor\/2160player submodule is updated to) [^\r\n]*\r?\n/gm;

export function parsePlayerFile(text) {
  const version = String(text).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('player2160.version must be X.Y.Z');
  return version;
}

export function playerTag(version) {
  return 'v' + parsePlayerFile(version);
}

export function comparePlayer(a, b) {
  const pa = parsePlayerFile(a).split('.').map((n) => Number(n));
  const pb = parsePlayerFile(b).split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** Commit SHA from `git ls-remote` output. An annotated tag is peeled (`^{}`). */
export function commitFromLsRemote(text, tag) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const peeled = lines.find((l) => l.endsWith('refs/tags/' + tag + '^{}'));
  const plain = lines.find((l) => l.endsWith('refs/tags/' + tag));
  const line = peeled || plain;
  if (!line) throw new Error('tag not found: ' + tag);
  const sha = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('bad sha for ' + tag);
  return sha;
}

/** Default version in player-core/build.gradle.kts (`getOrElse("0.2.25")`). */
export function playerCoreVersion(text) {
  const m = /getOrElse\("(\d+\.\d+\.\d+)"\)/.exec(String(text));
  if (!m) throw new Error('player-core version not found');
  return m[1];
}

export function patchPlayerGradle(text, version) {
  parsePlayerFile(version);
  if (!/tv\.p2160:player-core:\d+\.\d+\.\d+/.test(text)) throw new Error('player-core coordinate not found');
  return text
    .replace(/tv\.p2160:player-core:\d+\.\d+\.\d+/, 'tv.p2160:player-core:' + version)
    .replace(/\(v\d+\.\d+\.\d+\)/, '(v' + version + ')');
}

function asset(release, tag, name) {
  const found = ((release && release.assets) || []).find((a) => a && a.name === name);
  if (!found) return null;
  const url = 'https://github.com/spacesarmat/2160player/releases/download/' + tag + '/' + name;
  if (found.browser_download_url !== url) throw new Error('url mismatch for ' + name);
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(found.digest || '');
  if (!m) throw new Error(name + ' has no sha256 digest');
  if (!Number.isInteger(found.size) || found.size < 1024 * 1024 || found.size > 80 * 1024 * 1024) {
    throw new Error(name + ' size is unexpected');
  }
  return { name, url, sha256: m[1].toLowerCase(), size: found.size };
}

/**
 * Stable vX.Y.Z newer than [current], with a player-core AAR and at least one phone/TV APK.
 * { ok:false } means skip the release.
 */
export function assessPlayerRelease(release, currentVersion) {
  if (!release || typeof release !== 'object') return { ok: false, reason: 'no release' };
  if (release.draft || release.prerelease) return { ok: false, reason: 'not a stable release' };
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) return { ok: false, reason: 'unexpected tag ' + tag };
  let current;
  try {
    current = parsePlayerFile(currentVersion);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (comparePlayer(m[1], current) <= 0) return { ok: false, reason: tag + ' is not newer than ' + current };
  try {
    const version = m[1];
    const aar = asset(release, tag, 'player-core-' + version + '.aar');
    if (!aar) return { ok: false, reason: 'no player-core aar' };
    const apk = asset(release, tag, '2160player-' + version + '-arm64-v8a-release.apk')
      || asset(release, tag, '2160player-' + version + '-arm-release.apk')
      || asset(release, tag, '2160player-' + version + '-universal-release.apk');
    if (!apk) return { ok: false, reason: 'no player apk' };
    return { ok: true, reason: '', version, aar, apk };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** One short line from the release body. Hyphens only. */
export function playerSummary(body, english) {
  let text = String(body || '');
  text = text.replace(/\u2014/g, '-').replace(/\u2013/g, '-').replace(/\u2011/g, '-');
  const mark = text.search(/\*\*English:\*\*/i);
  if (english) text = mark >= 0 ? text.slice(mark).replace(/\*\*English:\*\*/i, '') : '';
  else if (mark >= 0) text = text.slice(0, mark);
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/\[[^\]]*]\([^)]*\)/g, ' ');
  text = text.replace(/[#*`>]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 180) text = text.slice(0, 177).replace(/\s+\S*$/, '') + '...';
  return text;
}

export function playerNotes(version, sha, summary, english) {
  const short = String(sha).slice(0, 7);
  const tail = summary ? '. ' + summary : '';
  if (english) {
    return [
      `[phone] The embedded 2160 Player is updated to ${version}${tail}`,
      `[atv] On Android TV the embedded 2160 Player is updated to ${version}${tail}`,
      `[tech] The android/vendor/2160player submodule is updated to v${version} (${short}), player-core coordinate ${version}`,
    ];
  }
  return [
    `[phone] Встроенный плеер 2160 обновлён до ${version}${tail}`,
    `[atv] На Android TV плеер 2160 обновлён до ${version}${tail}`,
    `[tech] Сабмодуль android/vendor/2160player обновлён до v${version} (${short}), координата player-core ${version}`,
  ];
}

/** Puts the three player bullets under «Не выпущено» / Unreleased, replacing an older player bump there. Released sections are left as they are. */
export function upsertPlayerNotes(text, notes, english = false) {
  const want = english ? 'Unreleased' : 'Не выпущено';
  const heading = new RegExp('^## ' + want + '[ \\t]*\\r?$', 'im').exec(text);
  let prefix = '';
  let section = '';
  let suffix = text;
  if (heading) {
    const bodyStart = heading.index + heading[0].length + (text[heading.index + heading[0].length] === '\n' ? 1 : 0);
    const next = text.slice(bodyStart).search(/^## /m);
    const bodyEnd = next < 0 ? text.length : bodyStart + next;
    prefix = text.slice(0, bodyStart);
    section = text.slice(bodyStart, bodyEnd);
    suffix = text.slice(bodyEnd);
  }
  section = section.replace(new RegExp(PLAYER_LINE.source, 'gm'), '');
  let out = prefix + section + suffix;
  // insertUnreleased prepends a note that is not the TorrServer line. Insert last-first so phone stays on top.
  for (let i = notes.length - 1; i >= 0; i--) out = insertUnreleased(out, notes[i], english);
  return out;
}
