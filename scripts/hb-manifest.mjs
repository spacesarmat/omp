// CI: node scripts/hb-manifest.mjs <tag> <path-to-ipk> [apk...] → build/hb/{<id>.manifest.json, apps.json, update.json, full_description.html, update-android.json (with apks)}
// apks: the universal OMP-x.y.z.apk (required for the Android feed) plus per-ABI OMP-x.y.z-arm64.apk / -armv7.apk
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { APP_ID, buildAndroidUpdate, buildHomebrew, changelogNotes, splitApks } from './hb-lib.mjs';

const [tag, ipk, ...apkPaths] = process.argv.slice(2);
if (!tag || !ipk) throw new Error('usage: node scripts/hb-manifest.mjs <tag> <ipk> [apk...]');
const apkSet = splitApks(apkPaths);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (tag !== `v${version}`) throw new Error(`tag ${tag} does not match package.json version ${version}`);

const buf = readFileSync(ipk);
const sha256 = createHash('sha256').update(buf).digest('hex');
const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
if (!notes.length) throw new Error(`CHANGELOG.md has no notes for ${version}`);

const { manifest, apps, update } = buildHomebrew({
  tag,
  version,
  ipkName: basename(ipk),
  sha256,
  size: buf.length,
  title: 'OMP',
  description: 'Open Movie Player — media player for your own TorrServer',
  notes,
});

const fullDescription = 'docs/homebrew/full_description.html';
if (!existsSync(fullDescription)) throw new Error(`${fullDescription} is missing`);

mkdirSync('build/hb', { recursive: true });
copyFileSync(fullDescription, 'build/hb/full_description.html');
writeFileSync(`build/hb/${APP_ID}.manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync('build/hb/apps.json', JSON.stringify(apps, null, 2));
writeFileSync('build/hb/update.json', JSON.stringify(update, null, 2));
if (apkSet) {
  const apk = apkSet.universal;
  const apkBuf = readFileSync(apk);
  const abis = {};
  for (const [key, p] of Object.entries(apkSet.abis)) {
    const b = readFileSync(p);
    abis[key] = { name: basename(p), sha256: createHash('sha256').update(b).digest('hex'), size: b.length };
  }
  const androidUpdate = buildAndroidUpdate({
    tag,
    version,
    apkName: basename(apk),
    sha256: createHash('sha256').update(apkBuf).digest('hex'),
    size: apkBuf.length,
    notes,
    abis,
  });
  writeFileSync('build/hb/update-android.json', JSON.stringify(androidUpdate, null, 2));
}
console.log(`build/hb ready for ${tag} (sha256 ${sha256})`);
