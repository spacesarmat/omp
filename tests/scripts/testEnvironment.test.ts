import { describe, expect, it } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('development test environment', () => {
  it('checks out every text file with LF regardless of the host', () => {
    const attrs = read('.gitattributes');
    expect(attrs.split('\n')[0]).toBe('* text=auto eol=lf');
  });

  it.each(['README.md', 'README.en.md', 'AGENTS.md'])('%s documents the required Linux or WSL test environment', (path) => {
    const text = read(path);
    expect(text).toMatch(/Linux|WSL/);
    expect(text).toContain('shellcheck');
    expect(text).toContain('rsync');
    expect(text).toContain('flock');
    expect(text).toContain('Postgres');
  });
});
