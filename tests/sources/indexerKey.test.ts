import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseTorznab, parseProwlarr, indexerSource, stripKey, INDEXER_MAX_ITEMS, INDEXER_MAX_CHARS, indexerBadAnswer, INDEXER_TIMEOUT_MS, indexerNoFile } from '../../src/sources/indexer';
import { indexerKeyName, reloadIndexers } from '../../src/sources/indexerStore';
import type { IndexerConn } from '../../src/sources/indexerStore';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { mergeResults } from '../../src/sources/merge';
import { resolveLink, resultKey } from '../../src/sources/view';
import { sanitizeResult } from '../../src/monitor/subs';
import { TorrServerClient } from '../../src/api/torrserver';
import { fakeSite, page } from './fakeSite';
import { mockFetch } from '../helpers/fetchMock';

const KEY = 'k3y-SECRET-0001';
const JACKETT: IndexerConn = { id: 'jackett-1', kind: 'jackett', url: 'http://127.0.0.1:9117', keySet: true };
const PROWLARR: IndexerConn = { id: 'prowlarr-1', kind: 'prowlarr', url: 'http://127.0.0.1:9696', keySet: true };

const RSS = (items: string) => '<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>' + items + '</channel></rss>';
const FILE_ONLY =
  '<item><title>Файл без magnet</title><link>http://127.0.0.1:9117/dl/x/?jackett_apikey=' + KEY + '&amp;path=ENC&amp;file=Name</link>' +
  '<comments>http://127.0.0.1:9117/c?apikey=' + KEY + '&amp;id=1</comments>' +
  '<enclosure url="http://127.0.0.1:9117/dl/x/?jackett_apikey=' + KEY + '&amp;path=ENC&amp;file=Name" length="10"/></item>';

beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  unregisterSource('indexer-' + JACKETT.id);
  unregisterSource('indexer-' + PROWLARR.id);
});

describe('stripKey', () => {
  it('removes every key parameter and nothing else', () => {
    expect(stripKey('http://h/dl/x/?jackett_apikey=K&path=P&file=F')).toBe('http://h/dl/x/?path=P&file=F');
    expect(stripKey('http://h/1/download?link=L&apikey=K')).toBe('http://h/1/download?link=L');
    expect(stripKey('http://h/a?APIKEY=K#frag')).toBe('http://h/a#frag');
    expect(stripKey('http://h/a?x=1&api_key=K&apikey=K2')).toBe('http://h/a?x=1');
    expect(stripKey('http://h/a')).toBe('http://h/a');
  });
});

