import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWindowsUpdate, feedNotes } from './hb-lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

const tag = argument('tag');
const version = argument('version');
const msix = argument('msix');
const output = argument('output');
if (!/^[a-z0-9._-]+$/i.test(tag)) throw new Error('unsafe release tag');
if (!/^[0-9]+(\.[0-9]+){1,3}(-beta\.[0-9]+)?$/.test(version)) throw new Error('invalid version');
if (path.extname(msix).toLowerCase() !== '.msix') throw new Error('an .msix package is required');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const { notesPhone } = feedNotes(changelog, version, 'phone');
const update = buildWindowsUpdate({
  tag,
  version,
  msixName: path.basename(msix),
  sha256: createHash('sha256').update(readFileSync(msix)).digest('hex'),
  notes: notesPhone,
});
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(update, null, 2) + '\n');
console.log(output);
