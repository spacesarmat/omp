import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const yml = readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow asset names', () => {
  it('uses OMP- names for every apk/ipk path', () => {
    const paths = yml.match(/(?<![\w/.])build\/[^\s"']*\.(apk|ipk)/g) || [];
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((p: string) => {
      if (p.indexOf('com.spacesarmat') >= 0) return; // the packager's own output name
      expect(p).toMatch(/^build\/OMP-\$\{VERSION\}(-webOS|-arm64|-armv7)?\.(apk|ipk)$/);
    });
  });

  it('has no lowercase omp- asset and never globs the ipk', () => {
    expect(yml).not.toMatch(/omp-\$/);
    expect(yml).not.toContain('ls build/*.ipk');
  });

  it('renames (not copies) the packaged ipk and the release step defines VERSION, IPK and APK', () => {
    expect(yml).toMatch(/mv "\$\(ls build\/com\.spacesarmat\.torrplayer_\*_all\.ipk\)" "build\/OMP-\$\{VERSION\}-webOS\.ipk"/);
    const step = yml.slice(yml.indexOf('Create GitHub release'));
    expect(step).toContain('VERSION=$(node -p');
    expect(step).toContain('IPK="build/OMP-${VERSION}-webOS.ipk"');
    expect(step).toContain('APK="build/OMP-${VERSION}.apk"');
  });

  it('ships the per-ABI APKs and the universal one, in the release and in the Android feed', () => {
    const build = yml.slice(yml.indexOf('Build signed Android APKs'), yml.indexOf('Homebrew Channel files'));
    expect(build).toContain('cp "$OUT/app-universal-release.apk" "build/OMP-${VERSION}.apk"');
    expect(build).toContain('cp "$OUT/app-arm64-v8a-release.apk" "build/OMP-${VERSION}-arm64.apk"');
    expect(build).toContain('cp "$OUT/app-armeabi-v7a-release.apk" "build/OMP-${VERSION}-armv7.apk"');
    expect(build).toMatch(/ls -l .*-arm64\.apk.*-armv7\.apk/); // size of every APK in the build log
    const hb = yml.slice(yml.indexOf('Homebrew Channel files'), yml.indexOf('Create GitHub release'));
    expect(hb).toContain('"build/OMP-${VERSION}.apk" "build/OMP-${VERSION}-arm64.apk" "build/OMP-${VERSION}-armv7.apk"');
    const step = yml.slice(yml.indexOf('Create GitHub release'), yml.indexOf('Publish update feed'));
    expect(step).toContain('APK64="build/OMP-${VERSION}-arm64.apk"');
    expect(step).toContain('APK32="build/OMP-${VERSION}-armv7.apk"');
    expect(step).toMatch(/gh release create "\$TAG" "\$IPK" "\$APK64" "\$APK32" "\$APK" /);
  });
});

describe('Telegram step', () => {
  it('posts the whole build dir, never fails the release and keeps the token in env', () => {
    const step = yml.slice(yml.indexOf('- name: Post to Telegram'));
    expect(step).toContain('continue-on-error: true');
    expect(step).toContain('node scripts/telegram-post.mjs "$TAG" build');
    expect(step).toContain('TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}');
  });
});

describe('CI workflow', () => {
  it('prints the size of every debug APK (one per ABI)', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const at = ci.indexOf('assembleDebug');
    expect(at).toBeGreaterThan(0);
    expect(ci.slice(at)).toContain('ls -l android/app/build/outputs/apk/debug/*.apk');
  });
});

/** Job env is indented four spaces. Step env is indented further, so it is not included. */
function jobEnvBlocks(yml: string): string[] {
  const lines = yml.split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^ {4}env:\s*$/.test(lines[i])) continue;
    let block = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (!/^ {6,}/.test(lines[j])) break;
      block += lines[j] + '\n';
    }
    blocks.push(block);
  }
  return blocks;
}

describe('TMDB_API_KEY scope', () => {
  it('is not on any workflow job env', () => {
    const names = ['release.yml', 'ci.yml', 'torrserver-update.yml', 'vps-deploy.yml', 'billing-image.yml', 'telegram-fix.yml', 'telegram-post.yml'];
    names.forEach((name) => {
      const text = readFileSync('.github/workflows/' + name, 'utf8');
      jobEnvBlocks(text).forEach((block) => {
        expect(block, name).not.toContain('TMDB_API_KEY');
      });
    });
  });

  it('release tests run without the key; only the bundle steps receive it', () => {
    const testStep = yml.slice(yml.indexOf('run: npm test'), yml.indexOf('Require the TMDB API key'));
    expect(testStep).not.toContain('TMDB_API_KEY');
    const web = yml.slice(yml.indexOf('Build the web app'), yml.indexOf('node scripts/package.mjs'));
    expect(web).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
    expect(web).toContain('npm run build');
    const apk = yml.slice(yml.indexOf('Build signed Android APKs'), yml.indexOf('Homebrew Channel files'));
    expect(apk).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
    expect(apk).toContain('npm run android:sync');
    const gate = yml.slice(yml.indexOf('Require the TMDB API key'), yml.indexOf('Build the web app'));
    expect(gate).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
  });

  it('the TorrServer update check job does not receive the key', () => {
    const upd = readFileSync('.github/workflows/torrserver-update.yml', 'utf8');
    const check = upd.slice(0, upd.indexOf('uses: ./.github/workflows/release.yml'));
    expect(check).not.toContain('TMDB_API_KEY');
    expect(upd).toContain('TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}');
  });
});

describe('TorrServer update version gate', () => {
  const upd = readFileSync('.github/workflows/torrserver-update.yml', 'utf8');
  const apply = upd.slice(upd.indexOf('Apply the TorrServer update'), upd.indexOf('Install dependencies'));

  it('computes the publish tag with bumpPatch and skips when that tag already exists', () => {
    expect(apply).toContain('import { bumpPatch } from "./scripts/torrserver-lib.mjs"');
    expect(apply).toContain('console.log(bumpPatch(process.argv[1]))');
    expect(apply).toContain('refs/tags/v$TARGET');
    expect(apply).toContain('tag v$TARGET already exists, skipping the TorrServer bump');
    const targetCheck = apply.indexOf('refs/tags/v$TARGET');
    const bump = apply.indexOf('scripts/torrserver-bump.mjs');
    expect(targetCheck).toBeGreaterThan(0);
    expect(targetCheck).toBeLessThan(bump);
  });

  it('still waits while the current package.json version is unreleased', () => {
    expect(apply).toContain('refs/tags/v$OMP_VERSION');
    expect(apply).toContain('OMP $OMP_VERSION is not released yet');
    expect(apply.indexOf('refs/tags/v$OMP_VERSION')).toBeLessThan(apply.indexOf('refs/tags/v$TARGET'));
  });

  it('commits the English changelog the release tests read', () => {
    const commit = upd.slice(upd.indexOf('Commit, tag and push the update'));
    expect(commit).toContain('CHANGELOG.md CHANGELOG.en.md');
  });
});
