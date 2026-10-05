// bigfangroup.org (TBDev, windows-1251, decoded by the native http): the search list has size, seeds, leechers
// and date; there are no magnets, but the .torrent of a release downloads without a login (checked live), and
// TorrServer adds an http(s) .torrent link itself, so a result carries it in Link (Magnet and hash stay empty).
import { absUrl, encodeWin1251, parseDate, parseSize, textOf } from './html';
import { loadDoc, makeResult, noTorrent, parseError, requireHost, toInt } from './site';
import type { Source, SourceContext, SourceResult } from './types';

const HOST = 'bigfangroup.org';
const BASE = 'https://www.' + HOST;
const SEARCH = BASE + '/browse.php?search=';
/** «Эротика»: left out of the results. */
const ADULT_CATS = ['42'];

function downloadUrl(id: string): string {
  return BASE + '/download.php?id=' + id;
}

function releaseId(url: string): string {
  const m = /[?&]id=(\d+)/.exec(url);
  return m ? m[1] : '';
}

function categoryOf(row: Element): { id: string; name: string } {
  const a = row.querySelector('a[href*="cat="]');
  const m = a ? /[?&]cat=(\d+)/.exec(a.getAttribute('href') || '') : null;
  const img = a ? a.querySelector('img') : null;
  return { id: m ? m[1] : '', name: img ? img.getAttribute('title') || img.getAttribute('alt') || '' : '' };
}

function parse(doc: Document, base: string): SourceResult[] {
  const table = doc.getElementById('releases-table');
  if (!table) {
    const error = doc.querySelector('div.error');
    if (error && textOf(error).indexOf('Ничего не найдено') >= 0) return [];
    throw new Error(parseError());
  }
  const out: SourceResult[] = [];
  const rows = table.querySelectorAll('tr');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const cells = row.cells;
    const link = row.querySelector('td.indented a[href*="details.php?id="]');
    if (!link || cells.length < 8) continue;
    const cat = categoryOf(row);
    if (ADULT_CATS.indexOf(cat.id) >= 0) continue;
    const detailUrl = absUrl(link.getAttribute('href'), base);
    const id = releaseId(detailUrl);
    if (!id) continue;
    const time = row.querySelector('img[src*="time."]');
    const size = textOf(cells[5]);
    out.push(
      makeResult('bigfangroup', 'BigFANGroup', {
        title: textOf(link),
        detailUrl,
        link: downloadUrl(id),
        categories: cat.name,
        size,
        sizeBytes: parseSize(size),
        seeds: toInt(textOf(cells[6])),
        peers: toInt(textOf(cells[7])),
        date: time ? parseDate(time.getAttribute('title') || time.getAttribute('alt')) : undefined,
      }),
    );
  }
  return out;
}

export const bigfangroup: Source = {
  id: 'bigfangroup',
  name: 'BigFANGroup',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    // the site reads a windows-1251 percent-encoded query (a UTF-8 one finds nothing, checked live)
    return loadDoc(ctx, SEARCH + encodeWin1251(query)).then((p) => parse(p.doc, p.res.url || BASE));
  },
  /** The .torrent link (not a magnet) of a release page, from its id: no request. */
  magnet(detailUrl: string) {
    return requireHost(detailUrl, HOST).then(() => {
      const id = releaseId(detailUrl);
      if (!id) throw new Error(noTorrent());
      return downloadUrl(id);
    });
  },
};
