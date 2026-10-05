// nnmclub.to: forum tracker search (windows-1251, decoded by the native http); magnet on the release page.
import { absUrl, parseSize, textOf } from './html';
import { loadDoc, magnetOf, makeResult, parseError, requireHost, toInt } from './site';
import type { FeedCategory, Source, SourceContext, SourceResult } from './types';

const HOST = 'nnmclub.to';
const SEARCH = 'https://' + HOST + '/forum/tracker.php?nm=';
/** The tracker list of a forum category, newest first, open to guests (checked live): «Видео. Кино…», «Сериалы», «Аниме». */
const FEED_URL = 'https://' + HOST + '/forum/tracker.php?c=';
const FEED: { [c: string]: number } = { movie: 14, tv: 27, anime: 24 };

/** '<u>26228254998</u> 24.4 GB' → { bytes: 26228254998, text: '24.4 GB' } (the <u> holds the sort key). */
function keyed(cell: Element | undefined): { key: string; text: string } {
  if (!cell) return { key: '', text: '' };
  const u = cell.querySelector('u');
  const key = textOf(u);
  const all = textOf(cell);
  return { key, text: key && all.indexOf(key) === 0 ? all.slice(key.length).trim() : all };
}

function parse(doc: Document, base: string): SourceResult[] {
  const table = doc.querySelector('table.forumline.tablesorter');
  if (!table) throw new Error(parseError());
  const out: SourceResult[] = [];
  const rows = table.querySelectorAll('tbody > tr');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const link = row.querySelector('a.topictitle');
    const cells = row.cells;
    if (!link || cells.length < 10) continue;
    const size = keyed(cells[5]);
    const added = keyed(cells[9]);
    const bytes = /^\d+$/.test(size.key) ? parseInt(size.key, 10) : parseSize(size.text);
    const unix = /^\d+$/.test(added.key) ? parseInt(added.key, 10) : 0;
    out.push(
      makeResult('nnmclub', 'NNM-Club', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        categories: textOf(cells[1]),
        size: size.text,
        sizeBytes: bytes,
        seeds: toInt(textOf(row.querySelector('td.seedmed'))),
        peers: toInt(textOf(row.querySelector('td.leechmed'))),
        date: unix > 0 ? unix * 1000 : undefined,
      }),
    );
  }
  return out;
}

export const nnmclub: Source = {
  id: 'nnmclub',
  name: 'NNM-Club',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    // the site reads a UTF-8 percent-encoded nm (checked live; a windows-1251 one is ignored)
    return loadDoc(ctx, SEARCH + encodeURIComponent(query)).then((p) => parse(p.doc, p.res.url || SEARCH));
  },
  latest(ctx: SourceContext, category: FeedCategory) {
    const c = FEED[category];
    if (!c) return Promise.resolve([]);
    return loadDoc(ctx, FEED_URL + c).then((p) => parse(p.doc, p.res.url || FEED_URL + c));
  },
  magnet(detailUrl: string, ctx: SourceContext) {
    return requireHost(detailUrl, HOST)
      .then(() => loadDoc(ctx, detailUrl))
      .then((p) => magnetOf(p.doc));
  },
};
