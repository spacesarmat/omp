// torrent.by: open search page with magnets in the list (UTF-8).
import { absUrl, parseDate, parseSize, textOf } from './html';
import { loadDoc, makeResult, PARSE_ERROR, toInt } from './site';
import type { Source, SourceContext, SourceResult } from './types';

const BASE = 'https://torrent.by';
const SEARCH = BASE + '/search/?search=';

function parse(doc: Document, base: string): SourceResult[] {
  const table = doc.getElementById('torrents_table');
  if (!table) {
    // «Ничего не найдено.» keeps the search form of the results page
    if (doc.getElementById('text-to-find')) return [];
    throw new Error(PARSE_ERROR);
  }
  const out: SourceResult[] = [];
  const rows = table.querySelectorAll('tr.ttable_col1, tr.ttable_col2');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const cells = row.cells;
    const link = row.querySelector('a[name="search_select"]');
    const magnetLink = row.querySelector('a.magnet[href^="magnet:"]');
    if (!link || cells.length < 4) continue;
    const size = textOf(cells[cells.length - 2]);
    const peers = cells[cells.length - 1];
    out.push(
      makeResult('torrentby', 'torrent.by', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        magnet: magnetLink ? magnetLink.getAttribute('href') || '' : '',
        size,
        sizeBytes: parseSize(size),
        seeds: toInt(textOf(peers.querySelector('font[color="green"]'))),
        peers: toInt(textOf(peers.querySelector('font[color="red"]'))),
        date: parseDate(textOf(cells[0])),
      }),
    );
  }
  return out;
}

export const torrentby: Source = {
  id: 'torrentby',
  name: 'torrent.by',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    return loadDoc(ctx, SEARCH + encodeURIComponent(query)).then((p) => parse(p.doc, p.res.url || BASE));
  },
};
