import { describe, it, expect } from 'vitest';
import { androidVersionCode, compareVersions, isBetaVersion } from '../../src/lib/version';

describe('compareVersions', () => {
  it('compares numerically part by part', () => {
    expect(compareVersions('0.6.0', '0.5.0')).toBe(1);
    expect(compareVersions('0.5.0', '0.6.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('v0.6.1', '0.6.1')).toBe(0);
    expect(compareVersions(' 0.6.2 ', 'v0.6.1')).toBe(1);
  });
  it('treats junk parts as zero', () => {
    expect(compareVersions('0.x.1', '0.0.1')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
  });
  it('a beta comes before its release and after the versions below it', () => {
    expect(compareVersions('0.16.0-beta.1', '0.16.0')).toBe(-1);
    expect(compareVersions('0.16.0', '0.16.0-beta.2')).toBe(1);
    expect(compareVersions('0.16.0-beta.1', '0.15.3')).toBe(1);
    expect(compareVersions('0.15.4', '0.16.0-beta.1')).toBe(-1);
    expect(compareVersions('0.16.0-beta.2', '0.16.0-beta.1')).toBe(1);
    expect(compareVersions('0.16.0-beta.10', '0.16.0-beta.9')).toBe(1);
    expect(compareVersions('v0.16.0-beta.1', '0.16.0-beta.1')).toBe(0);
  });
  it('tells a beta', () => {
    expect(isBetaVersion('0.16.0-beta.1')).toBe(true);
    expect(isBetaVersion('0.16.0')).toBe(false);
  });
});

describe('androidVersionCode', () => {
  it('gives each beta its own code and keeps a stable release above them', () => {
    expect(androidVersionCode('0.20.3')).toBe(200399);
    expect(androidVersionCode('0.20.4-beta.1')).toBe(200401);
    expect(androidVersionCode('0.20.4-beta.2')).toBe(200402);
    expect(androidVersionCode('v0.20.4')).toBe(200499);
    expect(androidVersionCode('0.20.5-beta.1')).toBe(200501);
    expect(androidVersionCode('0.20.4-beta.1')).toBeLessThan(androidVersionCode('0.20.4-beta.2'));
    expect(androidVersionCode('0.20.4-beta.2')).toBeLessThan(androidVersionCode('0.20.4'));
    expect(androidVersionCode('0.20.4')).toBeLessThan(androidVersionCode('0.20.5-beta.1'));
    expect(androidVersionCode('0.20.4-beta.99')).toBe(200498);
    expect(androidVersionCode('nope')).toBe(0);
  });
});
