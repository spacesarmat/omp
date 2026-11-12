import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const yml = readFileSync('.github/workflows/release.yml', 'utf8').replace(/\r\n/g, '\n');

describe('release workflow asset names', () => {
  it('uses OMP- names for every apk/ipk path', () => {
    const paths = yml.match(/(?<![\w/.])build\/[^\s"']*\.(apk|ipk)/g) || [];
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((p: string) => {
      if (p.indexOf('com.spacesarmat') >= 0) return; // the packager's own output name
      if (p.indexOf('*') >= 0) return; // artifact upload glob, not a published name
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
  it('posts the release without files, never fails the release and keeps the token in env', () => {
    const step = yml.slice(yml.indexOf('- name: Post to Telegram'));
    expect(step).toContain('continue-on-error: true');
    expect(step).toMatch(/node scripts\/telegram-post\.mjs "\$TAG"\n/);
    expect(step).toContain('TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}');
  });
});

describe('Telegram post workflows attach no files', () => {
  it('telegram-post.yml and telegram-fix.yml neither download release files nor repost them', () => {
    for (const name of ['telegram-post.yml', 'telegram-fix.yml']) {
      const w = readFileSync(`.github/workflows/${name}`, 'utf8');
      expect(w).not.toMatch(/gh release download|--repost-files|telegram-post\.mjs "\$TAG" build/);
    }
  });
});

describe('CI workflow', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

  it('prints the size of every debug APK (one per ABI)', () => {
    const at = ci.indexOf('assembleDebug');
    expect(at).toBeGreaterThan(0);
    expect(ci.slice(at)).toContain('ls -l android/app/build/outputs/apk/debug/*.apk');
  });

  it('keeps the overflow check beside build, not inside it', () => {
    const build = ci.slice(ci.indexOf('\n  build:'), ci.indexOf('\n  overflow:'));
    expect(build).not.toContain('check:overflow');
    const overflow = ci.slice(ci.indexOf('\n  overflow:'), ci.indexOf('\n  android:'));
    expect(overflow).toContain('run: npm run check:overflow');
  });

  it('builds only the arm64 debug APK on pull requests and uploads debug APKs otherwise', () => {
    expect(ci).toContain("if [ \"$EVENT_NAME\" = \"pull_request\" ]; then");
    expect(ci).toContain('-PompAbi=arm64-v8a');
    expect(ci).toContain('assembleDebug testDebugUnitTest');
    expect(ci).not.toContain('assembleArm64-v8aDebug');
    expect(ci).toContain("github.event_name != 'pull_request'");
    expect(ci).toContain('gradle/actions/setup-gradle@8da46b539cd8fe6ab27ca75128919a18d757604c');
    expect(ci).toContain('cache-read-only: false');
    expect(ci).not.toContain('cache: gradle');
    expect(ci).toContain('--build-cache --parallel');
    expect(readFileSync('android/gradle.properties', 'utf8')).toContain('org.gradle.configuration-cache=true');
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(release).toContain('assembleRelease');
    expect(release).not.toContain('ompAbi');
    expect(release).toContain('app-universal-release.apk');
    expect(release).toContain('app-arm64-v8a-release.apk');
    expect(release).toContain('app-armeabi-v7a-release.apk');
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(gradle).toContain("findProperty('ompAbi')");
    expect(gradle).toContain('universalApk = false');
    expect(gradle).not.toContain('taskGraph.whenReady');
  });
});

describe('desktop workflow scope', () => {
  const yml = readFileSync('.github/workflows/desktop.yml', 'utf8').replace(/\r\n/g, '\n');

  it('cancels superseded pull requests and packages NSIS only outside them', () => {
    expect(yml).toContain('group: desktop-${{ github.ref }}');
    expect(yml).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(yml).toContain("tags: ['v*']");
    const job = yml.slice(yml.indexOf('\n  package-windows:'));
    expect(job).toContain("github.event_name != 'pull_request'");
    expect(job).toContain('needs.smoke.result == \'success\'');
  });

  it('still runs smoke when shared frontend, lockfiles, or the workflow change', () => {
    const paths = readFileSync('scripts/desktop-ci-paths.sh', 'utf8');
    expect(yml).toContain('bash scripts/desktop-ci-paths.sh');
    for (const path of ['desktop/*', 'src/*', 'mobile/*', 'design/*', 'package.json', 'package-lock.json', 'torrserver.version', '.github/workflows/desktop.yml']) {
      expect(paths).toContain(path);
    }
  });
});

describe('release jobs run side by side', () => {
  it('keeps tests, webOS and Android independent, and publishes only after all three', () => {
    const test = yml.slice(yml.indexOf('\n  test:'), yml.indexOf('\n  web:'));
    const web = yml.slice(yml.indexOf('\n  web:'), yml.indexOf('\n  android:'));
    const android = yml.slice(yml.indexOf('\n  android:'), yml.indexOf('\n  publish:'));
    const publish = yml.slice(yml.indexOf('\n  publish:'));
    expect(test).not.toContain('needs:');
    expect(web).not.toContain('needs:');
    expect(android).not.toContain('needs:');
    expect(publish).toContain('needs: [test, web, android]');
    expect(publish).toContain("github.event_name != 'workflow_dispatch' || inputs.publish");
    expect(android).toContain('--build-cache --parallel');
    expect(android).toContain('gradle/actions/setup-gradle@8da46b539cd8fe6ab27ca75128919a18d757604c');
    expect(android).not.toContain('cache: gradle');
    expect(android).not.toContain('gh release create');
    expect(android).not.toContain('telegram-post');
    expect(test).toContain('scripts/release-ci-skip.mjs');
    expect(test).toContain('if [ ! -f scripts/release-ci-skip.mjs ]');
    expect(test).toContain("if: steps.ci.outputs.skip != 'true'");
    expect(android.indexOf('mkdir -p build')).toBeGreaterThan(-1);
    expect(android.indexOf('mkdir -p build')).toBeLessThan(android.indexOf('cp "$OUT/app-universal-release.apk"'));
    expect(publish).toContain('publish is off');
  });
});

describe('release billing gate', () => {
  it('installs billing dependencies and requires the full Postgres suite', () => {
    expect(yml).toMatch(/services:\s*\n\s+postgres:\s*\n\s+image: postgres:17-alpine/);
    const install = yml.indexOf('run: npm --prefix ops/billing ci');
    const test = yml.indexOf('run: npm test');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(test);
    const testStep = yml.slice(test, yml.indexOf('Require the TMDB API key'));
    expect(testStep).toContain('BILLING_TEST_DATABASE_URL: postgres://test:test@localhost:5432/billing_test');
    expect(testStep).toContain("BILLING_TEST_REQUIRE_PG: '1'");
  });

  it('installs desktop dependencies before npm test', () => {
    const desktop = yml.indexOf('run: npm ci --prefix desktop');
    const test = yml.indexOf('run: npm test');
    expect(desktop).toBeGreaterThan(-1);
    expect(desktop).toBeLessThan(test);
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

  it('the TorrServer update workflow does not receive the key', () => {
    const upd = readFileSync('.github/workflows/torrserver-update.yml', 'utf8');
    expect(upd).not.toContain('TMDB_API_KEY');
  });
});

describe('TorrServer update opens a pull request', () => {
  const upd = readFileSync('.github/workflows/torrserver-update.yml', 'utf8');
  const apply = upd.slice(upd.indexOf('Apply the TorrServer update'), upd.indexOf('Install dependencies'));
  const push = upd.slice(upd.indexOf('Push the branch and open the pull request'));

  it('never pushes to main and ships only through the pull request', () => {
    expect(upd).not.toContain('HEAD:main');
    expect(upd).not.toContain('git tag');
    expect(upd).not.toMatch(/^\s+release:/m);
    expect(push).toContain('git push --force origin "HEAD:refs/heads/$BRANCH"');
    expect(push).toContain('gh pr create');
    expect(push).toContain('bash scripts/upstream-ship.sh');
  });

  it('skips when an open pull request for the same TorrServer tag exists, before changing anything', () => {
    expect(apply).toContain('BRANCH="chore/torrserver-$LATEST"');
    expect(apply).toContain('--state open --head "$BRANCH"');
    expect(apply.indexOf('--state open')).toBeLessThan(apply.indexOf('scripts/torrserver-bump.mjs'));
  });

  it('commits the pin, both changelogs and the OMP beta bump', () => {
    expect(push).toContain('torrserver.version android/app/src/main/res/raw/torrserver.json CHANGELOG.md CHANGELOG.en.md');
    expect(push).toContain('package.json package-lock.json');
    expect(apply).toContain('node scripts/omp-release-bump.mjs');
  });

  it('starts CI on the branch, since GITHUB_TOKEN pushes trigger no workflows', () => {
    expect(upd).toContain('actions: write');
    expect(push).toContain('gh workflow run ci.yml');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/^on:[\s\S]*?^\s+workflow_dispatch:/m);
  });
});
