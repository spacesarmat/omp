// CI: node scripts/release-notes.mjs <tag> [build dir] → the GitHub release body (scripts/release-notes-lib.mjs).
// Checksums are taken from the build files that exist, so a dry run without a build prints the body without them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogNotes } from './hb-lib.mjs';
import { readChangelogUtf8 } from './changelog-encoding.mjs';
import { buildFiles } from './telegram-lib.mjs';
import { buildReleaseNotes, previousVersion } from './release-notes-lib.mjs';

export function renderReleaseNotes(tag, dir = 'build', root = '.') {
  const version = tag.replace(/^v/, '');
  const ruMd = readChangelogUtf8(join(root, 'CHANGELOG.md'), { russian: true });
  const enPath = join(root, 'CHANGELOG.en.md');
  const enMd = existsSync(enPath) ? readChangelogUtf8(enPath) : '';
  const prev = previousVersion(ruMd, version);
  // ipk first, then the APKs: the order people look for them in
  const [arm64, armv7, ipk, universal] = buildFiles(version);
  const sha256 = [ipk, arm64, armv7, universal]
    .filter((name) => existsSync(join(dir, name)))
    .map((name) => ({ name, sha: createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') }));
  // changelogNotes skips «[tech]» bullets, so the body and its «…и ещё N» count only user-facing ones
  return buildReleaseNotes({
    tag,
    version,
    ru: changelogNotes(ruMd, version),
    en: changelogNotes(enMd, version),
    prevTag: prev ? `v${prev}` : null,
    sha256,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, dir = 'build'] = process.argv.slice(2);
  if (!tag) throw new Error('usage: node scripts/release-notes.mjs <tag> [build dir]');
  process.stdout.write(renderReleaseNotes(tag, dir));
}
