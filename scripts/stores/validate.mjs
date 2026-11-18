// Check committed store files against the fixture for the winget version on disk.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchingFixtures, renderRelease } from './lib.mjs';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

const wingetRoot = 'packaging/winget/manifests/s/Spacesarmat/OMP';
const versions = readdirSync(join(root, wingetRoot)).filter((name) => statSync(join(root, wingetRoot, name)).isDirectory());
const fixtures = readdirSync(join(root, 'tests/fixtures/stores'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(read(`tests/fixtures/stores/${name}`)));
const matches = versions.length === 1 ? matchingFixtures(fixtures, versions[0]) : [];
const files = matches.length === 1
  ? renderRelease({
    release: matches[0],
    changelog: read('CHANGELOG.md'),
    changelogEn: read('CHANGELOG.en.md'),
  })
  : {};
const bad = [];
if (versions.length !== 1) bad.push(`expected one winget version, found ${versions.join(', ') || 'none'}`);
if (matches.length !== 1) bad.push(`expected one fixture for ${versions[0] || 'the winget version'}, found ${matches.length}`);
for (const [path, body] of Object.entries(files)) {
  let onDisk = '';
  try {
    onDisk = read(path);
  } catch {
    bad.push(`missing ${path}`);
    continue;
  }
  if (onDisk !== body) bad.push(`drift ${path}`);
  if (/[\u2010-\u2015\u2212]/.test(body)) bad.push(`dash ${path}`);
}

const locales = ['en-US', 'ru-RU'];
const shots = ['1.png', '2.png', '3.png', '4.png'];
for (const locale of locales) {
  const base = `fastlane/metadata/android/${locale}`;
  const short = read(`${base}/short_description.txt`).trim();
  const full = read(`${base}/full_description.txt`).trim();
  const title = read(`${base}/title.txt`).trim();
  if (!title) bad.push(`${locale} title`);
  if (short.length < 3 || short.length > 80) bad.push(`${locale} short length ${short.length}`);
  if (full.length < 20 || full.length > 4000) bad.push(`${locale} full length ${full.length}`);
  if (/[\u2010-\u2015\u2212]/.test(`${short}\n${full}\n${title}`)) bad.push(`${locale} dash`);
  for (const name of shots) {
    const file = join(root, base, 'images/phoneScreenshots', name);
    if (!statSync(file).size) bad.push(`empty ${file}`);
  }
  const icon = join(root, base, 'images/icon.png');
  const launcher = readFileSync(join(root, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'));
  if (!readFileSync(icon).equals(launcher)) bad.push(`${locale} icon`);
}

const sources = [
  'docs/screenshots/android-library.png',
  'docs/screenshots/android-search.png',
  'docs/screenshots/android-watch.png',
  'docs/screenshots/android-nowplaying.png',
];
sources.forEach((source, index) => {
  const expected = readFileSync(join(root, source));
  for (const locale of locales) {
    const shot = join(root, `fastlane/metadata/android/${locale}/images/phoneScreenshots/${index + 1}.png`);
    if (!readFileSync(shot).equals(expected)) bad.push(`shot ${locale} ${index + 1}`);
  }
});

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(md|json|ya?ml|rb|xml|txt|desktop|mjs)$/.test(name)) acc.push(path);
  }
}
const textFiles = [];
for (const dir of ['docs/stores', 'packaging', 'bucket', 'fastlane', 'scripts/stores']) {
  walk(join(root, dir), textFiles);
}
for (const path of textFiles) {
  const body = readFileSync(path, 'utf8');
  if (/[\u2010-\u2015\u2212]/.test(body)) bad.push(`dash ${path}`);
}

if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('stores ok');
