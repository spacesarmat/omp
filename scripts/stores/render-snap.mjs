// Rewrite packaging/snap/snapcraft.yaml from the release named by TAG.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { planRelease, parseReleaseTag } from './lib.mjs';

const tag = process.env.TAG || '';
const parsed = parseReleaseTag(tag);
if (!parsed.stable) {
  console.log(`::notice::${tag || '(empty)'} is not a stable release. Snap render skipped.`);
  process.exit(0);
}
const raw = JSON.parse(execFileSync('gh', ['release', 'view', parsed.tag, '--json', 'tagName,isPrerelease,publishedAt,assets'], { encoding: 'utf8' }));
const plan = planRelease({
  tag: raw.tagName,
  prerelease: raw.isPrerelease,
  publishedAt: raw.publishedAt,
  assets: raw.assets,
});
if (plan.skip) {
  console.log(`::notice::${plan.skip}`);
  process.exit(0);
}
const path = 'packaging/snap/snapcraft.yaml';
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, plan.files[path]);
console.log(`wrote ${path}`);
