import { describe, it, expect, beforeEach } from 'vitest';
import { fixPlaceholderTitles, resetTitleFix, RETRY_MS, MAX_TRIES } from '../../src/lib/titleFix';
import { renameTorrent, checkTitle, TITLE_MAX } from '../../src/lib/renameTorrent';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents, refreshTorrents, resetLibrary } from '../../src/store/library';
import type { Torrent } from '../../src/api/types';

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const H3 = '3'.repeat(40);
const data = JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'Moon.Garden.S02E01.1080p.mkv', length: 5 }, { id: 2, path: 'Moon.Garden.S02E02.1080p.mkv', length: 5 }] } });
const tor = (hash: string, title: string, extra: Partial<Torrent> = {}): Torrent => ({ hash, title, stat: 0, data, ...extra });

function fake(fail = false) {
  const calls: { hash: string; title: string; poster?: string; category?: string }[] = [];
  return {
    calls,
    setTitle: (t: any, title: string) => {
      calls.push({ hash: t.hash, title, poster: t.poster, category: t.category });
      return fail ? Promise.reject(new Error('down')) : Promise.resolve();
    },
  };
}

beforeEach(() => resetTitleFix());

describe('fixPlaceholderTitles', () => {
  it('writes the derived title only for placeholders and passes poster/category along', async () => {
    const c = fake();
    const list = [tor(H1, 'infohash:' + H1, { poster: 'http://p', category: 'tv' }), tor(H2, 'Real Name'), tor(H3, 'infohash:' + H3, { data: '' })];
    const done = await fixPlaceholderTitles(c, list);
    expect(done).toEqual([{ hash: H1, title: 'Moon Garden · Сезон 2' }]);
    expect(c.calls).toEqual([{ hash: H1, title: 'Moon Garden · Сезон 2', poster: 'http://p', category: 'tv' }]);
  });
  it('is idempotent: a failure is retried only after RETRY_MS, a bounded number of times', async () => {
    const c = fake(true);
    const list = [tor(H1, 'infohash:' + H1)];
    expect(await fixPlaceholderTitles(c, list, 0)).toEqual([]);
    await fixPlaceholderTitles(c, list, 1000);
    expect(c.calls).toHaveLength(1);
    await fixPlaceholderTitles(c, list, RETRY_MS + 1);
    await fixPlaceholderTitles(c, list, 2 * RETRY_MS + 2);
    await fixPlaceholderTitles(c, list, 10 * RETRY_MS);
    expect(c.calls).toHaveLength(MAX_TRIES);
    resetTitleFix();
    const good = fake();
    await fixPlaceholderTitles(good, list, 0);
    await fixPlaceholderTitles(good, list, 100 * RETRY_MS);
    expect(good.calls).toHaveLength(1);
    const ok = fake();
    await fixPlaceholderTitles(ok, list);
    expect(ok.calls).toHaveLength(0);
  });
  it('waits for the files: a torrent without them is tried once they are known', async () => {
    const c = fake();
    await fixPlaceholderTitles(c, [tor(H3, 'infohash:' + H3, { data: '' })]);
    expect(c.calls).toHaveLength(0);
    await fixPlaceholderTitles(c, [tor(H3, 'infohash:' + H3)]);
    expect(c.calls).toHaveLength(1);
  });
});

describe('library refresh', () => {
  it('repairs placeholder titles once and patches the shown list', async () => {
    resetLibrary();
    const c = { ...fake(), list: () => Promise.resolve([tor(H1, 'infohash:' + H1)]) };
    await refreshTorrents(c);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.calls).toHaveLength(1);
    expect(torrents.value[0].title).toBe('Moon Garden · Сезон 2');
    await refreshTorrents(c);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.calls).toHaveLength(1);
  });
});

describe('rename', () => {
  it('validates the title', () => {
    expect(checkTitle('  ').ok).toBe(false);
    expect(checkTitle('a'.repeat(TITLE_MAX + 1)).ok).toBe(false);
    expect(checkTitle('  Moon   Garden ')).toEqual({ ok: true, title: 'Moon Garden' });
  });
  it('sets the trimmed title through the client, keeping poster and category', async () => {
    const c = fake();
    expect(await renameTorrent(c, { hash: H1, poster: 'p', category: 'movie' }, '  New Name ')).toBe('New Name');
    expect(c.calls).toEqual([{ hash: H1, title: 'New Name', poster: 'p', category: 'movie' }]);
  });
  it('rejects an invalid title without a request', async () => {
    const c = fake();
    await expect(renameTorrent(c, { hash: H1 }, '   ')).rejects.toThrow('Введите название');
    expect(c.calls).toHaveLength(0);
  });
  it('the real client re-reads the torrent and sends its current poster/category with an empty data', async () => {
    const bodies: { action: string }[] = [];
    const c = new TorrServerClient({ url: 'h:1' });
    (c as unknown as { call: (p: string, o: { body: { action: string } }) => Promise<unknown> }).call = (_p, o) => {
      bodies.push(o.body);
      return Promise.resolve(o.body.action === 'get' ? { hash: H1, title: 'x', stat: 0, poster: 'fresh', category: 'tv' } : null);
    };
    await c.setTitle({ hash: H1, poster: 'stale', category: 'other' }, ' T ');
    expect(bodies[1]).toEqual({ action: 'set', hash: H1, title: 'T', poster: 'fresh', category: 'tv', data: '' });
  });
  it('falls back to the passed poster/category when the re-read fails', async () => {
    const bodies: { action: string }[] = [];
    const c = new TorrServerClient({ url: 'h:1' });
    (c as unknown as { call: (p: string, o: { body: { action: string } }) => Promise<unknown> }).call = (_p, o) => {
      bodies.push(o.body);
      return o.body.action === 'get' ? Promise.reject(new Error('x')) : Promise.resolve(null);
    };
    await c.setTitle({ hash: H1, poster: 'p', category: 'tv' }, 'T');
    expect(bodies[1]).toEqual({ action: 'set', hash: H1, title: 'T', poster: 'p', category: 'tv', data: '' });
  });
});

describe('displayTitle at call sites', () => {
  it('«Добавлено» toast and the player queue show the derived name', async () => {
    const { addedMessage } = await import('../../src/store/library');
    const { buildTorrentQueue } = await import('../../src/player/queue');
    const t = tor(H1, 'infohash:' + H1);
    expect(addedMessage([t])).toBe('Добавлено: Moon Garden · Сезон 2');
    const c = new TorrServerClient({ url: 'h:1' });
    const q = buildTorrentQueue(c, t, [{ id: 1, path: 'Moon.Garden.S02E01.1080p.mkv', length: 5 }]);
    expect(q[0].torrentTitle).toBe('Moon Garden · Сезон 2');
  });
});
