// Next OMP beta and moving «Не выпущено» under that version.
// 0.30.1-beta.5 -> 0.30.1-beta.6. A stable version starts the next patch beta: 0.30.1 -> 0.30.2-beta.1.

/** Stable x.y.z of a beta, or the same string when it is already stable. */
export function stableVersion(version) {
  const raw = String(version).trim();
  const beta = /^(\d+\.\d+\.\d+)-beta\.\d+$/.exec(raw);
  if (beta) return beta[1];
  if (/^\d+\.\d+\.\d+$/.test(raw)) return raw;
  throw new Error(`Bad version: ${version}`);
}

/**
 * Renames a released heading ## <from> to ## <to>.
 * Same version is left untouched. Refuses a second heading with <to>.
 */
export function renameReleaseHeading(text, from, to) {
  if (from === to) return text;
  const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromRe = new RegExp(`^## ${esc(from)}[ \\t]*\\r?$`, 'm');
  if (!fromRe.test(text)) throw new Error(`no heading ${from}`);
  if (new RegExp(`^## ${esc(to)}[ \\t]*\\r?$`, 'm').test(text)) throw new Error(`version ${to} already present`);
  return text.replace(fromRe, `## ${to}`);
}

export function nextBeta(version) {
  const raw = String(version).trim();
  const beta = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(raw);
  if (beta) return `${beta[1]}.${beta[2]}.${beta[3]}-beta.${Number(beta[4]) + 1}`;
  const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (!stable) throw new Error(`Bad version: ${version}`);
  return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}-beta.1`;
}

/** x.y.z of a version, dropping a beta suffix. webOS packages only that. */
export function webosVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) throw new Error(`Bad version: ${version}`);
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * Renames the unreleased heading to ## <version>, keeping its bullets.
 * english selects «Unreleased», otherwise «Не выпущено».
 */
export function promoteUnreleased(text, version, english = false) {
  const heading = english ? 'Unreleased' : 'Не выпущено';
  const re = new RegExp(`^## ${heading}[ \\t]*\\r?$`, 'im');
  if (!re.test(text)) throw new Error(`no ${heading} section`);
  const ver = String(version).trim();
  if (new RegExp(`^## ${ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\r?$`, 'm').test(text)) {
    throw new Error(`version ${ver} already present`);
  }
  return text.replace(re, `## ${ver}`);
}

/** Replace exactly `expected` occurrences of `needle`. */
export function replaceCounted(text, needle, replacement, expected) {
  const count = text.split(needle).length - 1;
  if (count !== expected) throw new Error(`expected ${expected} of ${needle}, found ${count}`);
  return text.split(needle).join(replacement);
}

/** Replace exactly `expected` occurrences of `"version": "<from>"`. */
export function replaceVersionFields(text, from, to, expected) {
  return replaceCounted(text, `"version": "${from}"`, `"version": "${to}"`, expected);
}

/** Cargo.toml / Cargo.lock use `version = "<from>"`. */
export function replaceCargoVersion(text, from, to, expected) {
  return replaceCounted(text, `version = "${from}"`, `version = "${to}"`, expected);
}
