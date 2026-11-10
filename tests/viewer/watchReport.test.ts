import { afterEach, describe, expect, it } from 'vitest';
import { settings, updateSettings } from '../../src/store/settings';
import { enqueueWatch, flushWatch, resetWatchReport, setWatchPoster, watchOpen } from '../../src/viewer/watchReport';

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
});
