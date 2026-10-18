import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
// @ts-ignore plain .mjs script
import { buildReleaseNotes, previousVersion, RELEASE_NOTES_MAX, HOMEBREW_REPO_URL } from '../../scripts/release-notes-lib.mjs';
// @ts-ignore plain .mjs script
import { renderReleaseNotes } from '../../scripts/release-notes.mjs';

const MD = '# Изменения\n\n## 1.1.0\n\n- А\n\n## 1.1.0-beta.2\n\n- Б\n\n## 1.1.0-beta.1\n\n- В\n\n## 1.0.0\n\n- Г\n';
const notes = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i}`);

describe('release notes', () => {
  it('finds the previous version: betas skipped for a stable one', () => {
    expect(previousVersion(MD, '1.1.0')).toBe('1.0.0');
    expect(previousVersion(MD, '1.1.0-beta.2')).toBe('1.1.0-beta.1');
    expect(previousVersion(MD, '1.0.0')).toBeNull();
    expect(previousVersion(MD, '9.9.9')).toBeNull();
  });

  const body = buildReleaseNotes({
    tag: 'v1.1.0',
    version: '1.1.0',
    ru: notes(13, 'Пункт'),
    en: notes(13, 'Item'),
    prevTag: 'v1.0.0',
    sha256: [{ name: 'OMP-1.1.0-webOS.ipk', sha: 'abc' }],
  });
  const [visible, details] = body.split('<details>');

  it('shows a short Russian block, then a short English block', () => {
    expect(visible.indexOf('### Что нового')).toBeLessThan(visible.indexOf('### Скачать'));
    expect(visible.indexOf('### Скачать')).toBeLessThan(visible.indexOf("### What's new"));
    expect(visible.indexOf("### What's new")).toBeLessThan(visible.indexOf('### Download'));
    expect(visible.match(/^- Пункт/gm)).toHaveLength(RELEASE_NOTES_MAX);
    expect(visible.match(/^- Item/gm)).toHaveLength(RELEASE_NOTES_MAX);
    expect(visible).toContain('…и ещё 5 — в [CHANGELOG]');
    expect(visible).toContain('…and 5 more in the [changelog]');
    expect(visible).toContain('`OMP-1.1.0-arm64.apk`');
    expect(visible).toContain('`OMP-1.1.0-armv7.apk`');
    expect(visible).toContain('`OMP-1.1.0-webOS.ipk`');
    expect(visible).toContain('README.en.md');
  });

  it('has at most two screenshots and folds checksums, Homebrew and the compare link', () => {
    expect(body.match(/!\[/g)).toHaveLength(2);
    expect(visible).not.toContain('SHA-256');
    expect(visible).not.toContain(HOMEBREW_REPO_URL);
    expect(details).toContain('`OMP-1.1.0-webOS.ipk`: `abc`');
    expect(details).toContain(HOMEBREW_REPO_URL);
    expect(details).toContain('compare/v1.0.0...v1.1.0');
    expect(body).not.toContain("What's Changed");
  });

  it('a beta has no Homebrew line', () => {
    const b = buildReleaseNotes({ tag: 'v1.1.0-beta.2', version: '1.1.0-beta.2', ru: ['А'], en: ['A'] });
    expect(b).not.toContain(HOMEBREW_REPO_URL);
  });

  it('renders from the real changelogs without a build', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const out = renderReleaseNotes(`v${pkg.version}`, 'no-such-build-dir');
    expect(out).toContain(`## OMP v${pkg.version}`);
    expect(out).not.toContain('SHA-256');
    expect(out).toContain("### What's new");
    expect(out).toContain('compare/v');
  });
});
