// Usage: node scripts/torrserver-bump.mjs <TorrServer tag> [release.json]
// Records the tag and the pinned download (res/raw/torrserver.json: url, sha256, size of the arm64 asset), bumps the
// OMP patch version everywhere, adds a changelog entry; prints the new version. Without release.json (the GitHub API
// answer for the tag) the release is fetched; GITHUB_TOKEN is used when set.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseVersionFile, bumpPatch, insertChangelog, setRootVersion, pinFromRelease, formatPin, PIN_PATH } from './torrserver-lib.mjs';

const tag = parseVersionFile(process.argv[2] || '');
const read = (f) => readFileSync(f, 'utf8');

async function release() {
  if (process.argv[3]) return JSON.parse(read(process.argv[3]));
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'omp-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/YouROK/TorrServer/releases/tags/${tag}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for tag ${tag}`);
  return res.json();
}

// the pin first: nothing is written when the release has no usable asset
const pin = formatPin(pinFromRelease(await release(), tag));
const current = JSON.parse(read('package.json')).version;
const next = bumpPatch(current);

writeFileSync('torrserver.version', tag + '\n');
writeFileSync(PIN_PATH, pin);
writeFileSync('package.json', setRootVersion(read('package.json'), next));
writeFileSync('package-lock.json', setRootVersion(read('package-lock.json'), next, true));
writeFileSync('webos/appinfo.json', setRootVersion(read('webos/appinfo.json'), next));
writeFileSync('CHANGELOG.md', insertChangelog(read('CHANGELOG.md'), next, tag));
console.log(next);
