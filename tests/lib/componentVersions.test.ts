import { describe, it, expect } from 'vitest';
import {
  compareTorr,
  decideOffers,
  isOlder,
  parsePlayerRelease,
  parseTorrRelease,
  pickPlayerApk,
  playerVersionOrNull,
  torrServerVersion,
  type PlayerRelease,
} from '../../src/lib/componentVersions';

const sha = 'ab'.repeat(32);
function apk(name: string) {
  return {
    name,
    size: 19_000_000,
    digest: 'sha256:' + sha,
    browser_download_url: 'https://github.com/spacesarmat/2160player/releases/download/v0.2.25/' + name,
  };
}

const playerRaw = {
  tag_name: 'v0.2.25',
  assets: [
    apk('2160player-0.2.25-arm64-v8a-release.apk'),
    apk('2160player-0.2.25-armeabi-v7a-release.apk'),
    apk('2160player-0.2.25-arm-release.apk'),
    apk('2160player-0.2.25-universal-release.apk'),
  ],
};

describe('component versions', () => {
  it('reads player and TorrServer versions and stays quiet on junk', () => {
    expect(playerVersionOrNull(' 0.2.25 ')).toBe('0.2.25');
    expect(playerVersionOrNull('0.2.25-beta.2')).toBe('0.2.25-beta.2');
    expect(playerVersionOrNull('debug')).toBeNull();
    expect(playerVersionOrNull('0.2')).toBeNull();
    expect(torrServerVersion('MatriX.150\nextra')).toBe('MatriX.150');
    expect(torrServerVersion('1.2.133')).toBe('1.2.133');
    expect(torrServerVersion('<html>')).toBeNull();
    expect(torrServerVersion('MatriX.150 extra')).toBeNull();
    expect(compareTorr('MatriX.149', 'MatriX.150')).toBe(-1);
    expect(compareTorr('MatriX.147', 'MatriX.147.2')).toBe(-1);
    expect(compareTorr('1.2.133', 'MatriX.150')).toBe(-1);
    expect(compareTorr('nope', 'MatriX.150')).toBeNull();
    expect(isOlder('nope', 'MatriX.150', true)).toBe(false);
    expect(isOlder('0.2.24', '0.2.25', false)).toBe(true);
    expect(isOlder('v0.2.25', '0.2.25', false)).toBe(false);
  });

  it('rejects a release whose asset is not the GitHub file for that tag', () => {
    expect(parsePlayerRelease(playerRaw)?.version).toBe('0.2.25');
    expect(parsePlayerRelease({ ...playerRaw, prerelease: true })).toBeNull();
    expect(parsePlayerRelease({ tag_name: 'v0.2.25', assets: [{ ...playerRaw.assets[0], browser_download_url: 'https://evil.example/a.apk' }] })?.assets).toEqual([]);
    expect(parseTorrRelease({ tag_name: 'MatriX.150' })?.releaseUrl).toBe('https://github.com/YouROK/TorrServer/releases/tag/MatriX.150');
    expect(parseTorrRelease({ tag_name: '1.2.133' })).toBeNull();
    const rel = parsePlayerRelease(playerRaw) as PlayerRelease;
    expect(pickPlayerApk(rel, 'arm64')?.name).toContain('arm64-v8a');
    expect(pickPlayerApk(rel, 'armv7')?.name).toContain('armeabi-v7a');
    expect(pickPlayerApk(rel, null)?.name).toContain('-arm-release');
  });

  it('offers an update only when the installed copy is older and was not skipped', () => {
    const offers = decideOffers({
      playerInstalled: '0.2.24',
      playerRelease: playerRaw,
      torr: { version: 'MatriX.149', source: 'remote' },
      torrRelease: { tag_name: 'MatriX.150' },
      abi: 'arm64',
      skipped: {},
    });
    expect(offers.map((o) => o.kind)).toEqual(['player', 'torrserver']);
    expect(offers[0].apk?.url).toContain('arm64-v8a');
    expect(offers[1].installEmbedded).toBeUndefined();
    expect(decideOffers({
      playerInstalled: '0.2.25',
      playerRelease: playerRaw,
      torr: { version: 'MatriX.150', source: 'remote' },
      torrRelease: { tag_name: 'MatriX.150' },
      abi: null,
      skipped: {},
    })).toEqual([]);
    expect(decideOffers({
      playerInstalled: null,
      playerRelease: playerRaw,
      torr: { version: 'garbage', source: 'remote' },
      torrRelease: { tag_name: 'MatriX.150' },
      abi: null,
      skipped: {},
    })).toEqual([]);
    const skipped = decideOffers({
      playerInstalled: '0.2.24',
      playerRelease: playerRaw,
      torr: null,
      torrRelease: null,
      abi: null,
      skipped: { player: '0.2.25' },
    });
    expect(skipped).toEqual([]);
  });

  it('lets the pin sheet own an outdated embedded binary, and installs when the pin is the latest', () => {
    expect(decideOffers({
      playerInstalled: null,
      playerRelease: null,
      torr: { version: 'MatriX.149', source: 'embedded', pin: 'MatriX.150', embeddedOutdated: true },
      torrRelease: { tag_name: 'MatriX.150' },
      abi: null,
      skipped: {},
    })).toEqual([]);
    const embedded = decideOffers({
      playerInstalled: null,
      playerRelease: null,
      torr: { version: 'MatriX.149', source: 'embedded', pin: 'MatriX.150', mobileData: true },
      torrRelease: { tag_name: 'MatriX.150' },
      abi: null,
      skipped: {},
    });
    expect(embedded[0].installEmbedded).toBe(true);
    expect(embedded[0].mobileData).toBe(true);
    const ahead = decideOffers({
      playerInstalled: null,
      playerRelease: null,
      torr: { version: 'MatriX.150', source: 'embedded', pin: 'MatriX.150' },
      torrRelease: { tag_name: 'MatriX.151' },
      abi: null,
      skipped: {},
    });
    expect(ahead[0].installEmbedded).toBeUndefined();
    expect(ahead[0].releaseUrl).toContain('MatriX.151');
  });
});
