import { describe, it, expect } from 'vitest';
import { changelogNotes, buildHomebrew, buildAndroidUpdate, apkAbi, splitApks, APP_ID, FEED_BASE } from '../../scripts/hb-lib.mjs';
import { sanitizeUpdateInfo } from '../../src/lib/updateInfo';

const MD = '# Изменения\n\n## 0.6.0\n\n- Окно обновления\n* Параметры запуска\n\n## 0.5.0\n\n- Новый каталог\n';

describe('hb-lib', () => {
  it('extracts notes for one version', () => {
    expect(changelogNotes(MD, '0.6.0')).toEqual(['Окно обновления', 'Параметры запуска']);
    expect(changelogNotes(MD, '0.5.0')).toEqual(['Новый каталог']);
    expect(changelogNotes(MD, '0.4.0')).toEqual([]);
    expect(changelogNotes(MD.replace(/\n/g, '\r\n'), '0.6.0')).toHaveLength(2);
  });
  it('builds manifest, repository and update feed', () => {
    const sha = 'e'.repeat(64);
    const r = buildHomebrew({
      tag: 'v0.6.0', version: '0.6.0', ipkName: 'OMP-0.6.0-webOS.ipk', sha256: sha, size: 123,
      title: 'OMP', description: 'Open Movie Player', notes: ['Окно обновления'],
    }) as any;
    const ipkUrl = 'https://github.com/spacesarmat/omp/releases/download/v0.6.0/OMP-0.6.0-webOS.ipk';
    expect(r.manifest).toEqual({
      id: APP_ID, version: '0.6.0', type: 'web', title: 'OMP', appDescription: 'Open Movie Player',
      iconUri: 'https://raw.githubusercontent.com/spacesarmat/omp/main/webos/largeIcon.png',
      sourceUrl: 'https://github.com/spacesarmat/omp', rootRequired: false, ipkUrl, ipkHash: { sha256: sha }, ipkSize: 123,
    });
    expect(r.apps.packages).toHaveLength(1);
    expect(r.apps.packages[0]).toMatchObject({
      id: APP_ID, title: 'OMP', pool: 'main', shortDescription: 'Open Movie Player', fullDescriptionUrl: 'full_description.html',
      manifestUrl: FEED_BASE + APP_ID + '.manifest.json', manifest: r.manifest,
    });
    expect(r.update).toEqual({
      version: '0.6.0', ipkUrl, ipkHash: sha, ipkSize: 123, notes: ['Окно обновления'],
      releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.6.0',
    });
    expect(sanitizeUpdateInfo(r.update)).toEqual(r.update);
  });
  it('builds the Android update feed', () => {
    const sha = 'a'.repeat(64);
    const u = buildAndroidUpdate({ tag: 'v0.7.0', version: '0.7.0', apkName: 'OMP-0.7.0.apk', sha256: sha, size: 456, notes: ['Android'] }) as any;
    expect(u).toEqual({
      version: '0.7.0', ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v0.7.0/OMP-0.7.0.apk',
      ipkHash: sha, ipkSize: 456, notes: ['Android'], releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.7.0',
    });
    expect(sanitizeUpdateInfo(u)).toEqual(u);
  });
  it('builds per-ABI entries and keeps the universal APK in the legacy fields', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((x) => x.repeat(64));
    const rel = 'https://github.com/spacesarmat/omp/releases/download/v0.15.0/';
    const u = buildAndroidUpdate({
      tag: 'v0.15.0', version: '0.15.0', apkName: 'OMP-0.15.0.apk', sha256: a, size: 900, notes: ['Плеер VLC'],
      abis: { arm64: { name: 'OMP-0.15.0-arm64.apk', sha256: b, size: 600 }, armv7: { name: 'OMP-0.15.0-armv7.apk', sha256: c, size: 300 } },
    }) as any;
    expect(u).toEqual({
      version: '0.15.0', ipkUrl: rel + 'OMP-0.15.0.apk', ipkHash: a, ipkSize: 900,
      apks: { arm64: { url: rel + 'OMP-0.15.0-arm64.apk', sha256: b, size: 600 }, armv7: { url: rel + 'OMP-0.15.0-armv7.apk', sha256: c, size: 300 } },
      notes: ['Плеер VLC'], releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.15.0',
    });
    expect(sanitizeUpdateInfo(u)).toEqual(u);
  });
  it('omits apks without per-ABI files and ignores unknown ABIs', () => {
    const sha = 'a'.repeat(64);
    const base = { tag: 'v0.15.0', version: '0.15.0', apkName: 'OMP-0.15.0.apk', sha256: sha, size: 1, notes: [] };
    expect('apks' in (buildAndroidUpdate({ ...base, abis: {} }) as any)).toBe(false);
    const u = buildAndroidUpdate({ ...base, abis: { x86: { name: 'OMP-0.15.0-x86.apk', sha256: sha, size: 1 } } as any }) as any;
    expect(u.apks).toBeUndefined();
  });
  it('routes command-line APK paths by file name', () => {
    expect(splitApks([])).toBeNull();
    expect(splitApks(['build/OMP-0.15.0-armv7.apk', 'build/OMP-0.15.0.apk', 'build\\OMP-0.15.0-arm64.apk'])).toEqual({
      universal: 'build/OMP-0.15.0.apk',
      abis: { armv7: 'build/OMP-0.15.0-armv7.apk', arm64: 'build\\OMP-0.15.0-arm64.apk' },
    });
    expect(splitApks(['build/OMP-0.15.0.apk'])).toEqual({ universal: 'build/OMP-0.15.0.apk', abis: {} });
    expect(() => splitApks(['build/OMP-0.15.0-arm64.apk'])).toThrow('universal APK');
    expect(() => splitApks(['a/OMP-0.15.0.apk', 'b/OMP-0.15.0.apk'])).toThrow('two APKs');
    expect(() => splitApks(['a/OMP-0.15.0-arm64.apk', 'b/OMP-0.15.0-arm64.apk', 'OMP-0.15.0.apk'])).toThrow('two APKs');
  });
  it('tells per-ABI APK names from the universal one', () => {
    expect(apkAbi('OMP-0.15.0-arm64.apk')).toBe('arm64');
    expect(apkAbi('OMP-0.15.0-armv7.apk')).toBe('armv7');
    expect(apkAbi('OMP-0.15.0.apk')).toBeNull();
    expect(apkAbi('OMP-0.15.0-webOS.ipk')).toBeNull();
  });
});
