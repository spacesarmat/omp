// Usage: node scripts/torrserver-bump.mjs <TorrServer tag>
// Records the tag, bumps the OMP patch version everywhere, adds a changelog entry; prints the new version.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseVersionFile, bumpPatch, insertChangelog, setRootVersion } from './torrserver-lib.mjs';

const tag = parseVersionFile(process.argv[2] || '');
const read = (f) => readFileSync(f, 'utf8');
const current = JSON.parse(read('package.json')).version;
const next = bumpPatch(current);

writeFileSync('torrserver.version', tag + '\n');
writeFileSync('package.json', setRootVersion(read('package.json'), next));
writeFileSync('package-lock.json', setRootVersion(read('package-lock.json'), next, true));
writeFileSync('webos/appinfo.json', setRootVersion(read('webos/appinfo.json'), next));
writeFileSync('CHANGELOG.md', insertChangelog(read('CHANGELOG.md'), next, tag));
console.log(next);
