import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renameReleaseHeading, stableVersion } from '../../scripts/omp-version.mjs';
import {
  applySecurityVersions,
  parseReleaseTag,
  pickSupported,
  renderVersionBlock,
  tagsFromLsRemote,
} from '../../scripts/security-versions.mjs';

const policy = (ru: string, en: string) => `# Политика

Актуальные теги: https://github.com/spacesarmat/omp/releases

<!-- versions:start -->
${ru}
<!-- versions:end -->

## English

Current tags: https://github.com/spacesarmat/omp/releases

<!-- versions:start -->
${en}
<!-- versions:end -->
`;

describe('supported release tags', () => {
  it('parses stable and beta tags and ignores other names', () => {
    expect(parseReleaseTag('v0.30.2')?.tag).toBe('v0.30.2');
    expect(parseReleaseTag('0.30.2-beta.3')?.tag).toBe('v0.30.2-beta.3');
    expect(parseReleaseTag('v0.30.2-rc.1')).toBeNull();
    expect(parseReleaseTag('desktop-0.30.2')).toBeNull();
  });

  it('reads tag names from ls-remote and skips peeled annotated tags', () => {
    const text = [
      'abc\trefs/tags/v0.30.1',
      'def\trefs/tags/v0.30.1^{}',
      'ghi\trefs/tags/v0.30.2-beta.3',
      'jkl\trefs/heads/main',
    ].join('\n');
    expect(tagsFromLsRemote(text)).toEqual(['v0.30.1', 'v0.30.2-beta.3']);
  });

  it('keeps a beta only when it is newer than the latest stable', () => {
    const olderBeta = pickSupported(['v0.30.1', 'v0.30.1-beta.17', 'v0.30.2-beta.3']);
    expect(olderBeta.stable?.tag).toBe('v0.30.1');
    expect(olderBeta.beta?.tag).toBe('v0.30.2-beta.3');

    const shipped = pickSupported(['v0.30.2', 'v0.30.2-beta.3', 'v0.30.1']);
    expect(shipped.stable?.tag).toBe('v0.30.2');
    expect(shipped.beta).toBeNull();

    const next = pickSupported(['v0.30.2', 'v0.30.2-beta.3', 'v0.30.3-beta.1']);
    expect(next.stable?.tag).toBe('v0.30.2');
    expect(next.beta?.tag).toBe('v0.30.3-beta.1');
  });

  it('counts an unreleased package version the same way as a tag', () => {
    const picked = pickSupported(['v0.30.2', 'v0.30.2-beta.3', '0.30.3-beta.1']);
    expect(picked.beta?.tag).toBe('v0.30.3-beta.1');
    const stable = pickSupported(['v0.30.2', 'v0.30.3-beta.2', '0.30.3']);
    expect(stable.stable?.tag).toBe('v0.30.3');
    expect(stable.beta).toBeNull();
  });
});

describe('SECURITY.md version blocks', () => {
  const before = policy(
    '- последний стабильный релиз, сейчас [v0.30.0](https://github.com/spacesarmat/omp/releases/tag/v0.30.0)\n- текущая бета, сейчас [v0.30.1-beta.3](https://github.com/spacesarmat/omp/releases/tag/v0.30.1-beta.3)',
    '- latest stable release, currently [v0.30.0](https://github.com/spacesarmat/omp/releases/tag/v0.30.0)\n- current beta, currently [v0.30.1-beta.3](https://github.com/spacesarmat/omp/releases/tag/v0.30.1-beta.3)',
  );

  it('rewrites both languages and says when there is no current beta', () => {
    const picked = pickSupported(['v0.30.2', 'v0.30.2-beta.3']);
    const next = applySecurityVersions(before, picked);
    expect(next).toContain('https://github.com/spacesarmat/omp/releases\n');
    expect(next).toContain('[v0.30.2](https://github.com/spacesarmat/omp/releases/tag/v0.30.2)');
    expect(next).toContain('- текущей беты нет');
    expect(next).toContain('- there is no current beta');
    expect(next).not.toContain('v0.30.0');
    expect(next).not.toContain('v0.30.1-beta.3');
    expect(next).toBe(applySecurityVersions(next, picked));
  });

  it('keeps a newer beta in both blocks', () => {
    const picked = pickSupported(['v0.30.1', 'v0.30.2-beta.3']);
    const next = applySecurityVersions(before, picked);
    expect(next).toContain(renderVersionBlock(picked, 'ru'));
    expect(next).toContain(renderVersionBlock(picked, 'en'));
    expect(next.match(/<!-- versions:start -->/g)).toHaveLength(2);
  });

  it('refuses a policy without both marker blocks', () => {
    expect(() => applySecurityVersions('# Политика\n', pickSupported(['v0.30.2']))).toThrow(/two versions blocks/);
  });
});

describe('stable release version', () => {
  it('strips a beta suffix and leaves a stable version', () => {
    expect(stableVersion('0.30.2-beta.3')).toBe('0.30.2');
    expect(stableVersion('0.30.2')).toBe('0.30.2');
    expect(() => stableVersion('0.30.2-rc.1')).toThrow(/Bad version/);
  });

  it('renames the released heading and refuses a duplicate', () => {
    const md = '## Не выпущено\n\n- новое\n\n## 0.30.2-beta.3\n\n- бета\n';
    expect(renameReleaseHeading(md, '0.30.2-beta.3', '0.30.2')).toContain('## 0.30.2\n');
    expect(renameReleaseHeading(md, '0.30.2-beta.3', '0.30.2-beta.3')).toBe(md);
    expect(() => renameReleaseHeading('## 0.30.2\n\n## 0.30.2-beta.3\n', '0.30.2-beta.3', '0.30.2')).toThrow(/already present/);
  });
});

describe('release pull requests update SECURITY.md', () => {
  const bump = readFileSync('scripts/omp-release-bump.mjs', 'utf8');
  const stable = readFileSync('scripts/omp-release-stable.mjs', 'utf8');
  const release = readFileSync('.github/workflows/release.yml', 'utf8');

  it('beta and stable release scripts refresh the policy and do not push', () => {
    expect(bump).toContain('syncSecurityPolicy');
    expect(stable).toContain('syncSecurityPolicy');
    expect(bump).not.toContain('git push');
    expect(stable).not.toContain('git push');
    expect(release).not.toContain('SECURITY.md');
    expect(release).not.toContain('security-versions');
  });

  it('TorrServer and 2160 Player commits include SECURITY.md and still open a pull request', () => {
    for (const name of ['torrserver-update.yml', 'player2160-update.yml']) {
      const yml = readFileSync('.github/workflows/' + name, 'utf8');
      expect(yml).toContain('node scripts/omp-release-bump.mjs');
      expect(yml).toContain('SECURITY.md');
      expect(yml).toContain('gh pr create');
      expect(yml).not.toContain('HEAD:main');
    }
  });
});
