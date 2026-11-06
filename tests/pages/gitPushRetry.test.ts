import { afterEach, describe, expect, it } from 'vitest';
// @ts-ignore node builtins
import { execFileSync } from 'node:child_process';
// @ts-ignore node builtins
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore node builtins
import { tmpdir } from 'node:os';
// @ts-ignore node builtins
import { join } from 'node:path';
import { pushWithRebase } from '../../scripts/git-push-retry.mjs';

const roots: string[] = [];

function temp(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `omp-${name}-`));
  roots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function commit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', message);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pushWithRebase', () => {
  it('preserves concurrent page and feed commits without force-push', () => {
    const remote = temp('remote');
    git(remote, 'init', '--bare');
    const first = temp('first');
    const second = temp('second');
    git(first, 'clone', remote, '.');
    git(first, 'config', 'user.name', 'Test');
    git(first, 'config', 'user.email', 'test@example.test');
    commit(first, 'README.md', 'base', 'Initial commit');
    git(first, 'push', 'origin', 'HEAD:gh-pages');
    git(second, 'clone', '--branch', 'gh-pages', remote, '.');
    git(second, 'config', 'user.name', 'Test');
    git(second, 'config', 'user.email', 'test@example.test');

    commit(first, 'index.html', '<html>download</html>', 'Add download page');
    git(first, 'push', 'origin', 'HEAD:gh-pages');
    commit(second, 'update.json', '{"version":"1.0.0"}', 'Add update feed');
    pushWithRebase(second);

    const result = temp('result');
    git(result, 'clone', '--branch', 'gh-pages', remote, '.');
    expect(readFileSync(join(result, 'index.html'), 'utf8')).toBe('<html>download</html>');
    expect(readFileSync(join(result, 'update.json'), 'utf8')).toBe('{"version":"1.0.0"}');
    const history = execFileSync('git', ['log', '--format=%s', '-2'], { cwd: result, encoding: 'utf8' });
    expect(history).toContain('Add update feed');
    expect(history).toContain('Add download page');
  });
});
