import { describe, expect, it } from 'vitest';
import { bitmagnetSearchUrl, searchBitmagnet } from '../src/jackett.mjs';

const XML =
  '<?xml version="1.0"?><rss><channel><item>' +
  '<title>Demo</title>' +
  '<torznab:attr name="seeders" value="4"/>' +
  '<torznab:attr name="leechers" value="1"/>' +
  '</item></channel></rss>';

describe('bitmagnet Torznab', () => {
  it('builds a keyless /torznab search and does not double the path', () => {
    expect(bitmagnetSearchUrl('http://bitmagnet:3333', '', 'a b', '')).toBe(
      'http://bitmagnet:3333/torznab?t=search&q=a%20b',
    );
    expect(bitmagnetSearchUrl('http://bitmagnet:3333/torznab/', 'k', 'q', '3030')).toBe(
      'http://bitmagnet:3333/torznab?t=search&q=q&apikey=k&cat=3030',
    );
  });

  it('is off without a URL and returns the feed when the server answers', async () => {
    expect(await searchBitmagnet({ origin: '', fetchImpl: async () => { throw new Error('called'); } })).toEqual({ ok: false, xml: '' });
    let seen = '';
    const found = await searchBitmagnet({
      origin: 'http://bitmagnet:3333',
      query: 'demo',
      fetchImpl: async (url: string) => {
        seen = url;
        return { status: 200, text: async () => XML, body: null };
      },
    });
    expect(seen).toContain('/torznab?t=search&q=demo');
    expect(found.ok).toBe(true);
    expect(found.xml).toContain('seeders');
  });
});
