// Downloads the TorrServer arm64 binary for the tag in torrserver.version into jniLibs (gitignored).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersionFile, pickAsset, parseDigest } from './torrserver-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'android/app/src/main/jniLibs/arm64-v8a/libtorrserver.so');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const tag = parseVersionFile(readFileSync(join(root, 'torrserver.version'), 'utf8'));
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'omp-build' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(`https://api.github.com/repos/YouROK/TorrServer/releases/tags/${tag}`, { headers });
if (!res.ok) throw new Error(`GitHub API ${res.status} for tag ${tag}`);
const asset = pickAsset(await res.json());
const want = parseDigest(asset.digest);

if (existsSync(target) && sha256(readFileSync(target)) === want) {
  console.log(`libtorrserver.so up to date (${tag})`);
  process.exit(0);
}
const dl = await fetch(asset.browser_download_url, { redirect: 'follow', headers: { 'User-Agent': 'omp-build' } });
if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
const buf = Buffer.from(await dl.arrayBuffer());
const got = sha256(buf);
if (got !== want) throw new Error(`SHA-256 mismatch / контрольная сумма не совпала: expected ${want}, got ${got}`);
mkdirSync(dirname(target), { recursive: true });
const tmp = `${target}.tmp`;
try {
  writeFileSync(tmp, buf);
  renameSync(tmp, target);
} finally {
  rmSync(tmp, { force: true });
}
console.log(`libtorrserver.so ${tag} (${buf.length} bytes) sha256 ok`);
