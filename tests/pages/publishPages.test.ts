import { afterEach, describe, expect, it } from 'vitest';
// @ts-ignore node builtins
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore node builtins
import { tmpdir } from 'node:os';
// @ts-ignore node builtins
import { join } from 'node:path';
import { copyDownloadPages } from '../../scripts/publish-pages.mjs';

const roots: string[] = [];

function temp(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `omp-pages-${name}-`));
  roots.push(root);
  return root;
}

function write(root: string, file: string, content: string): void {
  const target = join(root, file);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('copyDownloadPages', () => {
  it('copies only page files and preserves update and Homebrew files', () => {
    const source = temp('source');
    const destination = temp('destination');
    write(source, 'index.html', '<html>ru new</html>');
    write(source, 'en/index.html', '<html>en new</html>');
    write(source, 'download.js', 'export const current = true;');
    write(source, 'assets/logo.svg', '<svg>omp logo</svg>');
    write(source, 'not-for-publication.txt', 'source only');
    write(destination, 'index.html', '<html>old</html>');
    write(destination, 'old-page.txt', 'keep me');
    write(destination, 'update.json', '{"version":"1.0.0"}');
    write(destination, 'update-beta.json', '{"version":"1.1.0-beta.2"}');
    write(destination, 'apps.json', '{"packages":[]}');

    copyDownloadPages(source, destination);

    expect(readFileSync(join(destination, 'index.html'), 'utf8')).toBe('<html>ru new</html>');
    expect(readFileSync(join(destination, 'en/index.html'), 'utf8')).toBe('<html>en new</html>');
    expect(readFileSync(join(destination, 'download.js'), 'utf8')).toBe('export const current = true;');
    expect(readFileSync(join(destination, 'assets/logo.svg'), 'utf8')).toBe('<svg>omp logo</svg>');
    expect(readFileSync(join(destination, 'update.json'), 'utf8')).toBe('{"version":"1.0.0"}');
    expect(readFileSync(join(destination, 'update-beta.json'), 'utf8')).toBe('{"version":"1.1.0-beta.2"}');
    expect(readFileSync(join(destination, 'apps.json'), 'utf8')).toBe('{"packages":[]}');
    expect(readFileSync(join(destination, 'old-page.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(join(destination, 'not-for-publication.txt'))).toBe(false);
  });

  it('validates every input before changing the destination', () => {
    const source = temp('source-missing');
    const destination = temp('destination-missing');
    write(source, 'index.html', '<html>new</html>');
    write(source, 'download.js', 'new script');
    write(destination, 'index.html', '<html>keep</html>');

    expect(() => copyDownloadPages(source, destination)).toThrow();

    expect(readFileSync(join(destination, 'index.html'), 'utf8')).toBe('<html>keep</html>');
    expect(existsSync(join(destination, 'download.js'))).toBe(false);
    expect(existsSync(join(destination, 'en/index.html'))).toBe(false);
  });
});
