import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const desktop = readFileSync('.github/workflows/desktop.yml', 'utf8').replace(/\r\n/g, '\n');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

function classify(files: string): { desktop: string; rust: string } {
  const out = execFileSync('bash', ['scripts/desktop-ci-paths.sh'], {
    input: files,
    encoding: 'utf8',
  });
  const desktopFlag = out.match(/^desktop=(true|false)$/m);
  const rustFlag = out.match(/^rust=(true|false)$/m);
  if (!desktopFlag || !rustFlag) throw new Error(out);
  return { desktop: desktopFlag[1], rust: rustFlag[1] };
}

describe('desktop CI path filter', () => {
  it('shellcheck is clean', () => {
    execFileSync('shellcheck', ['scripts/desktop-ci-paths.sh', 'scripts/ci-apt-install.sh'], { stdio: 'inherit' });
  });

  it('marks push, tags and workflow_dispatch as full runs inside the workflow', () => {
    const step = desktop.slice(desktop.indexOf('EVENT_NAME:'), desktop.indexOf('smoke:'));
    expect(step).toContain('if [ "$EVENT_NAME" != "pull_request" ]; then');
    expect(step).toContain('echo "desktop=true" >> "$GITHUB_OUTPUT"');
    expect(step).toContain('echo "rust=true" >> "$GITHUB_OUTPUT"');
    expect(step.indexOf('echo "rust=true"')).toBeLessThan(step.indexOf('exit 0'));
    expect(step.indexOf('scripts/desktop-ci-paths.sh')).toBeGreaterThan(step.indexOf('exit 0'));
  });

  it('keeps a mobile UI change on the desktop filter and off the Rust filter', () => {
    expect(classify('mobile/src/ui/catalog.tsx\n')).toEqual({ desktop: 'true', rust: 'false' });
    expect(classify('src/app.tsx\ndesign/theme.json\npackage-lock.json\n')).toEqual({ desktop: 'true', rust: 'false' });
    expect(classify('desktop/tests/shell.test.ts\n')).toEqual({ desktop: 'true', rust: 'false' });
  });

  it('turns Rust on only for src-tauri, Cargo, the workflow and Rust test inputs', () => {
    expect(classify('desktop/src-tauri/src/lib.rs\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('desktop/src-tauri/Cargo.lock\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('desktop/src-tauri/tauri.conf.json\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('desktop/tests/peer_download.py\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('desktop/tests/requirements.txt\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('.github/workflows/desktop.yml\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('scripts/desktop-ci-paths.sh\n')).toEqual({ desktop: 'true', rust: 'true' });
    expect(classify('scripts/ci-apt-install.sh\n')).toEqual({ desktop: 'false', rust: 'true' });
    expect(classify('Cargo.toml\n')).toEqual({ desktop: 'false', rust: 'true' });
    expect(classify('ops/tools/Cargo.lock\n')).toEqual({ desktop: 'false', rust: 'true' });
  });

  it('leaves unrelated files off both filters, including an empty list', () => {
    expect(classify('')).toEqual({ desktop: 'false', rust: 'false' });
    expect(classify('.github/workflows/ci.yml\nCHANGELOG.md\n')).toEqual({ desktop: 'false', rust: 'false' });
  });

  it('ORs a mixed list and still reports both flags', () => {
    expect(classify('mobile/src/ui/catalog.tsx\ndesktop/src-tauri/src/lib.rs\n')).toEqual({
      desktop: 'true',
      rust: 'true',
    });
  });
});

describe('desktop CI apt install', () => {
  const smoke = desktop.slice(desktop.indexOf('\n  smoke:'), desktop.indexOf('\n  package-windows:'));
  const linux = desktop.slice(desktop.indexOf('\n  package-linux:'));

  it('runs apt, Python and cargo test only for Rust changes, and keeps JS on the desktop filter', () => {
    expect(smoke).toContain("if: needs.changes.outputs.desktop == 'true'\n        run: npx vitest run desktop/tests");
    expect(smoke).toContain("if: needs.changes.outputs.desktop == 'true'\n        run: npm run build:desktop");
    expect(smoke).toContain("if: needs.changes.outputs.rust == 'true' && matrix.os == 'ubuntu-latest'");
    expect(smoke).toContain("if: needs.changes.outputs.rust == 'true' && matrix.os == 'windows-latest'");
    expect(smoke).toContain("name: Rust tests\n        if: needs.changes.outputs.rust == 'true'");
    expect(smoke).not.toContain('needs.changes.outputs.desktop == \'true\' && matrix.os == \'ubuntu-latest\'');
  });

  it('keeps the smoke job successful when steps are skipped', () => {
    expect(smoke).toContain('if: ${{ !cancelled() && needs.changes.result == \'success\' }}');
    expect(smoke).not.toContain('needs.changes.outputs.desktop == \'true\'\n    strategy:');
  });

  it('caches debs, skips recommends, disables man-db and caps apt at 10 minutes', () => {
    for (const text of [smoke, linux, ci]) {
      expect(text).toContain('timeout-minutes: 10');
      expect(text).toContain('bash scripts/ci-apt-install.sh');
      expect(text).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0');
    }
    expect(smoke).toContain('timeout-minutes: 45');
    expect(linux).toContain('timeout-minutes: 60');
    expect(linux).toContain('patchelf libfuse2');
    expect(smoke).not.toContain('patchelf');
    const apt = readFileSync('scripts/ci-apt-install.sh', 'utf8');
    expect(apt).toContain('--no-install-recommends');
    expect(apt).toContain('Acquire::Retries=2');
    expect(apt).toContain('Acquire::http::Timeout=15');
    expect(apt).toContain('man-db/auto-update false');
    expect(apt).toContain('dpkg-reconfigure -f noninteractive man-db');
    expect(apt).toContain('rm -f /var/lib/man-db/auto-update');
    expect(apt).not.toContain('apt-get install -y libwebkit');
  });

  it('refuses a cache directory that is not the apt cache', () => {
    let stderr = '';
    try {
      execFileSync('bash', ['scripts/ci-apt-install.sh', 'shellcheck'], {
        env: { ...process.env, APT_CACHE_DIR: '/tmp/not-apt' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr || '');
    }
    expect(stderr).toContain('refusing apt cache dir');
  });
});
