import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
// @ts-ignore plain .mjs script
import { androidVersionCode, channelSkip, fastlaneChangelog, matchingFixtures, parseReleaseTag, planRelease, releaseFixture, renderRelease, userBullets } from '../../scripts/stores/lib.mjs';

const releaseYml = readFileSync('.github/workflows/release.yml', 'utf8').replace(/\r\n/g, '\n');
const desktopYml = readFileSync('.github/workflows/desktop.yml', 'utf8').replace(/\r\n/g, '\n');
const storesYml = readFileSync('.github/workflows/stores.yml', 'utf8').replace(/\r\n/g, '\n');

const v030 = JSON.parse(readFileSync('tests/fixtures/stores/0.30.0.json', 'utf8'));

describe('parseReleaseTag', () => {
  it('accepts a stable v tag and a stable desktop tag', () => {
    expect(parseReleaseTag('v0.30.0')).toEqual({ tag: 'v0.30.0', version: '0.30.0', stable: true });
    expect(parseReleaseTag('desktop-0.30.0')).toEqual({ tag: 'desktop-0.30.0', version: '0.30.0', stable: true });
  });

  it('rejects betas, empty tags and tags with shell metacharacters', () => {
    expect(parseReleaseTag('v0.30.1-beta.13').stable).toBe(false);
    expect(parseReleaseTag('desktop-0.20.12-beta.2').stable).toBe(false);
    expect(parseReleaseTag('').stable).toBe(false);
    expect(parseReleaseTag('v0.30.0;rm').stable).toBe(false);
    expect(parseReleaseTag('v0.30.0 && true').stable).toBe(false);
  });
});

describe('androidVersionCode', () => {
  it('matches the phone versionCode slots', () => {
    expect(androidVersionCode('0.20.4-beta.1')).toBe(200401);
    expect(androidVersionCode('0.20.4')).toBe(200499);
    expect(androidVersionCode('0.30.0')).toBe(300099);
    expect(androidVersionCode('v0.30.1-beta.13')).toBe(300113);
    expect(androidVersionCode('nope')).toBe(0);
  });
});

