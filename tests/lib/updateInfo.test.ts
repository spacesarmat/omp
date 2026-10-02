import { describe, it, expect } from 'vitest';
import { sanitizeUpdateInfo, UPDATE_URL, ANDROID_UPDATE_URL, HB_REPO_URL, RELEASES_URL, HB_SITE_URL } from '../../src/lib/updateInfo';

const HASH = 'a'.repeat(64);
const good = {
  version: '0.6.1',
  ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v0.6.1/com.spacesarmat.torrplayer_0.6.1_all.ipk',
  ipkHash: HASH.toUpperCase(),
  ipkSize: 99000,
  notes: ['Окно обновления', 3, 'Параметры запуска'],
  releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.6.1',
};

describe('sanitizeUpdateInfo', () => {
  it('accepts a valid feed and normalizes it', () => {
    expect(sanitizeUpdateInfo(good)).toEqual({ ...good, ipkHash: HASH, notes: ['Окно обновления', 'Параметры запуска'] });
  });
  it('fills optional fields', () => {
    const r = sanitizeUpdateInfo({ version: good.version, ipkUrl: good.ipkUrl, ipkHash: HASH });
    expect(r).toEqual({ version: '0.6.1', ipkUrl: good.ipkUrl, ipkHash: HASH, ipkSize: 0, notes: [], releaseUrl: RELEASES_URL });
  });
  it('rejects broken feeds', () => {
    expect(sanitizeUpdateInfo(null)).toBeNull();
    expect(sanitizeUpdateInfo('x')).toBeNull();
    expect(sanitizeUpdateInfo({ ...good, version: 'latest' })).toBeNull();
    expect(sanitizeUpdateInfo({ ...good, ipkUrl: 'http://insecure/x.ipk' })).toBeNull();
    expect(sanitizeUpdateInfo({ ...good, ipkHash: 'abc' })).toBeNull();
    expect(sanitizeUpdateInfo({ ...good, releaseUrl: 'ftp://x' })!.releaseUrl).toBe(RELEASES_URL);
  });
  it('exposes the feed urls', () => {
    expect(ANDROID_UPDATE_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update-android.json');
    expect(UPDATE_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update.json');
    expect(HB_REPO_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json');
    expect(HB_SITE_URL).toBe('https://www.webosbrew.org/');
  });
});
