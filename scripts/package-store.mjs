// Package the LG Content Store variant (dist-store) into an ipk. Same webOS constraints as package.mjs, but the
// store app is a separate product: its own app id and the clean (non-beta) icons regardless of the version suffix.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('dist-store/index.html')) throw new Error('dist-store/ not found - run npm run build:store first');
const html = readFileSync('dist-store/index.html', 'utf8');
if (html.includes('crossorigin')) throw new Error('dist-store/index.html contains crossorigin - breaks file:// boot');
if (html.includes('type="module"')) throw new Error('dist-store/index.html contains type="module" - not supported by Chrome 53');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const appinfo = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
// Keep the existing OMP app id: the phone launches/detects com.spacesarmat.torrplayer and attaches its player
// controls by that id, so the store build must reuse it (a new id would be invisible to the phone/remote).
const storeInfo = { ...appinfo, version: version.split('-')[0] };
writeFileSync('dist-store/appinfo.json', JSON.stringify(storeInfo, null, 2));
for (const f of ['icon.png', 'largeIcon.png']) cpSync(`webos/${f}`, `dist-store/${f}`);
mkdirSync('build', { recursive: true });
execSync('npx ares-package dist-store -o build --no-minify', { stdio: 'inherit' });
console.log(`built build/${storeInfo.id}_${version.split('-')[0]}_all.ipk`);