describe('fastlane changelog', () => {
  const md = [
    '## 0.30.0',
    '',
    '- [tech] hidden',
    '- [phone] Phone line',
    '- Shared line',
    '',
    '## 0.29.0',
    '',
    '- older',
    '',
  ].join('\n');

  it('drops technical bullets and platform markers', () => {
    expect(userBullets(md, '0.30.0')).toEqual(['Phone line', 'Shared line']);
    expect(userBullets(md, '0.29.0')).toEqual(['older']);
    expect(userBullets(md, '9.9.9')).toEqual([]);
  });

  it('stays within 500 bytes and does not cut a utf-8 sequence', () => {
    const text = fastlaneChangelog('## 1.0.0\n\n- ' + 'ё'.repeat(400), '1.0.0');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(500);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('planRelease', () => {
  it('plans every store file from the stable v0.30.0 assets', () => {
    const notes = '## 0.30.0\n\n- [tech] hidden\n- Phone line\n';
    const plan = planRelease(v030, { changelog: notes, changelogEn: notes });
    expect(plan.skip).toBe('');
    expect(plan.version).toBe('0.30.0');
    expect(plan.files['bucket/omp.json']).toContain('efa559bb0929a6c675801edbf276dbe04b628bd4d0a35f0278378e157e2491b1');
    expect(plan.files['packaging/homebrew/Casks/omp.rb']).toContain('706c7966376f27117e07a34589403292258ec5e9f734755dee805bbcb82ffde0');
    expect(plan.files['packaging/homebrew/Casks/omp.rb']).toContain('b3a93a261f55c38c056d2d43e7d68366d569920a42e178976961df8c3f15e5c4');
    expect(plan.files['packaging/flatpak/com.spacesarmat.omp.desktop.yml']).toContain('567e10c5c64191b492848cf5b1e2ba3f6ea3a359562dd5801050c5fa06165778');
    const snap = plan.files['packaging/snap/snapcraft.yaml'];
    expect(snap).toContain("version: '0.30.0'");
    expect(snap).toContain('platforms:\n  amd64:');
    expect(snap).not.toContain('architectures:');
    const winget = plan.files['packaging/winget/manifests/s/Spacesarmat/OMP/0.30.0/Spacesarmat.OMP.installer.yaml'];
    expect(winget).toContain('PackageIdentifier: Spacesarmat.OMP');
    expect(winget).toContain('InstallerType: nullsoft');
    expect(winget).toContain('Scope: user');
    expect(winget).toContain('OMP-0.30.0-setup.exe');
    expect(winget).not.toContain('portable.exe');
    expect(plan.files['fastlane/metadata/android/en-US/changelogs/300099.txt']).toContain('Phone line');
    expect(plan.files['fastlane/metadata/android/ru-RU/changelogs/300099.txt']).toContain('Phone line');
  });

  it('skips a beta and a stable release that has no Windows installer yet', () => {
    expect(planRelease({ ...v030, tag: 'v0.30.1-beta.1', prerelease: true }).skip).toMatch(/stable/);
    const partial = {
      ...v030,
      assets: v030.assets.filter((asset: { name: string }) => !asset.name.endsWith('-setup.exe')),
    };
    const plan = planRelease(partial);
    expect(plan.skip).toMatch(/setup.exe/);
    expect(plan.files).toEqual({});
  });
});

describe('channelSkip', () => {
  it('skips winget, snap and external taps when the secret or the listed flag is missing', () => {
    expect(channelSkip('winget', { token: '', listed: '' })).toMatch(/WINGET_TOKEN/);
    expect(channelSkip('winget', { token: 'present', listed: '' })).toMatch(/WINGET_LISTED/);
    expect(channelSkip('winget', { token: 'present', listed: 'true' })).toBe('');
    expect(channelSkip('snap', { token: '' })).toMatch(/SNAPCRAFT_STORE_CREDENTIALS/);
    expect(channelSkip('snap', { token: 'present' })).toBe('');
    expect(channelSkip('homebrew-tap', { token: '', repo: '' })).toMatch(/HOMEBREW_TAP/);
    expect(channelSkip('flathub', { token: '' })).toMatch(/FLATHUB_TOKEN/);
    expect(channelSkip('scoop-bucket', { token: '', repo: '' })).toMatch(/SCOOP_BUCKET/);
  });
});

describe('renderRelease', () => {
  it('returns the same map as planRelease', () => {
    const input = { release: v030, changelog: '- Phone line\n', changelogEn: '- Phone line\n' };
    expect(renderRelease(input)).toEqual(planRelease(v030, input).files);
  });
});

describe('matchingFixtures', () => {
  it('keeps only the stable fixture for the winget version on disk', () => {
    const next = { ...v030, tag: 'v0.31.0', publishedAt: '2026-12-01T00:00:00Z' };
    expect(matchingFixtures([v030, next], '0.30.0')).toEqual([v030]);
    expect(matchingFixtures([{ ...v030, tag: 'v0.30.1-beta.1' }], '0.30.1')).toEqual([]);
  });

  it('round-trips the checked-in v0.30.0 fixture', () => {
    expect(releaseFixture(v030, '0.30.0')).toEqual(v030);
  });
});

describe('store update scripts', () => {
  const update = readFileSync('scripts/stores/update.mjs', 'utf8');
  const external = readFileSync('scripts/stores/push-external.mjs', 'utf8');

  it('opens the PR even when a retry has nothing new to commit', () => {
    const dirtyAt = update.indexOf('if (!dirty)');
    const prAt = update.indexOf("['pr', 'create'");
    expect(dirtyAt).toBeGreaterThan(0);
    expect(prAt).toBeGreaterThan(dirtyAt);
    expect(update.slice(dirtyAt, prAt)).not.toContain('process.exit');
    expect(update).toContain('tests/fixtures/stores');
  });

  it('continues an existing external branch instead of recreating it', () => {
    execFileSync('node', ['--check', 'scripts/stores/push-external.mjs']);
    expect(external).toContain("['fetch', 'origin', branch]");
    expect(external).toContain('origin/${branch}');
    expect(external).not.toMatch(/^\s*return;/m);
    const dirtyAt = external.indexOf('if (!dirty)');
    const prAt = external.indexOf("['pr', 'create'");
    expect(prAt).toBeGreaterThan(dirtyAt);
    expect(external.slice(dirtyAt, prAt)).not.toContain('process.exit');
  });
});

describe('committed store files', () => {
  it('match the fixture for the winget version on disk', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const changelogEn = readFileSync('CHANGELOG.en.md', 'utf8');
    const versions = readdirSync('packaging/winget/manifests/s/Spacesarmat/OMP');
    expect(versions).toEqual(['0.30.0']);
    const fixtures = readdirSync('tests/fixtures/stores')
      .filter((name: string) => name.endsWith('.json'))
      .map((name: string) => JSON.parse(readFileSync(`tests/fixtures/stores/${name}`, 'utf8')));
    const matches = matchingFixtures(fixtures, versions[0]);
    expect(matches).toHaveLength(1);
    const files = renderRelease({ release: matches[0], changelog, changelogEn });
    const bad: string[] = [];
    for (const [path, body] of Object.entries(files) as [string, string][]) {
      const onDisk = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
      if (onDisk !== body) bad.push(path);
      if (/[\u2010-\u2015\u2212]/.test(body)) bad.push(`${path} dash`);
    }
    expect(bad).toEqual([]);
  });
});

describe('store workflows', () => {
  it('publishes Izzy ABI names beside the existing APK names', () => {
    const build = releaseYml.slice(releaseYml.indexOf('Build signed Android APKs'), releaseYml.indexOf('Homebrew Channel files'));
    expect(build).toContain('cp "$OUT/app-arm64-v8a-release.apk" "build/OMP-${VERSION}-arm64.apk"');
    expect(build).toContain('cp "$OUT/app-arm64-v8a-release.apk" "build/OMP-${VERSION}-arm64-v8a.apk"');
    expect(build).toContain('cp "$OUT/app-armeabi-v7a-release.apk" "build/OMP-${VERSION}-armv7.apk"');
    expect(build).toContain('cp "$OUT/app-armeabi-v7a-release.apk" "build/OMP-${VERSION}-armeabi-v7a.apk"');
    const step = releaseYml.slice(releaseYml.indexOf('Create GitHub release'), releaseYml.indexOf('Publish update feed'));
    expect(step).toContain('"$APK64ABI" "$APK32ABI"');
  });

  it('queues store updates without failing the release or the desktop publish', () => {
    const queue = releaseYml.slice(releaseYml.indexOf('- name: Queue store updates'));
    expect(queue).toContain('node scripts/stores/queue-stores.mjs');
    expect(queue).toContain('stores.yml did not start');
    expect(queue).not.toContain('exit 1');
    const desktop = desktopYml.slice(desktopYml.indexOf('\n  queue-stores:'));
    expect(desktop).toContain("github.event.inputs.publish == 'true'");
    expect(desktop).toContain('node scripts/stores/queue-stores.mjs');
    expect(desktop).not.toContain('exit 1');
  });

  it('skips winget and snap cleanly when their secrets are missing', () => {
    expect(storesYml).toContain('WINGET_TOKEN');
    expect(storesYml).toContain('WINGET_LISTED');
    expect(storesYml).toContain('SNAPCRAFT_STORE_CREDENTIALS');
    expect(storesYml).toContain('::notice::');
    expect(storesYml).toContain('vedantmgoyal9/winget-releaser@b7370d4d152efdce803a26cc6ca9eee58cb2ad54');
    expect(storesYml).toContain("-setup\\.exe$");
    const snap = storesYml.slice(storesYml.indexOf('\n  snap:'));
    expect(snap).toContain("steps.gate.outputs.skip != 'true'");
    expect(snap.indexOf('snapcraft')).toBeGreaterThan(snap.indexOf('SNAPCRAFT_STORE_CREDENTIALS'));
  });
});

describe('validate script', () => {
  it('accepts the committed store tree', () => {
    const out = execFileSync('node', ['scripts/stores/validate.mjs'], { encoding: 'utf8' });
    expect(out).toMatch(/ok/);
  });
});
