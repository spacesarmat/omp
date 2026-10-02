import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const { id } = JSON.parse(readFileSync('webos/appinfo.json', 'utf8'));
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const device = process.env.WEBOS_DEVICE || 'tv';
const cmd = process.argv[2];
if (cmd === 'install') execSync(`npx ares-install --device ${device} build/${id}_${version}_all.ipk`, { stdio: 'inherit' });
else if (cmd === 'launch') execSync(`npx ares-launch --device ${device} ${id}`, { stdio: 'inherit' });
else throw new Error('usage: node scripts/tv.mjs install|launch');
