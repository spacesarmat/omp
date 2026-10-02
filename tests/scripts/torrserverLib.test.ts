import { describe, it, expect } from 'vitest';
import { parseVersionFile, pickAsset, parseDigest, ASSET_NAME } from '../../scripts/torrserver-lib.mjs';

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
});
