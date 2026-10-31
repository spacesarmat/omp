// Usage: node scripts/torrserver-bump.mjs <TorrServer tag> [release.json]
// Records the tag and the pinned download (res/raw/torrserver.json: url, sha256, size of the arm64 asset) and puts
// a changelog line under «Не выпущено» / «Unreleased»; prints the tag. The OMP version is not touched: the update
// ships with the next release Andy cuts. Without release.json (the GitHub API answer for the tag) the release is
// fetched; GITHUB_TOKEN is used when set.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseVersionFile, insertUnreleased, torrserverNote, pinFromRelease, formatPin, PIN_PATH } from './torrserver-lib.mjs';
import { readChangelogUtf8, writeUtf8Lf } from './changelog-encoding.mjs';

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
writeFileSync('torrserver.version', tag + '\n');
writeFileSync(PIN_PATH, pin);
writeUtf8Lf('CHANGELOG.md', insertUnreleased(readChangelogUtf8('CHANGELOG.md', { russian: true }), torrserverNote(tag)));
writeUtf8Lf('CHANGELOG.en.md', insertUnreleased(readChangelogUtf8('CHANGELOG.en.md'), torrserverNote(tag, true), true));
console.log(tag);
