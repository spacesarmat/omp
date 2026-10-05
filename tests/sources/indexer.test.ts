import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseTorznab, parseProwlarr, indexerSource, hidesTorznab, syncIndexerSources, startIndexerSources, indexerBadKey, indexerDown, indexerError, indexerNeedKey } from '../../src/sources/indexer';
import { saveIndexer, removeIndexer, indexerKeyName, reloadIndexers, indexerConnections } from '../../src/sources/indexerStore';
import type { IndexerConn } from '../../src/sources/indexerStore';
import { allSources, getSource, builtinSources, setHideRule, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, setSourceOn } from '../../src/sources/store';
import { mergeResults } from '../../src/sources/merge';
import { fakeSite, page } from './fakeSite';

const H1 = '0123456789abcdef0123456789abcdef01234567';
const H2 = 'fedcba9876543210fedcba9876543210fedcba98';
const KEY = 'k3y-SECRET-0001';

const RSS = (items: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Fake</title>' +
  items +
  '</channel></rss>';

const ITEMS =
  // full item: magnet attr, infohash, seeders/peers
  '<item><title>Тестовый фильм (2020) WEB-DL 1080p</title><jackettindexer id="rutor">RuTor</jackettindexer><guid>https://t.example/1</guid>' +
  '<link>http://127.0.0.1:9117/dl/rutor/?jackett_apikey=' + KEY + '&amp;file=Test</link><comments>https://t.example/1#comments</comments>' +
  '<pubDate>Sat, 03 Oct 2026 10:00:00 +0300</pubDate><size>2147483648</size><category>2000</category><category>Movies</category>' +
  '<enclosure url="http://127.0.0.1:9117/dl/rutor/?file=Test" length="2147483648" type="application/x-bittorrent"/>' +
  '<torznab:attr name="seeders" value="25"/><torznab:attr name="peers" value="31"/>' +
  '<torznab:attr name="infohash" value="' + H1.toUpperCase() + '"/><torznab:attr name="magneturl" value="magnet:?xt=urn:btih:' + H1 + '&amp;dn=Test"/></item>' +
  // infohash only (no magnet): the magnet is built
  '<item><title>Вымышленный сериал S01</title><jackettindexer id="x">NoNaMe</jackettindexer><link>http://127.0.0.1:9117/dl/x/?file=S01</link>' +
  '<torznab:attr name="size" value="1048576"/><torznab:attr name="seeders" value="3"/><torznab:attr name="leechers" value="2"/>' +
  '<torznab:attr name="infohash" value="' + H2 + '"/></item>' +
  // magnet in <link>, no attrs at all
  '<item><title>Magnet in link</title><link>magnet:?xt=urn:btih:' + H2 + '</link></item>' +
  // only a .torrent link
  '<item><title>Torrent file only</title><link>http://127.0.0.1:9117/dl/y/?file=Y</link><enclosure url="http://127.0.0.1:9117/dl/y/?file=Y" length="500" type="application/x-bittorrent"/></item>' +
  // nothing usable
  '<item><title>No link</title></item>' +
  // no title
  '<item><link>magnet:?xt=urn:btih:' + H1 + '</link></item>';

describe('parseTorznab', () => {
  const list = parseTorznab(RSS(ITEMS), 'indexer-x', 'jackett');

  it('drops items without a title or without a magnet/infohash/link', () => {
    expect(list.map((r) => r.Title)).toEqual(['Тестовый фильм (2020) WEB-DL 1080p', 'Вымышленный сериал S01', 'Magnet in link', 'Torrent file only']);
  });

  it('maps the full item', () => {
    const r = list[0];
    expect(r.source).toBe('indexer-x');
    expect(r.Tracker).toBe('Jackett · RuTor');
    expect(r.hash).toBe(H1);
    expect(r.Hash).toBe(H1);
    expect(r.Magnet).toBe('magnet:?xt=urn:btih:' + H1 + '&dn=Test');
    expect(r.sizeBytes).toBe(2147483648);
    expect(r.Size).toBe('2.0 GB');
    expect(r.Seed).toBe(25);
    expect(r.Peer).toBe(6);
    expect(r.date).toBe(Date.parse('2026-10-03T07:00:00Z'));
    expect(r.CreateDate).toBe('2026-10-03T07:00:00.000Z');
    expect(r.detailUrl).toBe('https://t.example/1#comments');
    expect(r.Categories).toBe('2000, Movies');
  });

  it('builds a magnet from the infohash attr and reads leechers', () => {
    const r = list[1];
    expect(r.Tracker).toBe('Jackett · NoNaMe');
    expect(r.Magnet).toBe('magnet:?xt=urn:btih:' + H2 + '&dn=' + encodeURIComponent('Вымышленный сериал S01'));
    expect(r.hash).toBe(H2);
    expect(r.sizeBytes).toBe(1048576);
    expect(r.Seed).toBe(3);
    expect(r.Peer).toBe(2);
    expect(r.date).toBeUndefined();
    expect(r.CreateDate).toBe('');
  });

  it('takes a magnet from <link> and derives the hash; missing numbers are 0 / absent', () => {
    const r = list[2];
    expect(r.Magnet).toBe('magnet:?xt=urn:btih:' + H2);
    expect(r.hash).toBe(H2);
    expect(r.Seed).toBe(0);
    expect(r.Peer).toBe(0);
    expect(r.sizeBytes).toBeUndefined();
    expect(r.Size).toBe('');
    expect(r.Tracker).toBe('Jackett');
  });

  it('keeps a .torrent link for TorrServer when there is no magnet and no hash; size from the enclosure', () => {
    const r = list[3];
    expect(r.Magnet).toBe('');
    expect(r.hash).toBeUndefined();
    expect(r.Link).toBe('http://127.0.0.1:9117/dl/y/?file=Y');
    expect(r.sizeBytes).toBe(500);
  });

  it('a Torznab error element: key errors and others', () => {
    expect(() => parseTorznab('<error code="100" description="Invalid API Key"/>', 'x')).toThrow(indexerBadKey());
    expect(() => parseTorznab('<error code="900" description="x"/>', 'x')).toThrow();
  });

  it('rejects non-XML and non-RSS answers; an empty channel is an empty list', () => {
    expect(() => parseTorznab('<html><body>nope', 'x')).toThrow();
    expect(() => parseTorznab('<html></html>', 'x')).toThrow();
    expect(parseTorznab(RSS(''), 'x')).toEqual([]);
  });
});

describe('parseProwlarr', () => {
  const json = JSON.stringify([
    { title: 'Тестовый фильм (2020)', indexer: 'RuTor', protocol: 'torrent', size: 3221225472, seeders: 40, leechers: 5, publishDate: '2026-10-03T07:00:00Z', infoHash: H1.toUpperCase(), magnetUrl: 'magnet:?xt=urn:btih:' + H1, infoUrl: 'https://t.example/2', guid: 'https://t.example/2' },
    { title: 'Hash only', indexer: 'Other', protocol: 'torrent', infoHash: H2, seeders: 1 },
    { title: 'Guid is a magnet', protocol: 'torrent', guid: 'magnet:?xt=urn:btih:' + H2, downloadUrl: 'http://p/dl' },
    { title: 'Download link only', indexer: 'D', protocol: 'torrent', downloadUrl: 'http://127.0.0.1:9696/1/download?apikey=' + KEY },
    { title: 'A usenet release', protocol: 'usenet', downloadUrl: 'http://p/nzb' },
    { title: 'No link', protocol: 'torrent' },
    { indexer: 'No title', magnetUrl: 'magnet:?xt=urn:btih:' + H1 },
    null,
    5,
  ]);
  const list = parseProwlarr(json, 'indexer-p');

  it('skips usenet and unusable rows', () => {
    expect(list.map((r) => r.Title)).toEqual(['Тестовый фильм (2020)', 'Hash only', 'Guid is a magnet', 'Download link only']);
  });

  it('maps fields', () => {
    const r = list[0];
    expect(r.source).toBe('indexer-p');
    expect(r.Tracker).toBe('Prowlarr · RuTor');
    expect(r.hash).toBe(H1);
    expect(r.Magnet).toBe('magnet:?xt=urn:btih:' + H1);
    expect(r.sizeBytes).toBe(3221225472);
    expect(r.Seed).toBe(40);
    expect(r.Peer).toBe(5);
    expect(r.date).toBe(Date.parse('2026-10-03T07:00:00Z'));
    expect(r.detailUrl).toBe('https://t.example/2');
    expect(list[1].Magnet).toBe('magnet:?xt=urn:btih:' + H2 + '&dn=Hash%20only');
    expect(list[2].hash).toBe(H2);
    expect(list[3].Link).toContain('/1/download');
    expect(list[3].Tracker).toBe('Prowlarr · D');
  });

  it('rejects a non-array answer', () => {
    expect(() => parseProwlarr('{"error":"x"}', 'x')).toThrow();
    expect(() => parseProwlarr('<html>', 'x')).toThrow();
  });
});

const JACKETT: IndexerConn = { id: 'jackett-1', kind: 'jackett', url: 'http://127.0.0.1:9117', keySet: true };
const PROWLARR: IndexerConn = { id: 'prowlarr-1', kind: 'prowlarr', url: 'http://127.0.0.1:9696/sub', keySet: true, name: 'Мой Prowlarr' };

describe('indexerSource', () => {
  it('Jackett: GET Torznab URL with the key from the secret store; kind indexer', async () => {
    const site = fakeSite((c) => page(RSS(ITEMS), c.url), { [indexerKeyName('jackett-1')]: KEY });
    const s = indexerSource(JACKETT);
    expect(s.id).toBe('indexer-jackett-1');
    expect(s.kind).toBe('indexer');
    expect(s.name).toBe('Jackett');
    const list = await s.search('дюна 2021', site.ctx);
    expect(site.calls).toHaveLength(1);
    expect(site.calls[0].url).toBe('http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/api?apikey=' + KEY + '&t=search&q=' + encodeURIComponent('дюна 2021'));
    expect(list).toHaveLength(4);
    expect(list[0].source).toBe('indexer-jackett-1');
  });

  it('Prowlarr: JSON search with X-Api-Key and no key in the URL', async () => {
    const site = fakeSite((c) => page(JSON.stringify([{ title: 'T', protocol: 'torrent', infoHash: H1 }]), c.url), { [indexerKeyName('prowlarr-1')]: KEY });
    const s = indexerSource(PROWLARR);
    expect(s.name).toBe('Мой Prowlarr');
    const list = await s.search('a b', site.ctx);
    expect(site.calls[0].url).toBe('http://127.0.0.1:9696/sub/api/v1/search?query=a%20b&type=search');
    expect(site.calls[0].opts).toEqual({ headers: { 'X-Api-Key': KEY }, timeoutMs: 20000 });
    expect(site.calls[0].url).not.toContain(KEY);
    expect(list).toHaveLength(1);
  });

  it('401/403 -> wrong key, other statuses -> generic error', async () => {
    for (const status of [401, 403]) {
      const site = fakeSite((c) => page('', c.url, status), { [indexerKeyName('jackett-1')]: KEY });
      await expect(indexerSource(JACKETT).search('q', site.ctx)).rejects.toThrow(indexerBadKey());
    }
    const site = fakeSite((c) => page('', c.url, 502), { [indexerKeyName('jackett-1')]: KEY });
    await expect(indexerSource(JACKETT).search('q', site.ctx)).rejects.toThrow(indexerError(502));
  });

  it('a network failure becomes "не отвечает" without the URL or the key', async () => {
    const site = fakeSite(
      () => {
        throw new Error('failed to connect to http://127.0.0.1:9117/api?apikey=' + KEY);
      },
      { [indexerKeyName('jackett-1')]: KEY },
    );
    const err = await indexerSource(JACKETT)
      .search('q', site.ctx)
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err!.message).toBe(indexerDown());
    expect(err!.message).not.toContain(KEY);
  });

  it('a missing key -> enter the key (not «wrong»); no secret store -> wrong key; no request', async () => {
    const none = fakeSite((c) => page('', c.url), {});
    await expect(indexerSource(JACKETT).search('q', none.ctx)).rejects.toThrow(indexerNeedKey());
    const noStore = fakeSite((c) => page('', c.url), null);
    await expect(indexerSource(JACKETT).search('q', noStore.ctx)).rejects.toThrow(indexerBadKey());
    expect(none.calls).toHaveLength(0);
    expect(noStore.calls).toHaveLength(0);
  });

  it('a Torznab key error inside a 200 answer -> wrong key', async () => {
    const site = fakeSite((c) => page('<error code="100" description="Invalid API Key"/>', c.url), { [indexerKeyName('jackett-1')]: KEY });
    await expect(indexerSource(JACKETT).search('q', site.ctx)).rejects.toThrow(indexerBadKey());
  });
});

