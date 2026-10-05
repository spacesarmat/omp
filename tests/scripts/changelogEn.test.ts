import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
// @ts-ignore plain .mjs script
import { englishNotes } from '../../scripts/changelog-en.mjs';

const MD = '# Changes\n\n## 0.6.0\n\n- Update window\n* Launch parameters\n\n## 0.5.0\n\n- New library\n';

describe('changelog-en', () => {
  it('prints the bullets of one version', () => {
    expect(englishNotes(MD, '0.6.0')).toBe('- Update window\n- Launch parameters');
    expect(englishNotes(MD, '0.5.0')).toBe('- New library');
  });
  it('prints nothing for a missing version', () => {
    expect(englishNotes(MD, '0.4.0')).toBe('');
    expect(englishNotes('', '0.6.0')).toBe('');
  });
  it('the real CHANGELOG.en.md has the latest versions', () => {
    const md = readFileSync('CHANGELOG.en.md', 'utf8');
    ['0.15.5', '0.15.4', '0.15.3', '0.15.2', '0.15.1', '0.15.0'].forEach((v) => {
      expect(englishNotes(md, v)).not.toBe('');
    });
  });
  it('the release workflow appends the English section from the script', () => {
    const yml = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(yml).toContain('node scripts/changelog-en.mjs "$VERSION"');
    expect(yml).toContain('## English');
  });
});
