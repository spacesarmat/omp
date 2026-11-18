// Package the LG Content Store variant (dist-store) into an ipk. Same webOS constraints as package.mjs.
// The store app keeps com.spacesarmat.torrplayer (the phone finds the TV by that id) and the clean icons.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { storeAppInfo } from './store-appinfo.mjs';
import { flattenToOpaquePng, transparentPixels, ICON_BG } from './png-opaque.mjs';
import { scanStoreBundle } from './store-bundle-check.mjs';

if (!existsSync('dist-store/index.html')) throw new Error('dist-store/ not found - run npm run build:store first');
const html = readFileSync('dist-store/index.html', 'utf8');
if (html.includes('crossorigin')) throw new Error('dist-store/index.html contains crossorigin - breaks file:// boot');
if (html.includes('type="module"')) throw new Error('dist-store/index.html contains type="module" - not supported by Chrome 53');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const appinfo = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
// Keep the existing OMP app id: the phone launches/detects com.spacesarmat.torrplayer and attaches its player
// controls by that id, so the store build must reuse it (a new id would be invisible to the phone/remote).
const storeInfo = storeAppInfo(appinfo, version);
writeFileSync('dist-store/appinfo.json', JSON.stringify(storeInfo, null, 2));
const iconSize = { 'icon.png': 80, 'largeIcon.png': 130 };
for (const f of Object.keys(iconSize)) {
  const flat = flattenToOpaquePng(readFileSync(`webos/${f}`), ICON_BG);
  if (flat.width !== iconSize[f] || flat.height !== iconSize[f]) {
    throw new Error(`${f} is ${flat.width}x${flat.height}, expected ${iconSize[f]}x${iconSize[f]}`);
  }
  writeFileSync(`dist-store/${f}`, flat.png);
  const check = transparentPixels(readFileSync(`dist-store/${f}`));
  if (check.transparent !== 0) throw new Error(`${f} still has ${check.transparent} transparent pixels`);
}
const js = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) js.push(readFileSync(p, 'utf8'));
  }
};
walk('dist-store');
const bundle = scanStoreBundle(js.join('\n'));
if (bundle.banned.length || bundle.missing.length) {
  throw new Error('store bundle luna check failed: banned ' + bundle.banned.join(', ') + '; missing ' + bundle.missing.join(', '));
}
mkdirSync('build', { recursive: true });
const packed = spawnSync('npx', ['ares-package', 'dist-store', '-o', 'build', '--no-minify'], { encoding: 'utf8' });
process.stdout.write(packed.stdout || '');
process.stderr.write(packed.stderr || '');
const log = (packed.stdout || '') + (packed.stderr || '');
if (packed.status !== 0) throw new Error('ares-package failed');
if (log.includes("The 'requiredACG' field is not defined")) throw new Error('ares-package warned that requiredACG is missing');
console.log(`built build/${storeInfo.id}_${version.split('-')[0]}_all.ipk`);