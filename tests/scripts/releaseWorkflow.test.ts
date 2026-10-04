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
      expect(p).toMatch(/^build\/OMP-\$\{VERSION\}(-webOS|-arm64|-armv7)?\.(apk|ipk)$/);
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

  it('ships the per-ABI APKs and the universal one, in the release and in the Android feed', () => {
    const build = yml.slice(yml.indexOf('Build signed Android APKs'), yml.indexOf('Homebrew Channel files'));
    expect(build).toContain('cp "$OUT/app-universal-release.apk" "build/OMP-${VERSION}.apk"');
    expect(build).toContain('cp "$OUT/app-arm64-v8a-release.apk" "build/OMP-${VERSION}-arm64.apk"');
    expect(build).toContain('cp "$OUT/app-armeabi-v7a-release.apk" "build/OMP-${VERSION}-armv7.apk"');
    expect(build).toMatch(/ls -l .*-arm64\.apk.*-armv7\.apk/); // size of every APK in the build log
    const hb = yml.slice(yml.indexOf('Homebrew Channel files'), yml.indexOf('Create GitHub release'));
    expect(hb).toContain('"build/OMP-${VERSION}.apk" "build/OMP-${VERSION}-arm64.apk" "build/OMP-${VERSION}-armv7.apk"');
    const step = yml.slice(yml.indexOf('Create GitHub release'), yml.indexOf('Publish update feed'));
    expect(step).toContain('APK64="build/OMP-${VERSION}-arm64.apk"');
    expect(step).toContain('APK32="build/OMP-${VERSION}-armv7.apk"');
    expect(step).toMatch(/gh release create "\$TAG" "\$IPK" "\$APK64" "\$APK32" "\$APK" /);
  });
});
