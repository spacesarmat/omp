import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const yml = readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow asset names', () => {
  it('uses OMP- names for every apk/ipk path', () => {
    const paths = yml.match(/(?<![\w/.])build\/[^\s"']*\.(apk|ipk)/g) || [];
    expect(paths.length).toBeGreaterThan(0);
    paths.forEach((p: string) => {
      if (p.indexOf('com.spacesarmat') >= 0) return; // the packager's own output name
      expect(p).toMatch(/^build\/OMP-\$\{VERSION\}(-webOS)?\.(apk|ipk)$/);
    });
  });

  it('has no lowercase omp- asset and never globs the ipk', () => {
    expect(yml).not.toMatch(/omp-\$/);
    expect(yml).not.toContain('ls build/*.ipk');
  });

  it('renames (not copies) the packaged ipk and the release step defines VERSION, IPK and APK', () => {
    expect(yml).toMatch(/mv "\$\(ls build\/com\.spacesarmat\.torrplayer_\*_all\.ipk\)" "build\/OMP-\$\{VERSION\}-webOS\.ipk"/);
    const step = yml.slice(yml.indexOf('Create GitHub release'));
    expect(step).toContain('VERSION=$(node -p');
    expect(step).toContain('IPK="build/OMP-${VERSION}-webOS.ipk"');
    expect(step).toContain('APK="build/OMP-${VERSION}.apk"');
  });
});
