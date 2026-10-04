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
  setRootVersion,
  pinFromRelease,
  parsePin,
  formatPin,
  PIN_PATH,
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
    expect(() => bumpPatch('0.9')).toThrow();
  });
  it('inserts a changelog entry above the latest version', () => {
    const text = '# Изменения\n\n## 0.8.2\n\n- a\n';
    expect(insertChangelog(text, '0.8.3', 'MatriX.146')).toBe(
      '# Изменения\n\n## 0.8.3\n\n- Встроенный TorrServer обновлён до MatriX.146\n\n## 0.8.2\n\n- a\n',
    );
    const crlf = insertChangelog(text.replace(/\n/g, '\r\n'), '0.8.3', 'T');
    expect(crlf).toContain('## 0.8.3\r\n\r\n- Встроенный TorrServer обновлён до T\r\n\r\n## 0.8.2');
    expect(crlf).not.toMatch(/[^\r]\n/);
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
});
