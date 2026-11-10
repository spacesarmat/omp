import { afterEach, describe, expect, it } from 'vitest';
import { settings, updateSettings } from '../../src/store/settings';
import { enqueueWatch, flushWatch, resetWatchReport, setWatchPoster, watchClose, watchOpen } from '../../src/viewer/watchReport';

describe('watch report batch', () => {
  afterEach(() => {
    resetWatchReport();
    setWatchPoster(null);
    updateSettings({ helpRank: true });
  });

  it('sends one batch and skips a bad hash', async () => {
    const sent: string[] = [];
    setWatchPoster(async (body) => {
      sent.push(body.payload);
    });
    enqueueWatch({ infohash: 'zz', file: 0, title: 'nope' });
    enqueueWatch({ infohash: 'ab'.repeat(20), file: 1, title: 'Show', watchedPct: 10, ttffMs: 100 });
    flushWatch();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]) as { items: { infohash: string }[]; deviceClass: string };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].infohash).toBe('ab'.repeat(20));
  });

  it('sends nothing when the setting is off', () => {
    const sent: string[] = [];
    setWatchPoster(async (body) => {
      sent.push(body.payload);
    });
    updateSettings({ helpRank: false });
    expect(settings.value.helpRank).toBe(false);
    watchOpen({ infohash: 'ab'.repeat(20), file: 0, title: 'Show' });
    enqueueWatch({ infohash: 'ab'.repeat(20), file: 0, title: 'Show', watchedPct: 50 });
    flushWatch();
    expect(sent).toHaveLength(0);
  });

  it('counts a switch between two qualities of one title', () => {
    const sent: string[] = [];
    setWatchPoster(async (body) => {
      sent.push(body.payload);
    });
    const first = 'ab'.repeat(20);
    const second = 'cd'.repeat(20);
    watchOpen({ infohash: first, file: 1, title: 'Show 1080p AVC' });
    watchOpen({ infohash: second, file: 2, title: 'Show 2160p HEVC' });
    flushWatch();
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]) as { items: { infohash: string; file: number; switched: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].infohash).toBe(first);
    expect(body.items[0].file).toBe(1);
    expect(body.items[0].switched).toBe(true);
  });

  it('keeps a finished episode when the next one opens from another torrent', () => {
    const sent: string[] = [];
    setWatchPoster(async (body) => {
      sent.push(body.payload);
    });
    const first = 'ab'.repeat(20);
    const second = 'cd'.repeat(20);
    watchOpen({ infohash: first, file: 1, title: 'Show S01E01 1080p', fileTitle: 'Show.S01E01.mkv' });
    watchClose({ infohash: first, file: 1, title: 'Show S01E01 1080p', fileTitle: 'Show.S01E01.mkv', time: 1000, duration: 1000 });
    watchOpen({ infohash: second, file: 4, title: 'Show S01E02 720p BluRay', fileTitle: 'Show.S01E02.mkv' });
    flushWatch();
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]) as { items: { infohash: string; season: number; episode: number; completed: boolean; switched: boolean; watchedPct: number }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].infohash).toBe(first);
    expect(body.items[0].season).toBe(1);
    expect(body.items[0].episode).toBe(1);
    expect(body.items[0].completed).toBe(true);
    expect(body.items[0].switched).toBe(false);
    expect(body.items[0].watchedPct).toBe(100);
  });

  it('still counts a switch of the same unfinished episode', () => {
    const sent: string[] = [];
    setWatchPoster(async (body) => {
      sent.push(body.payload);
    });
    const first = 'ab'.repeat(20);
    const second = 'cd'.repeat(20);
    watchOpen({ infohash: first, file: 1, title: 'Show S01E01 1080p AVC' });
    watchOpen({ infohash: second, file: 2, title: 'Show S01E01 2160p HEVC' });
    flushWatch();
    const body = JSON.parse(sent[0]) as { items: { infohash: string; file: number; episode: number; switched: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].infohash).toBe(first);
    expect(body.items[0].file).toBe(1);
    expect(body.items[0].episode).toBe(1);
    expect(body.items[0].switched).toBe(true);
  });
});
