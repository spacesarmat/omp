import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { flattenToOpaquePng, transparentPixels, ICON_BG } from './png-opaque.mjs';

if (!existsSync('dist/index.html')) throw new Error('dist/ not found - run vite build first');
const html = readFileSync('dist/index.html', 'utf8');
if (html.includes('crossorigin')) throw new Error('dist/index.html contains crossorigin - breaks file:// boot');
if (html.includes('type="module"')) throw new Error('dist/index.html contains type="module" - not supported by Chrome 53');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const appinfo = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
// webOS takes x.y.z only: a beta (0.16.0-beta.1) is packaged as 0.16.0; the app shows the full version (src/version.ts)
writeFileSync('dist/appinfo.json', JSON.stringify({ ...appinfo, version: version.split('-')[0] }, null, 2));
// a beta gets the icons with the BETA band
const icons = version.includes('-') ? 'webos/beta' : 'webos';
// LG paints its own light card behind transparent pixels, so the launch frame flashes white: the tile goes flat on
// the brand color, exactly as package-store.mjs does for the store build.
const iconSize = { 'icon.png': 80, 'largeIcon.png': 130 };
for (const f of Object.keys(iconSize)) {
  const flat = flattenToOpaquePng(readFileSync(`${icons}/${f}`), ICON_BG);
  if (flat.width !== iconSize[f] || flat.height !== iconSize[f]) {
    throw new Error(`${icons}/${f} is ${flat.width}x${flat.height}, expected ${iconSize[f]}x${iconSize[f]}`);
  }
  writeFileSync(`dist/${f}`, flat.png);
  const check = transparentPixels(readFileSync(`dist/${f}`));
  if (check.transparent !== 0) throw new Error(`${f} still has ${check.transparent} transparent pixels`);
}
mkdirSync('build', { recursive: true });
execSync('npx ares-package dist -o build --no-minify', { stdio: 'inherit' });
console.log(`built build/${appinfo.id}_${version.split('-')[0]}_all.ipk`);
