// Supported versions in SECURITY.md, from release tags plus the version this tree is releasing.
// A beta older than the latest stable is not current. Does not tag or push.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export const VERSIONS_START = '<!-- versions:start -->';
export const VERSIONS_END = '<!-- versions:end -->';
const RELEASES_URL = 'https://github.com/spacesarmat/omp/releases';
const TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export function parseReleaseTag(raw) {
  const m = TAG_RE.exec(String(raw).trim());
  if (!m) return null;
  const beta = m[4] === undefined ? null : Number(m[4]);
  const version = `${m[1]}.${m[2]}.${m[3]}` + (beta === null ? '' : `-beta.${beta}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    beta,
    version,
    tag: `v${version}`,
  };
}

/** Positive when a is newer. A stable tag is newer than a beta of the same x.y.z. */
export function compareReleases(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.beta === null && b.beta === null) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

/** Latest stable tag, and the latest beta only when that beta is newer than the stable. */
export function pickSupported(rawTags) {
  let stable = null;
  let beta = null;
  for (const raw of rawTags) {
    const parsed = parseReleaseTag(raw);
    if (!parsed) continue;
    if (parsed.beta === null) {
      if (!stable || compareReleases(parsed, stable) > 0) stable = parsed;
    } else if (!beta || compareReleases(parsed, beta) > 0) {
      beta = parsed;
    }
  }
  if (beta && stable && compareReleases(beta, stable) <= 0) beta = null;
  return { stable, beta };
}

export function tagsFromLsRemote(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const ref = (line.split('\t')[1] || '').trim();
    if (!ref.startsWith('refs/tags/') || ref.endsWith('^{}')) continue;
    out.push(ref.slice('refs/tags/'.length));
  }
  return out;
}

function releaseLink(tag) {
  return `[${tag}](${RELEASES_URL}/tag/${tag})`;
}

export function renderVersionBlock(picked, lang) {
  const lines = lang === 'ru'
    ? [
      picked.stable
        ? `- последний стабильный релиз, сейчас ${releaseLink(picked.stable.tag)}`
        : '- стабильного релиза нет',
      picked.beta
        ? `- текущая бета, сейчас ${releaseLink(picked.beta.tag)}`
        : '- текущей беты нет',
    ]
    : [
      picked.stable
        ? `- latest stable release, currently ${releaseLink(picked.stable.tag)}`
        : '- there is no stable release',
      picked.beta
        ? `- current beta, currently ${releaseLink(picked.beta.tag)}`
        : '- there is no current beta',
    ];
  return `${VERSIONS_START}\n${lines.join('\n')}\n${VERSIONS_END}`;
}

export function applySecurityVersions(text, picked) {
  const startCount = text.split(VERSIONS_START).length - 1;
  const endCount = text.split(VERSIONS_END).length - 1;
  if (startCount !== 2 || endCount !== 2) throw new Error('SECURITY.md needs two versions blocks');
  const re = new RegExp(`${VERSIONS_START}[\\s\\S]*?${VERSIONS_END}`, 'g');
  let n = 0;
  const next = text.replace(re, (block) => {
    n += 1;
    const lang = /[А-Яа-яЁё]/.test(block) ? 'ru' : 'en';
    return renderVersionBlock(picked, lang);
  });
  if (n !== 2) throw new Error('SECURITY.md versions blocks did not replace');
  return next;
}

export function listReleaseTags() {
  let remote = '';
  try {
    remote = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    remote = '';
  }
  const remoteTags = tagsFromLsRemote(remote);
  if (remoteTags.length) return remoteTags;
  const local = execFileSync('git', ['tag', '-l', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!local.length) throw new Error('no release tags');
  return local;
}

function extraFromArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--release') {
      const value = argv[i + 1];
      if (!value) throw new Error('--release needs a version');
      out.push(value);
      i += 1;
    }
  }
  return out;
}

export function supportedFrom(tags, extra = []) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
  return pickSupported([...tags, pkg, ...extra]);
}

/** Rewrites SECURITY.md from tags, package.json and optional --release versions. */
export function syncSecurityPolicy(extra = []) {
  const picked = supportedFrom(listReleaseTags(), extra);
  const path = 'SECURITY.md';
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const next = applySecurityVersions(text, picked);
  if (next !== text) writeFileSync(path, next);
  return picked;
}

const isCli = process.argv[1] && process.argv[1].endsWith('security-versions.mjs');
if (isCli) {
  const picked = syncSecurityPolicy(extraFromArgv(process.argv.slice(2)));
  const beta = picked.beta ? picked.beta.tag : 'none';
  const stable = picked.stable ? picked.stable.tag : 'none';
  console.log(`${stable} ${beta}`);
}