describe('path selection', () => {
  beforeEach(() => {
    localStorage.clear();
    reloadSourcePrefs();
    reloadIndexers();
  });
  afterEach(() => {
    builtinSources().forEach((s) => unregisterSource(s.id));
    setHideRule(null);
    localStorage.clear();
    reloadSourcePrefs();
    reloadIndexers();
  });

  it('without a connection TorrServer Torznab stays', () => {
    startIndexerSources();
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab']);
  });

  it('a direct Jackett registers its source and hides ts-torznab (still found by id); toggling it off brings Torznab back', async () => {
    const secrets = fakeSite(() => page('', ''), {}).ctx.secrets!;
    const conn = await saveIndexer({ kind: 'jackett', url: 'http://192.168.1.5:9117/', apiKey: KEY }, secrets);
    startIndexerSources();
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'indexer-' + conn.id]);
    expect(getSource('ts-torznab')).toBeDefined();
    setSourceOn('indexer-' + conn.id, false);
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab', 'indexer-' + conn.id]);
    setSourceOn('indexer-' + conn.id, true);
    await removeIndexer(conn.id, secrets);
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab']);
  });

  it('Prowlarr alone does not hide ts-torznab', async () => {
    const secrets = fakeSite(() => page('', ''), {}).ctx.secrets!;
    await saveIndexer({ kind: 'prowlarr', url: 'http://192.168.1.5:9696', apiKey: KEY }, secrets);
    syncIndexerSources();
    expect(allSources().map((s) => s.id)).toContain('ts-torznab');
  });

  it('with a known Torznab host only that host hides it', () => {
    const j: IndexerConn = { id: 'jackett-a', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true };
    expect(hidesTorznab([j], '192.168.1.5:9117')).toBe(true);
    expect(hidesTorznab([j], '192.168.1.9:9117')).toBe(false);
    expect(hidesTorznab([j])).toBe(true);
    expect(hidesTorznab([])).toBe(false);
  });

  it('the same release from TorrServer Torznab and a direct Jackett merges into one row', () => {
    const direct = parseTorznab(RSS(ITEMS), 'indexer-j', 'jackett');
    const viaTs = { ...direct[0], source: 'ts-torznab', Tracker: 'RuTor' };
    const merged = mergeResults([viaTs, direct[0]]);
    expect(merged.filter((r) => r.hash === H1)).toHaveLength(1);
  });

  it('saving a connection registers its source without a manual sync once started', async () => {
    startIndexerSources();
    const secrets = fakeSite(() => page('', ''), {}).ctx.secrets!;
    const conn = await saveIndexer({ kind: 'prowlarr', url: 'http://192.168.1.5:9696', apiKey: KEY }, secrets);
    expect(indexerConnections()).toHaveLength(1);
    expect(getSource('indexer-' + conn.id)!.kind).toBe('indexer');
  });
});
