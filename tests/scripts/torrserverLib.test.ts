import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import {
  parseVersionFile,
  pickAsset,
  parseDigest,
  ASSET_NAME,
  bumpPatch,
  insertChangelog,
  insertUnreleased,
  torrserverNote,
  setRootVersion,
  pinFromRelease,
  parsePin,
  formatPin,
  PIN_PATH,
  assessRelease,
  compareMatrix,
  windowsPin,
  readRustPin,
  writeRustPin,
  patchPinLiteral,
  patchDesktopTest,
  rustNum,
  releaseSummary,
} from '../../scripts/torrserver-lib.mjs';

describe('torrserver-lib', () => {
  it('parses the version file', () => {
    expect(parseVersionFile('MatriX.145.1\n')).toBe('MatriX.145.1');
    expect(parseVersionFile('  MatriX.145.1 \r\n')).toBe('MatriX.145.1');
    expect(() => parseVersionFile('\n')).toThrow();
    expect(() => parseVersionFile('bad tag')).toThrow();
  });
  it('picks the arm64 asset', () => {
    const a = { name: ASSET_NAME, digest: 'sha256:' + 'a'.repeat(64) };
    expect(ASSET_NAME).toBe('TorrServer-android-arm64');
    expect(pickAsset({ assets: [{ name: 'TorrServer-android-arm7' }, a] })).toBe(a);
    expect(() => pickAsset({ assets: [] })).toThrow(/TorrServer-android-arm64/);
    expect(() => pickAsset({})).toThrow();
  });
  it('parses the digest', () => {
    const h = 'AbCdEf0123456789'.repeat(4);
    expect(parseDigest('sha256:' + h)).toBe(h.toLowerCase());
    expect(() => parseDigest(undefined)).toThrow(/digest/);
    expect(() => parseDigest('sha1:' + 'a'.repeat(40))).toThrow(/digest/);
    expect(() => parseDigest('sha256:abc')).toThrow(/digest/);
  });

  it('bumps the patch version', () => {
    expect(bumpPatch('0.8.2')).toBe('0.8.3');
    expect(bumpPatch('0.9.9')).toBe('0.9.10');
    expect(bumpPatch('  0.20.2  ')).toBe('0.20.3');
    expect(() => bumpPatch('0.9')).toThrow(/Bad version/);
    expect(() => bumpPatch('0.20.2-rc.1')).toThrow(/Bad version/);
    expect(() => bumpPatch('')).toThrow(/Bad version/);
  });
  it('releases a pending stable from a beta instead of stepping the patch', () => {
    expect(bumpPatch('0.20.2-beta.2')).toBe('0.20.2');
    expect(bumpPatch('0.20.1-beta.15')).toBe('0.20.1');
    expect(bumpPatch('  0.8.2-beta.0 \n')).toBe('0.8.2');
    expect(() => bumpPatch('0.20.2-beta')).toThrow(/Bad version/);
    expect(() => bumpPatch('0.20.2-beta.2.1')).toThrow(/Bad version/);
  });
  it('inserts a changelog entry above the latest version', () => {
    const text = '# Изменения\n\n## 0.8.2\n\n- a\n';
    expect(insertChangelog(text, '0.8.3', 'MatriX.146')).toBe(
      '# Изменения\n\n## 0.8.3\n\n- Встроенный TorrServer обновлён до MatriX.146\n\n## 0.8.2\n\n- a\n',
    );
    const crlf = insertChangelog(text.replace(/\n/g, '\r\n'), '0.8.3', 'T');
    expect(crlf).toContain('## 0.8.3\r\n\r\n- Встроенный TorrServer обновлён до T\r\n\r\n## 0.8.2');
    expect(crlf).not.toMatch(/[^\r]\n/);
    const en = insertChangelog('# Changes\n\n## 0.8.2\n\n- a\n', '0.8.3', 'MatriX.147', torrserverNote('MatriX.147', true));
    expect(en).toContain('- The built-in TorrServer is updated to MatriX.147\n\n## 0.8.2');
    expect(en).not.toMatch(/[А-Яа-яЁё]/);
  });
  it('replaces only the root version fields', () => {
    const lock = '{\n  "name": "omp",\n  "version": "0.8.2",\n  "packages": {\n    "": {\n      "name": "omp",\n      "version": "0.8.2",\n      "dependencies": {}\n    },\n    "node_modules/x": {\n      "version": "0.8.2"\n    }\n  }\n}\n';
    const out = setRootVersion(lock, '0.8.3', true);
    expect(out.match(/0\.8\.3/g)).toHaveLength(2);
    expect(out.match(/0\.8\.2/g)).toHaveLength(1);
    expect(setRootVersion('{\n  "id": "x",\n  "version": "0.8.2",\n  "a": {"version": "0.8.2"}\n}\n', '0.8.3')).toContain('"version": "0.8.3"');
  });
  const sha = 'ab'.repeat(32);
  const url = 'https://github.com/YouROK/TorrServer/releases/download/MatriX.146/TorrServer-android-arm64';
  const release = {
    tag_name: 'MatriX.146',
    assets: [
      { name: 'TorrServer-android-arm7', size: 1, digest: 'sha256:' + 'c'.repeat(64), browser_download_url: 'x' },
      { name: ASSET_NAME, size: 64174032, digest: 'sha256:' + sha.toUpperCase(), browser_download_url: url },
    ],
  };

  it('builds the pin from a release', () => {
    expect(pinFromRelease(release, 'MatriX.146')).toEqual({ tag: 'MatriX.146', asset: ASSET_NAME, url, sha256: sha, size: 64174032 });
    expect(() => pinFromRelease(release, 'MatriX.147')).toThrow(/MatriX.147/);
    expect(() => pinFromRelease({ ...release, assets: [{ ...release.assets[1], size: 0 }] }, 'MatriX.146')).toThrow(/size/);
    const foreign = { ...release, assets: [{ ...release.assets[1], browser_download_url: 'https://evil.example/ts' }] };
    expect(() => pinFromRelease(foreign, 'MatriX.146')).toThrow(/url/);
  });

  it('round-trips the pin file and checks it against torrserver.version', () => {
    const text = formatPin(pinFromRelease(release, 'MatriX.146'));
    expect(text.endsWith('}\n')).toBe(true);
    expect(parsePin(text, 'MatriX.146').sha256).toBe(sha);
    expect(() => parsePin(text, 'MatriX.145.1')).toThrow(/torrserver-bump/);
    expect(() => parsePin('{', 'MatriX.146')).toThrow(/JSON/);
    expect(() => parsePin(JSON.stringify({ ...JSON.parse(text), sha256: 'zz' }), 'MatriX.146')).toThrow(/sha256/);
  });

  it('the committed pin matches torrserver.version', () => {
    const tag = parseVersionFile(readFileSync('torrserver.version', 'utf8'));
    expect(parsePin(readFileSync(PIN_PATH, 'utf8'), tag).tag).toBe(tag);
  });
  it('puts the TorrServer line under «Не выпущено» without a version', () => {
    const ru = '# Изменения\n\n<!-- m -->\n\n## 0.20.6-beta.4\n\n- a\n';
    const once = insertUnreleased(ru, torrserverNote('MatriX.147.1'));
    expect(once).toBe('# Изменения\n\n<!-- m -->\n\n## Не выпущено\n\n- Встроенный TorrServer обновлён до MatriX.147.1\n\n## 0.20.6-beta.4\n\n- a\n');
    // a second bump before the release replaces the line instead of adding one more
    expect(insertUnreleased(once, torrserverNote('MatriX.148'))).toBe(once.replace('MatriX.147.1', 'MatriX.148'));
    const en = '# Changes\n\n## Unreleased\n\n- [phone] b\n\n## 0.20.5\n\n- a\n';
    expect(insertUnreleased(en, torrserverNote('MatriX.148', true), true)).toBe(
      '# Changes\n\n## Unreleased\n\n- The built-in TorrServer is updated to MatriX.148\n- [phone] b\n\n## 0.20.5\n\n- a\n',
    );
    expect(insertUnreleased('# Changes\n\n## 0.20.5\n\n- a\n', 'x', true)).toContain('## Unreleased\n\n- x\n\n## 0.20.5');
    const crlf = insertUnreleased(ru.replace(/\n/g, '\r\n'), 'x');
    expect(crlf).toContain('## Не выпущено\r\n\r\n- x\r\n\r\n## 0.20.6-beta.4');
    expect(crlf).not.toMatch(/[^\r]\n/);
  });

  it('compares MatriX tags and skips a release that is not a sane upgrade', () => {
    expect(compareMatrix('MatriX.150', 'MatriX.149')).toBe(1);
    expect(compareMatrix('MatriX.147.2', 'MatriX.147')).toBe(1);
    expect(compareMatrix('MatriX.147.2', 'MatriX.147.2')).toBe(0);
    expect(compareMatrix('MatriX.147', 'nope')).toBeNull();
    const winSha = 'd'.repeat(64);
    const winUrl = 'https://github.com/YouROK/TorrServer/releases/download/MatriX.151/TorrServer-windows-amd64.exe';
    const armUrl = 'https://github.com/YouROK/TorrServer/releases/download/MatriX.151/TorrServer-android-arm64';
    const sane = {
      tag_name: 'MatriX.151',
      assets: [
        { name: ASSET_NAME, size: 64_000_000, digest: 'sha256:' + sha, browser_download_url: armUrl },
        { name: 'TorrServer-windows-amd64.exe', size: 63_000_000, digest: 'sha256:' + winSha, browser_download_url: winUrl },
      ],
    };
    expect(assessRelease(sane, 'MatriX.150').ok).toBe(true);
    expect(assessRelease(sane, 'MatriX.151').ok).toBe(false);
    expect(assessRelease({ ...sane, prerelease: true }, 'MatriX.150').reason).toMatch(/stable/);
    expect(assessRelease({ ...sane, tag_name: 'nightly' }, 'MatriX.150').ok).toBe(false);
    expect(assessRelease({ ...sane, assets: [sane.assets[0]] }, 'MatriX.150').ok).toBe(false);
    expect(windowsPin(sane, 'MatriX.151').sha256).toBe(winSha);
    expect(rustNum(63884288)).toBe('63_884_288');
  });

  it('rewrites the desktop Windows pin without touching other assets', () => {
    const rust = [
      'id: "torrserver".to_string(),',
      '            version: "MatriX.150".to_string(),',
      '            url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.150/TorrServer-windows-amd64.exe".to_string(),',
      '            sha256: "' + 'a'.repeat(64) + '".to_string(),',
      '            max_bytes: 63_884_288,',
      'id: "mpv".to_string(),',
      '            version: "keep".to_string(),',
    ].join('\n');
    const prev = readRustPin(rust);
    expect(prev.tag).toBe('MatriX.150');
    expect(prev.size).toBe(63884288);
    const pin = {
      tag: 'MatriX.151',
      url: 'https://github.com/YouROK/TorrServer/releases/download/MatriX.151/TorrServer-windows-amd64.exe',
      sha256: 'b'.repeat(64),
      size: 64000000,
    };
    const next = writeRustPin(rust, pin);
    expect(next).toContain('version: "MatriX.151"');
    expect(next).toContain('max_bytes: 64_000_000,');
    expect(next).toContain('version: "keep"');
    expect(patchPinLiteral("pinVersion: 'MatriX.150',\n", 'MatriX.150', 'MatriX.151')).toContain("pinVersion: 'MatriX.151'");
    const test = 'assert_eq!(asset.version, "MatriX.150");\nassert_eq!(asset.max_bytes, 63_884_288);\n';
    expect(patchDesktopTest(test, prev, pin)).toContain('MatriX.151');
    expect(patchDesktopTest(test, prev, pin)).toContain('64_000_000');
    expect(readRustPin(readFileSync('desktop/src-tauri/src/platform.rs', 'utf8')).tag).toBe(
      parseVersionFile(readFileSync('torrserver.version', 'utf8')),
    );
  });

  it('flattens a release body onto hyphens', () => {
    expect(releaseSummary('Hello \u2014 world\n\n* fix ([#1](https://example.com))')).toBe('Hello - world fix');
  });
});
