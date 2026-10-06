// rutor.info: open search page with magnets in the list (UTF-8).
import { absUrl, parseDate, parseSize, textOf } from './html';
import { loadDoc, makeResult, mergePages, parseError, toInt } from './site';
import type { FeedCategory, Source, SourceContext, SourceResult } from './types';

const BASE = 'https://rutor.info';

/** Sections of the «new» pages (/browse/0/<id>/0/0, newest first; checked live): foreign + ours. */
const FEED: { [c: string]: number[] } = { movie: [1, 5], tv: [4, 16], anime: [10] };

function parse(doc: Document, base: string): SourceResult[] {
  const index = doc.getElementById('index');
  if (!index) throw new Error(parseError());
  const out: SourceResult[] = [];
  const rows = index.querySelectorAll('tr.gai, tr.tum');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const cells = row.cells;
    const link = row.querySelector('a[href^="/torrent/"]');
    if (!link || cells.length < 4) continue;
    const magnetLink = row.querySelector('a[href^="magnet:"]');
    const size = textOf(cells[cells.length - 2]);
    out.push(
      makeResult('rutor', 'rutor', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        magnet: magnetLink ? magnetLink.getAttribute('href') || '' : '',
        size,
        sizeBytes: parseSize(size),
        seeds: toInt(textOf(row.querySelector('span.green'))),
        peers: toInt(textOf(row.querySelector('span.red'))),
        date: parseDate(textOf(cells[0])),
      }),
    );
  }
  return out;
}

export const rutor: Source = {
  id: 'rutor',
  name: 'Rutor',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    return loadDoc(ctx, BASE + '/search/0/0/000/0/' + encodeURIComponent(query)).then((p) => parse(p.doc, p.res.url || BASE));
  },
  latest(ctx: SourceContext, category: FeedCategory) {
    const ids = FEED[category] || [];
    return mergePages(ids.map((id) => loadDoc(ctx, BASE + '/browse/0/' + id + '/0/0').then((p) => parse(p.doc, p.res.url || BASE))));
  },
};
