import { describe, expect, it } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';

const pages = readFileSync('.github/workflows/pages.yml', 'utf8');
const release = readFileSync('.github/workflows/release.yml', 'utf8');

describe('gh-pages workflows', () => {
  it('requests an explicit Pages build after publication', () => {
    expect(pages).toContain('pages: write');
    expect(pages).toContain('repos/${{ github.repository }}/pages/builds');
    expect(pages.indexOf('node scripts/git-push-retry.mjs')).toBeLessThan(pages.indexOf('/pages/builds'));
  });

  it('keeps every run independent and retries publication with rebase', () => {
    for (const workflow of [pages, release]) {
      expect(workflow).toContain('scripts/git-push-retry.mjs');
      expect(workflow).not.toContain('group: gh-pages-publish');
      expect(workflow).not.toContain('git push -q -f');
    }
    expect(release).not.toContain('rm -rf build/pages/.git');
    expect(release).not.toContain('git init');
  });
});
