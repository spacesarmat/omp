// UTF-8 guards for CHANGELOG.md / CHANGELOG.en.md.
// Windows PowerShell and `python -c` with Cyrillic in the command line often write cp1251
// (see v0.20.0-beta.8). Always read/write through these helpers or prepend-changelog.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

const CYR = /[А-Яа-яЁё]/;
/** UTF-8 Cyrillic mis-decoded as Latin-1/cp1252 (Ð/Ñ + trail byte). */
const MOJIBAKE = /(?:Ð.|Ñ.){2,}/;

/**
 * Decode bytes as UTF-8 or throw. Rejects a BOM (Vite/?raw and feeds expect plain UTF-8).
 * @param {Buffer|Uint8Array} buf
 * @param {string} label
 */
export function decodeUtf8Strict(buf, label = 'file') {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    throw new Error(`${label}: UTF-8 BOM is not allowed`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    throw new Error(`${label}: not valid UTF-8 (refusing cp1251/legacy bytes)`);
  }
}

/** @param {string} text @param {string} label */
export function assertChangelogText(text, label) {
  if (text.includes('\uFFFD')) throw new Error(`${label}: contains U+FFFD replacement characters`);
  if (MOJIBAKE.test(text)) throw new Error(`${label}: looks like mojibake (Ð/Ñ sequences)`);
}

/**
 * @param {string} path
 * @param {{ russian?: boolean }} [opts]
 */
export function readChangelogUtf8(path, opts = {}) {
  const text = decodeUtf8Strict(readFileSync(path), path).replace(/\r\n/g, '\n');
  assertChangelogText(text, path);
  if (opts.russian) {
    if (!text.startsWith('# Изменения')) {
      throw new Error(`${path}: must start with "# Изменения"`);
    }
    if (!CYR.test(text)) throw new Error(`${path}: expected Cyrillic`);
    const latest = latestSectionBody(text);
    if (latest && !CYR.test(latest)) {
      throw new Error(`${path}: latest section has no Cyrillic (encoding likely broken)`);
    }
  }
  return text;
}

/** Bullet body of the first `## …` section, or ''. */
export function latestSectionBody(md) {
  const m = /^## [^\n]+\n+([\s\S]*?)(?=\n## |\s*$)/m.exec(md);
  return m ? m[1] : '';
}

/**
 * Prepend a version section after the title block.
 * @param {string} md
 * @param {string} version
 * @param {string[]} bullets lines without a required leading "- "
 */
export function prependChangelogSection(md, version, bullets) {
  const eol = '\n';
  const normalized = md.replace(/\r\n/g, '\n');
  if (normalized.includes(`## ${version}${eol}`) || normalized.includes(`## ${version}\n`)) {
    throw new Error(`version ${version} already present`);
  }
  const lines = bullets
    .map((b) => String(b).replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
    .map((b) => `- ${b}`);
  if (!lines.length) throw new Error('no bullets');
  const entry = `## ${version}${eol}${eol}${lines.join(eol)}${eol}${eol}`;
  const idx = normalized.search(/^## /m);
  if (idx < 0) return normalized.replace(/\s*$/, '') + eol + eol + entry;
  return normalized.slice(0, idx) + entry + normalized.slice(idx);
}

/** Write UTF-8 without BOM, LF endings. */
export function writeUtf8Lf(path, text) {
  const out = String(text).replace(/\r\n/g, '\n');
  assertChangelogText(out, path);
  writeFileSync(path, out, { encoding: 'utf8' });
}