describe('results never hold the API key', () => {
  const torznab = parseTorznab(RSS(FILE_ONLY), 'indexer-jackett-1', 'jackett');
  const prowlarr = parseProwlarr(
    JSON.stringify([{ title: 'Файл', protocol: 'torrent', downloadUrl: 'http://127.0.0.1:9696/1/download?apikey=' + KEY + '&link=L&file=F', infoUrl: 'http://127.0.0.1:9696/i?apikey=' + KEY }]),
    'indexer-prowlarr-1',
  );

  it('parsed, merged, keyed and persisted forms are free of the key', () => {
    const all = torznab.concat(prowlarr);
    expect(all).toHaveLength(2);
    all.forEach((r) => {
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect(r.Link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(resultKey(r)).not.toContain(KEY);
      expect(JSON.stringify(sanitizeResult(r))).not.toContain(KEY);
    });
    expect(JSON.stringify(mergeResults(all))).not.toContain(KEY);
    mergeResults(all).forEach((r) => expect(r.groupKey).not.toContain(KEY));
    expect(torznab[0].Link).toBe('http://127.0.0.1:9117/dl/x/?path=ENC&file=Name');
  });

  it('nothing in localStorage holds it after a search', async () => {
    const site = fakeSite((c) => page(RSS(FILE_ONLY), c.url), { [indexerKeyName(JACKETT.id)]: KEY });
    const list = await indexerSource(JACKETT).search('q', site.ctx);
    localStorage.setItem('tsp.test', JSON.stringify(list.map((r) => sanitizeResult(r))));
    for (let i = 0; i < localStorage.length; i++) expect(String(localStorage.getItem(localStorage.key(i) as string))).not.toContain(KEY);
  });
});

describe('adding a result with only a download link', () => {
  const BENCODE = 'd8:announce20:http://tracker.test/a4:infod6:lengthi5e4:name1:x12:piece lengthi16384e6:pieces20:' + String.fromCharCode(0, 1, 2, 200, 255) + 'abcdefghijklmno' + 'ee';

  it('re-attaches the key in memory, downloads the file natively and uploads it; TorrServer never sees the key or the link', async () => {
    const src = indexerSource(JACKETT);
    registerSource(src);
    const result = parseTorznab(RSS(FILE_ONLY), src.id, 'jackett')[0];
    const site = fakeSite(() => page(BENCODE, 'x'), { [indexerKeyName(JACKETT.id)]: KEY });
    const link = await resolveLink(result, site.ctx);
    expect(link).toMatch(/^omp-file:/);
    expect(site.calls).toHaveLength(1);
    expect(site.calls[0].url).toBe('http://127.0.0.1:9117/dl/x/?path=ENC&file=Name&jackett_apikey=' + KEY);
    expect(site.calls[0].opts!.responseCharset).toBe('iso-8859-1');
    expect(link).not.toContain(KEY);

    let seen: { url: string; init: { method?: string; body?: unknown } } | null = null;
    mockFetch((url, init) => {
      seen = { url, init };
      return { body: JSON.stringify({ hash: 'a'.repeat(40), title: 'T' }) };
    });
    const t = await new TorrServerClient({ url: 'http://192.168.1.5:8090' }).add({ link, title: 'Файл', category: 'movie' });
    expect(t.hash).toBe('a'.repeat(40));
    expect(seen!.url).toBe('http://192.168.1.5:8090/torrent/upload');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.body).toBeInstanceOf(FormData);
    const form = seen!.init.body as FormData;
    expect(form.get('save')).toBe('true');
    expect(form.get('title')).toBe('Файл');
    const file = form.get('file') as Blob;
    expect(file.size).toBe(BENCODE.length);
    expect(JSON.stringify(Array.from(form.entries()).map((e) => (typeof e[1] === 'string' ? e[1] : 'file')))).not.toContain(KEY);
    // the stash is single use
    await expect(new TorrServerClient({ url: 'http://192.168.1.5:8090' }).add({ link })).rejects.toBeTruthy();
  });

  it('Prowlarr sends the key as a header, not in the URL', async () => {
    const src = indexerSource(PROWLARR);
    registerSource(src);
    const result = parseProwlarr(JSON.stringify([{ title: 'Ф', protocol: 'torrent', downloadUrl: 'http://127.0.0.1:9696/1/download?apikey=' + KEY + '&link=L' }]), src.id)[0];
    const site = fakeSite(() => page(BENCODE, 'x'), { [indexerKeyName(PROWLARR.id)]: KEY });
    await resolveLink(result, site.ctx);
    expect(site.calls[0].url).toBe('http://127.0.0.1:9696/1/download?link=L');
    expect(site.calls[0].opts!.headers).toEqual({ 'X-Api-Key': KEY });
  });

  it('refuses a link on another host, a missing key and a non-torrent answer', async () => {
    const src = indexerSource(JACKETT);
    registerSource(src);
    const r = parseTorznab(RSS(FILE_ONLY), src.id, 'jackett')[0];
    const secrets = { [indexerKeyName(JACKETT.id)]: KEY };
    const foreign = fakeSite(() => page(BENCODE, 'x'), secrets);
    await expect(resolveLink({ ...r, Link: 'http://evil.test/dl?x=1' }, foreign.ctx)).rejects.toThrow(indexerNoFile());
    expect(foreign.calls).toHaveLength(0);
    await expect(resolveLink(r, fakeSite(() => page(BENCODE, 'x'), {}).ctx)).rejects.toThrow();
    await expect(resolveLink(r, fakeSite(() => page('<html>login</html>', 'x'), secrets).ctx)).rejects.toThrow(indexerNoFile());
  });
});

describe('limits', () => {
  it('searches pass a timeout; the key still comes from the secret store only', async () => {
    const site = fakeSite((c) => page(RSS(''), c.url), { [indexerKeyName(JACKETT.id)]: KEY });
    await indexerSource(JACKETT).search('q', site.ctx);
    expect(site.calls[0].opts!.timeoutMs).toBe(INDEXER_TIMEOUT_MS);
  });

  it('caps the number of items and the size of the answer', async () => {
    let items = '';
    for (let i = 0; i < INDEXER_MAX_ITEMS + 50; i++) items += '<item><title>T' + i + '</title><link>magnet:?xt=urn:btih:' + 'a'.repeat(40) + '</link></item>';
    expect(parseTorznab(RSS(items), 'x')).toHaveLength(INDEXER_MAX_ITEMS);
    const rows = [];
    for (let i = 0; i < INDEXER_MAX_ITEMS + 50; i++) rows.push({ title: 'T' + i, protocol: 'torrent', infoHash: 'b'.repeat(40) });
    expect(parseProwlarr(JSON.stringify(rows), 'x')).toHaveLength(INDEXER_MAX_ITEMS);
    const big = fakeSite((c) => page('x'.repeat(INDEXER_MAX_CHARS + 1), c.url), { [indexerKeyName(JACKETT.id)]: KEY });
    await expect(indexerSource(JACKETT).search('q', big.ctx)).rejects.toThrow(indexerBadAnswer());
  });
});
