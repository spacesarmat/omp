import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_MONITOR,
  LAST_RUN_KEY,
  MONITOR_KEY,
  loadLastRun,
  loadMonitorSettings,
  sanitizeSummary,
  saveLastRun,
  saveMonitorSettings,
} from '../../src/monitor/settings';
import { FEED_FRESH_MS, FEED_MAX, feedFresh, loadFeed, saveFeed } from '../../src/monitor/feedCache';
import type { SourceResult } from '../../src/sources/types';

function res(Title: string): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 1, source: 'rutor' };
}

beforeEach(() => {
  localStorage.clear();
});

describe('monitor settings', () => {
  it('defaults: on, every 3 hours, Wi-Fi only, new episodes watched', () => {
    expect(loadMonitorSettings()).toEqual({ enabled: true, hours: 3, wifiOnly: true, episodes: true });
    expect(DEFAULT_MONITOR.hours).toBe(3);
  });

  it('saves a patch; bad values fall back', () => {
    expect(saveMonitorSettings({ hours: 6, wifiOnly: false })).toEqual({ enabled: true, hours: 6, wifiOnly: false, episodes: true });
    expect(loadMonitorSettings().hours).toBe(6);
    localStorage.setItem(MONITOR_KEY, JSON.stringify({ enabled: 'yes', hours: 5, episodes: false }));
    expect(loadMonitorSettings()).toEqual({ enabled: true, hours: 3, wifiOnly: true, episodes: false });
    localStorage.setItem(MONITOR_KEY, '{broken');
    expect(loadMonitorSettings()).toEqual(DEFAULT_MONITOR);
  });

  it('last run round trip and sanitizing', () => {
    expect(loadLastRun()).toBeNull();
    const s = { at: 5, kind: 'check' as const, found: 1, notified: 1, answered: 2, asked: 3, subs: 1, skipped: 0, feed: true };
    saveLastRun(s);
    expect(loadLastRun()).toEqual(s);
    localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ at: 'x' }));
    expect(loadLastRun()).toBeNull();
    expect(sanitizeSummary({ at: 1, kind: 'action', found: -1, action: { ok: true, message: 'Заменено', title: 'T' }, error: '' })).toEqual({
      at: 1,
      kind: 'action',
      found: 0,
      notified: 0,
      answered: 0,
      asked: 0,
      subs: 0,
      skipped: 0,
      feed: false,
      action: { ok: true, message: 'Заменено', title: 'T' },
    });
  });
});

describe('feed cache', () => {
  it('per category, capped, fresh for 10 minutes', () => {
    expect(loadFeed('movie')).toBeNull();
    const list = [];
    for (let i = 0; i < FEED_MAX + 5; i++) list.push(res('R' + i));
    saveFeed('movie', list, 1000);
    saveFeed('tv', [res('S')], 2000);
    expect(loadFeed('movie')!.results).toHaveLength(FEED_MAX);
    expect(loadFeed('tv')).toEqual({ at: 2000, results: [res('S')] });
    expect(feedFresh('tv', 2000 + FEED_FRESH_MS - 1)).toBe(true);
    expect(feedFresh('tv', 2000 + FEED_FRESH_MS)).toBe(false);
    expect(feedFresh('anime', 2000)).toBe(false);
  });
});
