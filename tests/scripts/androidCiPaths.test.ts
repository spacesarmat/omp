import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

function classify(files: string): string {
  const out = execFileSync('bash', ['scripts/android-ci-paths.sh'], {
    input: files,
    encoding: 'utf8',
  });
  const flag = out.match(/^android=(true|false)$/m);
  if (!flag) throw new Error(out);
  return flag[1];
}

describe('android CI path filter', () => {
  const job = ci.slice(ci.indexOf('\n  android:'), ci.indexOf('\n  billing:'));

  it('shellcheck is clean', () => {
    execFileSync('shellcheck', ['scripts/android-ci-paths.sh'], { stdio: 'inherit' });
  });

  it('marks push and workflow_dispatch as a full run before the classifier', () => {
    const step = job.slice(job.indexOf('EVENT_NAME:'), job.indexOf('Skip unchanged Android paths'));
    expect(step).toContain('if [ "$EVENT_NAME" != "pull_request" ]; then');
    expect(step).toContain('echo "android=true" >> "$GITHUB_OUTPUT"');
    expect(step.indexOf('echo "android=true"')).toBeLessThan(step.indexOf('exit 0'));
    expect(step.indexOf('scripts/android-ci-paths.sh')).toBeGreaterThan(step.indexOf('exit 0'));
  });

  it('keeps the android job successful when steps are skipped', () => {
    expect(job).not.toMatch(/\n  android:\n {4}if:/);
    expect(job).toContain('name: Skip unchanged Android paths');
    expect(job).toContain("if: steps.filter.outputs.android != 'true'");
    const sync = job.slice(job.indexOf('Sync the web app'), job.indexOf('Build and test'));
    expect(sync).toContain("if: steps.filter.outputs.android == 'true'");
    expect(sync).toContain('run: npm run android:sync');
    const build = job.slice(job.indexOf('name: Build and test'), job.indexOf('name: APK size per ABI'));
    expect(build).toContain("if: steps.filter.outputs.android == 'true'");
    expect(build).toContain('assembleDebug testDebugUnitTest');
    expect(build).toContain('-PompAbi=arm64-v8a');
    expect(build).toContain('--build-cache');
    expect(build).toContain('--parallel');
  });

  it('runs for the web and mobile inputs that android:sync packages', () => {
    for (const file of [
      'android/app/build.gradle',
      'android/vendor/2160player',
      'src/main.tsx',
      'mobile/src/main.tsx',
      'index.html',
      'capacitor.config.ts',
      'vite.mobile.config.ts',
      'vite.tv-android.config.ts',
      'tsconfig.json',
      'package.json',
      'package-lock.json',
      'torrserver.version',
      '.gitmodules',
      'scripts/torrserver-pin.mjs',
      'scripts/torrserver-lib.mjs',
      'scripts/strip-flatdir.mjs',
      'scripts/flatdir-lib.mjs',
      'scripts/android-ci-paths.sh',
      '.github/workflows/ci.yml',
    ]) {
      expect(classify(file + '\n')).toBe('true');
    }
  });

  it('leaves unrelated files off, including an empty list', () => {
    expect(classify('')).toBe('false');
    for (const file of [
      'CHANGELOG.md',
      'desktop/src-tauri/src/lib.rs',
      'desktop/package-lock.json',
      'ops/billing/src/server.mjs',
      'editor/server.mjs',
      'design/theme.json',
      'tests/scripts/androidCiPaths.test.ts',
      '.github/workflows/desktop.yml',
      '.github/workflows/release.yml',
    ]) {
      expect(classify(file + '\n')).toBe('false');
    }
  });

  it('ORs a mixed list', () => {
    expect(classify('CHANGELOG.md\nsrc/app.tsx\n')).toBe('true');
  });
});
