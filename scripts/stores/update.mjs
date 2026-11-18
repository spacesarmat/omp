// Rewrite in-repo store manifests for one stable release and open a PR. Never force-pushes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { planRelease, parseReleaseTag, releaseFixture } from './lib.mjs';

function out(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

const tag = process.env.TAG || '';
const parsed = parseReleaseTag(tag);
out('tag', parsed.tag);
out('version', parsed.version);
if (!parsed.stable) {
  console.log(`::notice::${tag || '(empty)'} is not a stable release. Store update skipped.`);
  out('desktop', 'false');
  process.exit(0);
}

run('git', ['fetch', 'origin', `refs/tags/${parsed.tag}:refs/tags/${parsed.tag}`]);
const raw = JSON.parse(run('gh', ['release', 'view', parsed.tag, '--json', 'tagName,isPrerelease,publishedAt,assets']));
const release = {
  tag: raw.tagName,
  prerelease: raw.isPrerelease,
  publishedAt: raw.publishedAt,
  assets: raw.assets,
};
let changelog = '';
let changelogEn = '';
try {
  changelog = run('git', ['show', `${parsed.tag}:CHANGELOG.md`]);
} catch {
  changelog = '';
}
try {
  changelogEn = run('git', ['show', `${parsed.tag}:CHANGELOG.en.md`]);
} catch {
  changelogEn = '';
}
const plan = planRelease(release, { changelog, changelogEn });
if (plan.skip) {
  console.log(`::notice::${plan.skip}`);
  out('desktop', 'false');
  process.exit(0);
}

const branch = `stores/${parsed.tag}`;
let hasBranch = false;
try {
  run('git', ['fetch', 'origin', branch]);
  run('git', ['rev-parse', '--verify', `origin/${branch}`]);
  hasBranch = true;
} catch {
  hasBranch = false;
}
if (hasBranch) run('git', ['checkout', '-B', branch, `origin/${branch}`], { stdio: 'inherit' });
else run('git', ['checkout', '-B', branch, 'origin/main'], { stdio: 'inherit' });

for (const [path, body] of Object.entries(plan.files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
const fixtureDir = 'tests/fixtures/stores';
const fixturePath = `${fixtureDir}/${plan.version}.json`;
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(fixturePath, `${JSON.stringify(releaseFixture(release, plan.version), null, 2)}\n`);
if (existsSync(fixtureDir)) {
  for (const name of readdirSync(fixtureDir)) {
    if (!name.endsWith('.json') || name === `${plan.version}.json`) continue;
    let otherTag = '';
    try {
      otherTag = JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')).tag || '';
    } catch {
      otherTag = '';
    }
    if (parseReleaseTag(otherTag).version === plan.version) rmSync(join(fixtureDir, name));
  }
}
const wingetRoot = 'packaging/winget/manifests/s/Spacesarmat/OMP';
if (existsSync(wingetRoot)) {
  for (const name of readdirSync(wingetRoot)) {
    if (name !== plan.version) rmSync(join(wingetRoot, name), { recursive: true, force: true });
  }
}

run('git', ['add', '-A', '--', 'packaging', 'bucket', 'tests/fixtures/stores', 'fastlane/metadata/android/en-US/changelogs', 'fastlane/metadata/android/ru-RU/changelogs']);
const dirty = run('git', ['status', '--porcelain']).trim();
if (!dirty) {
  console.log(`::notice::Store manifests for ${parsed.tag} are already current.`);
} else {
  run('git', [
    '-c', 'user.name=github-actions[bot]',
    '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', `Update store manifests for ${parsed.tag}`,
  ], { stdio: 'inherit' });
  run('git', ['push', 'origin', `HEAD:${branch}`], { stdio: 'inherit' });
}
if (dirty || hasBranch) {
  const bodyPath = join(tmpdir(), `stores-${parsed.tag}.md`);
  writeFileSync(bodyPath, [
    '## Манифесты магазинов',
    '',
    `Стабильный релиз \`${parsed.tag}\`.`,
    '',
    '- winget, Scoop, Homebrew, Flatpak и Snap переписаны из ассетов релиза',
    '- fastlane changelog для IzzyOnDroid',
    '',
    'Внешние репозитории этот PR не пушит. Winget и Snap запускаются соседними job, если секреты заданы.',
    '',
  ].join('\n'));
  let existing = '';
  try {
    existing = run('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url']).trim();
  } catch {
    existing = '';
  }
  if (existing) console.log(existing);
  else {
    run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `chore(stores): манифесты ${parsed.tag}`, '--body-file', bodyPath], { stdio: 'inherit' });
  }
}
out('desktop', 'true');
