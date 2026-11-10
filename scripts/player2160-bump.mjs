// Usage: node scripts/player2160-bump.mjs <vX.Y.Z> [release.json]
// Moves android/vendor/2160player to that tag, writes player2160.version and the player-core coordinate,
// and adds changelog lines under «Не выпущено». Exit 2: the release is not a sane newer stable tag (no files written).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readChangelogUtf8, writeUtf8Lf } from './changelog-encoding.mjs';
import {
  assessPlayerRelease,
  commitFromLsRemote,
  patchPlayerGradle,
  playerCoreVersion,
  playerNotes,
  playerSummary,
  upsertPlayerNotes,
} from './player2160-lib.mjs';

const tag = process.argv[2] || '';
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Usage: node scripts/player2160-bump.mjs vX.Y.Z [release.json]');
  process.exit(1);
}

const read = (f) => readFileSync(f, 'utf8');

async function release() {
  if (process.argv[3]) return JSON.parse(read(process.argv[3]));
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'omp-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/spacesarmat/2160player/releases/tags/${tag}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for tag ${tag}`);
  return res.json();
}

async function textAt(url) {
  const headers = { 'User-Agent': 'omp-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res.text();
}

const body = await release();
const verdict = assessPlayerRelease(body, read('player2160.version'));
if (!verdict.ok) {
  console.error(verdict.reason);
  process.exit(2);
}
const coreText = await textAt(`https://raw.githubusercontent.com/spacesarmat/2160player/${tag}/player-core/build.gradle.kts`);
const core = playerCoreVersion(coreText);
if (core !== verdict.version) throw new Error(`player-core is ${core}, tag says ${verdict.version}`);

const remote = execFileSync(
  'git',
  ['ls-remote', 'https://github.com/spacesarmat/2160player.git', 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}'],
  { encoding: 'utf8' },
);
const sha = commitFromLsRemote(remote, tag);
execFileSync('git', ['update-index', '--cacheinfo', `160000,${sha},android/vendor/2160player`]);

writeFileSync('player2160.version', verdict.version + '\n');
writeFileSync('android/app/build.gradle', patchPlayerGradle(read('android/app/build.gradle'), verdict.version));
const ru = playerNotes(verdict.version, sha, playerSummary(body.body || '', false), false);
const en = playerNotes(verdict.version, sha, playerSummary(body.body || '', true), true);
writeUtf8Lf('CHANGELOG.md', upsertPlayerNotes(readChangelogUtf8('CHANGELOG.md', { russian: true }), ru, false));
writeUtf8Lf('CHANGELOG.en.md', upsertPlayerNotes(readChangelogUtf8('CHANGELOG.en.md'), en, true));
console.log(tag + ' ' + sha);
