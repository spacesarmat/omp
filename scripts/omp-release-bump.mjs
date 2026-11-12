// Bump OMP to the next beta and move «Не выпущено» / Unreleased under that version.
// Prints the new version. Does not tag or push.
import { readFileSync, writeFileSync } from 'node:fs';
import { readChangelogUtf8, writeUtf8Lf } from './changelog-encoding.mjs';
import { nextBeta, promoteUnreleased, replaceVersionFields, webosVersion } from './omp-version.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const from = pkg.version;
const to = nextBeta(from);

function rewrite(path, expected) {
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, replaceVersionFields(text, from, to, expected));
}

pkg.version = to;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
rewrite('package-lock.json', 2);
rewrite('desktop/package.json', 1);
rewrite('desktop/package-lock.json', 2);
rewrite('desktop/src-tauri/tauri.conf.json', 1);

const appinfoPath = 'webos/appinfo.json';
const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf8'));
const web = webosVersion(to);
if (appinfo.version !== web) {
  const raw = readFileSync(appinfoPath, 'utf8');
  writeFileSync(appinfoPath, replaceVersionFields(raw, appinfo.version, web, 1));
}

writeUtf8Lf('CHANGELOG.md', promoteUnreleased(readChangelogUtf8('CHANGELOG.md', { russian: true }), to, false));
writeUtf8Lf('CHANGELOG.en.md', promoteUnreleased(readChangelogUtf8('CHANGELOG.en.md'), to, true));
console.log(to);
