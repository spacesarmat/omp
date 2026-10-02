// CI: node scripts/hb-manifest.mjs <tag> <path-to-ipk> → build/hb/{<id>.manifest.json, apps.json, update.json}
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { APP_ID, buildHomebrew, changelogNotes } from './hb-lib.mjs';

const [tag, ipk] = process.argv.slice(2);
if (!tag || !ipk) throw new Error('usage: node scripts/hb-manifest.mjs <tag> <ipk>');
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

mkdirSync('build/hb', { recursive: true });
writeFileSync(`build/hb/${APP_ID}.manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync('build/hb/apps.json', JSON.stringify(apps, null, 2));
writeFileSync('build/hb/update.json', JSON.stringify(update, null, 2));
console.log(`build/hb ready for ${tag} (sha256 ${sha256})`);
