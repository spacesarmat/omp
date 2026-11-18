// Copy one channel's rendered files into an external repo and open a PR.
// The token stays in the environment. The remote URL is only owner/name.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planRelease, parseReleaseTag, FLATPAK_ID } from './lib.mjs';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

const channel = process.argv[2] || '';
const tag = process.env.TAG || '';
const repo = process.env.CHANNEL_REPO || '';
const token = process.env.CHANNEL_TOKEN || '';
const parsed = parseReleaseTag(tag);
if (!parsed.stable) {
  console.log(`::notice::${tag || '(empty)'} is not a stable release. External push skipped.`);
  process.exit(0);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.log('::notice::CHANNEL_REPO is not owner/name. External push skipped.');
  process.exit(0);
}
if (!token) {
  console.log('::notice::CHANNEL_TOKEN is not set. External push skipped.');
  process.exit(0);
}

const env = { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };
const raw = JSON.parse(run('gh', ['release', 'view', parsed.tag, '--repo', process.env.GITHUB_REPOSITORY || 'spacesarmat/omp', '--json', 'tagName,isPrerelease,publishedAt,assets'], { env }));
const release = { tag: raw.tagName, prerelease: raw.isPrerelease, publishedAt: raw.publishedAt, assets: raw.assets };
let changelog = '';
let changelogEn = '';
try { changelog = run('git', ['show', `${parsed.tag}:CHANGELOG.md`]); } catch { changelog = ''; }
try { changelogEn = run('git', ['show', `${parsed.tag}:CHANGELOG.en.md`]); } catch { changelogEn = ''; }
const plan = planRelease(release, { changelog, changelogEn });
if (plan.skip) {
  console.log(`::notice::${plan.skip}`);
  process.exit(0);
}

const copies = [];
if (channel === 'homebrew-tap') copies.push(['packaging/homebrew/Casks/omp.rb', 'Casks/omp.rb']);
else if (channel === 'scoop-bucket') copies.push(['bucket/omp.json', 'bucket/omp.json']);
else if (channel === 'flathub') {
  copies.push([`packaging/flatpak/${FLATPAK_ID}.yml`, `${FLATPAK_ID}.yml`]);
  copies.push([`packaging/flatpak/${FLATPAK_ID}.desktop`, `${FLATPAK_ID}.desktop`]);
  copies.push([`packaging/flatpak/${FLATPAK_ID}.metainfo.xml`, `${FLATPAK_ID}.metainfo.xml`]);
} else {
  console.log(`::notice::unknown external channel ${channel}`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'stores-'));
try {
  run('gh', ['auth', 'setup-git'], { env, stdio: 'inherit' });
  run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir], { env, stdio: 'inherit' });
  const branch = `stores/${parsed.tag}`;
  const base = process.env.CHANNEL_BASE || 'main';
  let hasBranch = false;
  try {
    run('git', ['fetch', 'origin', branch], { cwd: dir, env });
    run('git', ['rev-parse', '--verify', `origin/${branch}`], { cwd: dir });
    hasBranch = true;
  } catch {
    hasBranch = false;
  }
  if (hasBranch) run('git', ['checkout', '-B', branch, `origin/${branch}`], { cwd: dir, stdio: 'inherit' });
  else run('git', ['checkout', '-B', branch], { cwd: dir, stdio: 'inherit' });
  for (const [src, dest] of copies) {
    const body = plan.files[src] || readFileSync(src, 'utf8');
    if (!body) throw new Error(`renderer has no ${src}`);
    const target = join(dir, dest);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  run('git', ['add', '-A'], { cwd: dir });
  const dirty = run('git', ['status', '--porcelain'], { cwd: dir }).trim();
  if (!dirty) console.log(`::notice::${repo} already has ${parsed.tag}.`);
  else {
    run('git', [
      '-c', 'user.name=github-actions[bot]',
      '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', `Update OMP ${parsed.tag}`,
    ], { cwd: dir, env, stdio: 'inherit' });
    run('git', ['push', 'origin', `HEAD:${branch}`], { cwd: dir, env, stdio: 'inherit' });
  }
  if (dirty || hasBranch) {
    const body = join(dir, 'pr.md');
    writeFileSync(body, `Update OMP ${parsed.tag} from the GitHub release assets.\n`);
    let existing = '';
    try {
      existing = run('gh', ['pr', 'view', branch, '--repo', repo, '--json', 'url', '--jq', '.url'], { env }).trim();
    } catch {
      existing = '';
    }
    if (existing) console.log(existing);
    else {
      run('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `OMP ${parsed.tag}`, '--body-file', body], { env, stdio: 'inherit' });
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
