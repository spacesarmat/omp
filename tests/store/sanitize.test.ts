import { describe, it, expect } from 'vitest';
import { sanitizeServers } from '../../src/store/servers';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../src/store/settings';
import { sanitizeProgress } from '../../src/store/progress';
import { sanitizeTorrents } from '../../src/store/library';

describe('sanitizeServers', () => {
  it('keeps only well-formed entries', () => {
    const ok = { id: 'a', name: 'A', url: 'http://h:1' };
    expect(sanitizeServers([ok, null, 'x', { id: 1, name: 'B', url: 'u' }, { id: 'c', url: 'u' }])).toEqual([ok]);
  });
  it('returns [] for non-arrays', () => {
    expect(sanitizeServers(null)).toEqual([]);
    expect(sanitizeServers({ id: 'a' })).toEqual([]);
  });
});

describe('sanitizeSettings', () => {
  it('fills defaults and keeps only typed fields', () => {
    const s = sanitizeSettings({ seekStep: 30, audioLang: 5, autoNext: 'yes', subSize: 'huge', subColor: 'yellow', extra: 1 });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, seekStep: 30, subColor: 'yellow' });
  });
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });
  it('validates edgeSeekStep', () => {
    expect(sanitizeSettings({ edgeSeekStep: 10 }).edgeSeekStep).toBe(10);
    expect(sanitizeSettings({ edgeSeekStep: 7 }).edgeSeekStep).toBe(5);
  });
  it('validates library view and sort', () => {
    expect(sanitizeSettings({ librarySort: 'size', libraryView: 'list' }).librarySort).toBe('size');
    expect(sanitizeSettings({ libraryView: 'list' }).libraryView).toBe('list');
    expect(sanitizeSettings({ librarySort: 'bogus' }).librarySort).toBe('new');
    expect(sanitizeSettings({ libraryView: 'huge' }).libraryView).toBe('large');
    expect(sanitizeSettings({}).libraryView).toBe('large');
  });
  it('validates the player engine (Android TV «Плеер»)', () => {
    expect(DEFAULT_SETTINGS.playerEngine).toBe('auto');
    expect(sanitizeSettings({ playerEngine: 'vlc' }).playerEngine).toBe('vlc');
    expect(sanitizeSettings({ playerEngine: 'builtin' }).playerEngine).toBe('builtin');
    expect(sanitizeSettings({ playerEngine: 'mpv' }).playerEngine).toBe('auto');
    expect(sanitizeSettings({ playerEngine: 1 }).playerEngine).toBe('auto');
  });
});

describe('sanitizeProgress', () => {
  it('keeps entries with finite numbers', () => {
    const good = { time: 10, duration: 100, updated: 1 };
    expect(sanitizeProgress({ 'h:1': good, 'h:2': { time: 'x', duration: 1, updated: 1 }, 'h:3': null, 'h:4': { time: NaN, duration: 1, updated: 1 } }))
      .toEqual({ 'h:1': good });
    expect(sanitizeProgress([good])).toEqual({});
    expect(sanitizeProgress(null)).toEqual({});
  });
});

describe('sanitizeTorrents', () => {
  it('keeps objects with string hash', () => {
    const t = { hash: 'a', title: 'T', stat: 5 };
    expect(sanitizeTorrents([t, { title: 'x' }, null, 3])).toEqual([t]);
    expect(sanitizeTorrents('x')).toEqual([]);
  });
});
