#!/usr/bin/env node
// Prepend a version section to CHANGELOG.md / CHANGELOG.en.md as UTF-8 (LF, no BOM).
// Bullets must come from UTF-8 files — never from a PowerShell here-string with Cyrillic.
//
//   node scripts/prepend-changelog.mjs 0.20.0-beta.13 --ru path/to/ru.txt --en path/to/en.txt
//
// Each file: one bullet per line, with or without a leading "- ".
import { readFileSync } from 'node:fs';
import {
  assertChangelogText,
  decodeUtf8Strict,
  prependChangelogSection,
  readChangelogUtf8,
  writeUtf8Lf,
} from './changelog-encoding.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return process.argv[i + 1];
}

function bulletsFromFile(path) {
  const text = decodeUtf8Strict(readFileSync(path), path).replace(/\r\n/g, '\n');
  assertChangelogText(text, path);
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const version = process.argv[2];
if (!version || version.startsWith('-')) {
  throw new Error('usage: node scripts/prepend-changelog.mjs <version> --ru <file> --en <file>');
}
const ruFile = arg('--ru');
const enFile = arg('--en');

const ruBullets = bulletsFromFile(ruFile);
const enBullets = bulletsFromFile(enFile);

let ru = readChangelogUtf8('CHANGELOG.md', { russian: true });
let en = readChangelogUtf8('CHANGELOG.en.md');
ru = prependChangelogSection(ru, version, ruBullets);
en = prependChangelogSection(en, version, enBullets);
writeUtf8Lf('CHANGELOG.md', ru);
writeUtf8Lf('CHANGELOG.en.md', en);
readChangelogUtf8('CHANGELOG.md', { russian: true });
readChangelogUtf8('CHANGELOG.en.md');
console.log(`prepended ${version} (${ruBullets.length} ru / ${enBullets.length} en)`);
