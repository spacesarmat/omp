import { describe, it, expect } from 'vitest';
import { sanitizeUpdateInfo, UPDATE_URL, ANDROID_UPDATE_URL, HB_REPO_URL, RELEASES_URL, HB_SITE_URL, updateFeedUrl, updateNotes, updateTitle } from '../../src/lib/updateInfo';

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
  it('keeps valid per-ABI APKs and drops broken ones', () => {
    const B = 'b'.repeat(64);
    const arm64 = { url: 'https://github.com/spacesarmat/omp/releases/download/v0.15.0/OMP-0.15.0-arm64.apk', sha256: B.toUpperCase(), size: 600 };
    const r = sanitizeUpdateInfo({ ...good, apks: { arm64, armv7: { url: 'http://x/a.apk', sha256: B, size: 1 }, x86: arm64 } });
    expect(r!.apks).toEqual({ arm64: { ...arm64, sha256: B } });
    expect(r!.ipkUrl).toBe(good.ipkUrl);
    const noSize = sanitizeUpdateInfo({ ...good, apks: { armv7: { url: arm64.url, sha256: B, size: -5 } } });
    expect(noSize!.apks).toEqual({ armv7: { url: arm64.url, sha256: B, size: 0 } });
  });
  it('ignores a malformed apks object without rejecting the feed', () => {
    for (const apks of [null, 'x', [], { arm64: 'x' }, { arm64: { url: good.ipkUrl, sha256: 'abc' } }, { armv7: { sha256: 'b'.repeat(64) } }]) {
      const r = sanitizeUpdateInfo({ ...good, apks });
      expect(r).not.toBeNull();
      expect('apks' in r!).toBe(false);
    }
  });
  it('exposes the feed urls', () => {
    expect(ANDROID_UPDATE_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update-android.json');
    expect(UPDATE_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update.json');
    expect(HB_REPO_URL).toBe('https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json');
    expect(HB_SITE_URL).toBe('https://www.webosbrew.org/');
  });
});

describe('update notes per platform', () => {
  it('the platform list when the feed has one, «Исправления и улучшения» when it is empty', () => {
    const info = sanitizeUpdateInfo({ ...good, notes: ['Пульт'], notesTv: ['Пульт', 5], notesPhone: [] })!;
    expect(info.notesTv).toEqual(['Пульт']);
    expect(updateNotes(info, 'tv')).toEqual(['Пульт']);
    expect(updateNotes(info, 'phone')).toEqual(['Исправления и улучшения']);
  });

  it('an older feed: its `notes`, a stray marker of the other platform dropped and none shown', () => {
    const info = sanitizeUpdateInfo({ ...good, notes: ['[phone] Календарь', '[tv] Пульт', 'Общее'] })!;
    expect(info.notesTv).toBeUndefined();
    expect(updateNotes(info, 'tv')).toEqual(['Пульт', 'Общее']);
    expect(updateNotes(info, 'phone')).toEqual(['Календарь', 'Общее']);
    expect(updateNotes(sanitizeUpdateInfo({ ...good, notes: [] })!, 'tv')).toEqual([]);
  });
});

describe('beta feeds and titles', () => {
  it('picks the feed by platform and the beta switch', () => {
    const B = 'https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/';
    expect(updateFeedUrl(true, false)).toBe(B + 'update-android.json');
    expect(updateFeedUrl(true, true)).toBe(B + 'update-android-beta.json');
    expect(updateFeedUrl(false, false)).toBe(B + 'update.json');
    expect(updateFeedUrl(false, true)).toBe(B + 'update-beta.json');
  });
  it('accepts a beta version in the feed', () => {
    const v = sanitizeUpdateInfo({ version: '0.16.0-beta.1', ipkUrl: 'https://x/a.ipk', ipkHash: 'a'.repeat(64) });
    expect(v && v.version).toBe('0.16.0-beta.1');
    expect(sanitizeUpdateInfo({ version: '0.16.0-rc1', ipkUrl: 'https://x/a.ipk', ipkHash: 'a'.repeat(64) })).toBeNull();
  });
  it('titles a beta, a release over a beta and a plain update', () => {
    expect(updateTitle('0.16.0-beta.2', '0.15.3')).toBe('Доступна бета 0.16.0-beta.2');
    expect(updateTitle('0.16.0', '0.16.0-beta.2')).toBe('Вышла OMP 0.16.0 — она заменит бету');
    expect(updateTitle('0.15.4', '0.15.3')).toBe('Доступна версия 0.15.4');
  });
});
