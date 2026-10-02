import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (!existsSync('dist/index.html')) throw new Error('dist/ not found — run vite build first');
const html = readFileSync('dist/index.html', 'utf8');
if (html.includes('crossorigin')) throw new Error('dist/index.html contains crossorigin — breaks file:// boot');
if (html.includes('type="module"')) throw new Error('dist/index.html contains type="module" — not supported by Chrome 53');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const appinfo = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
writeFileSync('dist/appinfo.json', JSON.stringify({ ...appinfo, version }, null, 2));
for (const f of ['icon.png', 'largeIcon.png']) cpSync(`webos/${f}`, `dist/${f}`);
mkdirSync('build', { recursive: true });
execSync('npx ares-package dist -o build --no-minify', { stdio: 'inherit' });
console.log(`built build/${appinfo.id}_${version}_all.ipk`);
