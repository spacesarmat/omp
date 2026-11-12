import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

function decide(sha: string, runs: unknown): string {
  const out = execFileSync('node', ['scripts/release-ci-skip.mjs', sha], {
    input: JSON.stringify(runs),
    encoding: 'utf8',
  });
  return out.trim();
}

describe('release CI skip', () => {
  it('skips only a successful push of this commit', () => {
    expect(decide('abc', [{ conclusion: 'success', event: 'push', headSha: 'abc' }])).toBe('skip=true');
    expect(decide('abc', [{ conclusion: 'success', event: 'pull_request', headSha: 'abc' }])).toBe('skip=false');
    expect(decide('abc', [{ conclusion: 'failure', event: 'push', headSha: 'abc' }])).toBe('skip=false');
    expect(decide('abc', [{ conclusion: 'success', event: 'push', headSha: 'def' }])).toBe('skip=false');
    expect(decide('abc', [])).toBe('skip=false');
  });
});
