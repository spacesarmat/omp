import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLinuxUpdate, buildMacosUpdate, buildWindowsUpdate, feedNotes } from './hb-lib.mjs';

function argument(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) {
    if (required) throw new Error(`--${name} is required`);
    return '';
  }
  return process.argv[index + 1];
}

function fileAsset(file, suffix) {
  if (!file) return null;
  const name = path.basename(file);
  if (!name.toLowerCase().endsWith(suffix.toLowerCase())) throw new Error(`${name} must end with ${suffix}`);
  const bytes = readFileSync(file);
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: statSync(file).size,
  };
}

const kind = argument('kind');
const tag = argument('tag');
const version = argument('version');
const output = argument('output');
if (!/^[a-z0-9._-]+$/i.test(tag)) throw new Error('unsafe release tag');
if (!/^[0-9]+(\.[0-9]+){1,3}(-beta\.[0-9]+)?$/.test(version)) throw new Error('invalid version');
if (!['windows', 'macos', 'linux'].includes(kind)) throw new Error('kind must be windows, macos or linux');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const { notesPhone } = feedNotes(changelog, version, 'phone');

let update;
if (kind === 'windows') {
  const nsis = fileAsset(argument('nsis'), '.exe');
  const portable = fileAsset(argument('portable', false), '.exe');
  update = buildWindowsUpdate({
    tag,
    version,
    nsisName: nsis.name,
    sha256: nsis.sha256,
    size: nsis.size,
    notes: notesPhone,
    portable,
  });
} else if (kind === 'macos') {
  const arm64 = fileAsset(argument('arm64', false), '.dmg');
  const x64 = fileAsset(argument('x64', false), '.dmg');
  if (!arm64 && !x64) throw new Error('a macOS .dmg is required');
  update = buildMacosUpdate({ tag, version, notes: notesPhone, arm64, x64 });
} else {
  const appimage = fileAsset(argument('appimage'), '.AppImage');
  const deb = fileAsset(argument('deb', false), '.deb');
  update = buildLinuxUpdate({ tag, version, notes: notesPhone, appimage, deb });
}

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(update, null, 2) + '\n');
console.log(output);
