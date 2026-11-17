import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { nextBeta, promoteUnreleased, webosVersion } from '../../scripts/omp-version.mjs';
import { branchMayAutoMerge, checksVerdict, runsVerdict } from '../../scripts/upstream-gate.mjs';

describe('next OMP beta', () => {
  it('steps a beta and starts a patch beta from a stable version', () => {
    expect(nextBeta('0.30.1-beta.5')).toBe('0.30.1-beta.6');
    expect(nextBeta('0.30.1-beta.6')).toBe('0.30.1-beta.7');
    expect(nextBeta('0.30.1-beta.9')).toBe('0.30.1-beta.10');
    expect(nextBeta('0.30.1')).toBe('0.30.2-beta.1');
    expect(webosVersion('0.30.1-beta.6')).toBe('0.30.1');
    expect(webosVersion('0.30.2-beta.1')).toBe('0.30.2');
    expect(() => nextBeta('0.30.1-rc.1')).toThrow(/Bad version/);
  });

  it('renames the unreleased heading and keeps the bullets', () => {
    const ru = '# Changes\n\n## Не выпущено\n\n- Встроенный TorrServer обновлён до MatriX.9\n\n## 0.30.1-beta.5\n\n- old\n';
    expect(promoteUnreleased(ru, '0.30.1-beta.6', false)).toBe(
      '# Changes\n\n## 0.30.1-beta.6\n\n- Встроенный TorrServer обновлён до MatriX.9\n\n## 0.30.1-beta.5\n\n- old\n',
    );
    const en = '## Unreleased\n\n- The built-in TorrServer is updated to MatriX.9\n';
    expect(promoteUnreleased(en, '0.30.1-beta.6', true)).toContain('## 0.30.1-beta.6\n');
    expect(() => promoteUnreleased(ru, '0.30.1-beta.5', false)).toThrow(/already present/);
    expect(() => promoteUnreleased('# Changes\n', '0.30.1-beta.6', false)).toThrow(/no Не выпущено/);
  });
});

describe('upstream auto-merge gate', () => {
  it('allows only the two bot branch prefixes', () => {
    expect(branchMayAutoMerge('chore/torrserver-MatriX.150')).toBe(true);
    expect(branchMayAutoMerge('chore/player2160-v0.2.26')).toBe(true);
    expect(branchMayAutoMerge('main')).toBe(false);
    expect(branchMayAutoMerge('chore/torrserver-')).toBe(false);
    expect(branchMayAutoMerge('feat/torrserver-MatriX.1')).toBe(false);
  });

  it('allow exits 1 for any other branch', () => {
    expect(() => execFileSync('node', ['scripts/upstream-gate.mjs', 'allow', 'main'], { encoding: 'utf8', stdio: 'pipe' })).toThrow();
    expect(execFileSync('node', ['scripts/upstream-gate.mjs', 'allow', 'chore/torrserver-MatriX.1'], { encoding: 'utf8' })).toBe('');
  });

  it('checks pass only when every check is done and none failed', () => {
    expect(checksVerdict([])).toBe('wait');
    expect(checksVerdict([{ name: 'build', state: 'SUCCESS' }, { name: 'android', state: 'PENDING' }])).toBe('wait');
    expect(checksVerdict([{ name: 'build', state: 'SUCCESS' }, { name: 'android', state: 'FAILURE' }])).toBe('fail');
    expect(checksVerdict([{ name: 'build', state: 'SUCCESS' }, { name: 'package', state: 'SKIPPED' }])).toBe('pass');
  });

  it('waits until every dispatched workflow has succeeded', () => {
    const ci = { name: 'CI', status: 'completed', conclusion: 'success' };
    const desktopWait = { name: 'Desktop', status: 'in_progress', conclusion: '' };
    const desktopOk = { name: 'Desktop', status: 'completed', conclusion: 'success' };
    const desktopBad = { name: 'Desktop', status: 'completed', conclusion: 'failure' };
    expect(runsVerdict([ci], ['CI', 'Desktop'])).toBe('wait');
    expect(runsVerdict([ci, desktopWait], ['CI', 'Desktop'])).toBe('wait');
    expect(runsVerdict([ci, desktopBad], ['CI', 'Desktop'])).toBe('fail');
    expect(runsVerdict([ci, desktopOk], ['CI', 'Desktop'])).toBe('pass');
    expect(runsVerdict([ci], ['CI'])).toBe('pass');
  });
});

describe('upstream ship script', () => {
  it('shellcheck is clean and both update workflows call it only for bot branches', () => {
    execFileSync('shellcheck', ['scripts/upstream-ship.sh'], { stdio: 'inherit' });
    for (const name of ['torrserver-update.yml', 'player2160-update.yml']) {
      const yml = readFileSync('.github/workflows/' + name, 'utf8');
      expect(yml).toContain('bash scripts/upstream-ship.sh');
      expect(yml).toContain('group: upstream-component-update');
      expect(yml).toContain('cancel-in-progress: false');
      expect(yml).not.toContain('HEAD:main');
    }
    const ship = readFileSync('scripts/upstream-ship.sh', 'utf8');
    expect(ship).toContain('gh workflow run release.yml');
    expect(ship).toContain('gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash --auto --match-head-commit "$SHA"');
    expect(ship).toContain('gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash --match-head-commit "$SHA"');
    expect(ship).toContain('--disable-auto');
  });
});
