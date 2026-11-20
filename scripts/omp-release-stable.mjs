// Promote the current beta to its stable version (0.30.2-beta.3 -> 0.30.2)
// and refresh SECURITY.md. An already stable tree only refreshes SECURITY.md.
// Prints the version. Does not tag or push.
import { readFileSync } from 'node:fs';
import { readChangelogUtf8, writeUtf8Lf } from './changelog-encoding.mjs';
import { renameReleaseHeading, stableVersion } from './omp-version.mjs';
import { rewriteReleaseVersionFiles } from './release-version-files.mjs';
import { syncSecurityPolicy } from './security-versions.mjs';

const from = JSON.parse(readFileSync('package.json', 'utf8')).version;
const to = stableVersion(from);
rewriteReleaseVersionFiles(from, to);
if (from !== to) {
  writeUtf8Lf('CHANGELOG.md', renameReleaseHeading(readChangelogUtf8('CHANGELOG.md', { russian: true }), from, to));
  writeUtf8Lf('CHANGELOG.en.md', renameReleaseHeading(readChangelogUtf8('CHANGELOG.en.md'), from, to));
}
syncSecurityPolicy();
console.log(to);
