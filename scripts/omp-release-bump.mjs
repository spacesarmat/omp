// Bump OMP to the next beta and move «Не выпущено» / Unreleased under that version.
// Refreshes SECURITY.md for this beta. Prints the new version. Does not tag or push.
import { readChangelogUtf8, writeUtf8Lf } from './changelog-encoding.mjs';
import { readFileSync } from 'node:fs';
import { nextBeta, promoteUnreleased } from './omp-version.mjs';
import { rewriteReleaseVersionFiles } from './release-version-files.mjs';
import { syncSecurityPolicy } from './security-versions.mjs';

const from = JSON.parse(readFileSync('package.json', 'utf8')).version;
const to = nextBeta(from);
rewriteReleaseVersionFiles(from, to);

writeUtf8Lf('CHANGELOG.md', promoteUnreleased(readChangelogUtf8('CHANGELOG.md', { russian: true }), to, false));
writeUtf8Lf('CHANGELOG.en.md', promoteUnreleased(readChangelogUtf8('CHANGELOG.en.md'), to, true));
syncSecurityPolicy();
console.log(to);
