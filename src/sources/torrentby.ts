// torrent.by: open search page with magnets in the list (UTF-8). When it blocks the IP it answers 200 with its own
// «введите проверочный код» page (a /ban_free/ form): that is ipBanError, the background requests pause for an hour
// (ipBan.ts) and «Ввести код» opens the site in the browser sheet.
import { t } from '../i18n';
import { openSitePage, type BrowserSpec } from './browserLogin';
import { absUrl, parseDate, parseHtml, parseSize, textOf } from './html';
import { clearSourcePause, ipBanError, isIpBan, pauseSource, sourcePaused } from './ipBan';
import { checkPage, makeResult, mergePages, parseError, toInt } from './site';
import { clearHealth, setHealth } from './store';
import { isTlsError } from './tls';
import type { FeedCategory, HttpResponse, Source, SourceContext, SourceResult } from './types';

const ID = 'torrentby';
const NAME = 'torrent.by';
const HOST = 'torrent.by';
const BASE = 'https://' + HOST;
const SEARCH = BASE + '/search/?search=';
/** Section pages, newest first, open to guests (checked live): foreign + ours (one page each). */
const FEED: { [c: string]: string[] } = { movie: ['/films/', '/movies/'], tv: ['/serials/', '/series/'], anime: ['/anime/'] };
/** The page «Ввести код» re-checks: a section list (its rows are never on the code page). */
const PROBE = 'films/';
const ROW_MARK = 'ttable_col1';

/** The anti-bot page: «С вашего IP адреса поступают подозрительные запросы», a captcha form posting to /ban_free/. */
export function isBanPage(text: string): boolean {
  return /action=["']?[^"'\s>]*\/ban_free\//i.test(text) && /name=["']?captcha["'\s>]/i.test(text);
}

/**
 * A page of the site: the code page rejects with ipBanError and pauses the background requests; an answer ends the
 * pause. The background page does not ask while the pause lasts.
 */
function load(ctx: SourceContext, url: string): Promise<{ res: HttpResponse; doc: Document }> {
  if (ctx.background && sourcePaused(ID)) return Promise.reject(ipBanError(NAME));
  return ctx.http.get(url).then((res) => {
    if (res.status >= 200 && res.status < 400 && isBanPage(res.text)) {
      pauseSource(ID);
      throw ipBanError(NAME);
    }
    checkPage(res);
    clearSourcePause(ID);
    return { res, doc: parseHtml(res.text) };
  });
}

/**
 * What «Ввести код» opens: the site's root, where the code page shows. The sheet closes itself when the section list
 * opens with the page's cookies (the native check), else when the person closes it.
 */
export function codeSpec(): BrowserSpec {
  return {
    url: BASE + '/',
    site: NAME,
    source: ID,
    hosts: [HOST],
    // the check page must list releases; ending on the code form is never «done»
    check: { path: PROBE, marker: ROW_MARK, loginPath: 'ban_free/' },
    title: t('sources.site.codeTitle', { site: NAME }),
    text: t('sources.site.codeText'),
    cancel: t('common.close'),
  };
}

function parseRows(table: Element, base: string): SourceResult[] {
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
      makeResult(ID, NAME, {
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

function parse(doc: Document, base: string): SourceResult[] {
  const table = doc.getElementById('torrents_table');
  if (!table) {
    // «Ничего не найдено.» keeps the search form of the results page
    if (doc.getElementById('text-to-find')) return [];
    throw new Error(parseError());
  }
  return parseRows(table, base);
}

/** A section page: the list follows the <h1> (a «Раздачи требующие поддержки» table comes before it). */
function parseSection(doc: Document, base: string): SourceResult[] {
  const h1 = doc.querySelector('h1');
  let table = h1 ? h1.nextElementSibling : null;
  while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
  if (!table) throw new Error(parseError());
  return parseRows(table, base);
}

/** One check of the site after «Ввести код», recorded in the health like a search. */
function probe(ctx: SourceContext): Promise<void> {
  const started = Date.now();
  return load(ctx, BASE + '/' + PROBE)
    .then((p) => parseSection(p.doc, p.res.url || BASE))
    .then(
      () => {
        const now = Date.now();
        setHealth(ID, { state: 'ok', ms: now - started, at: now });
      },
      (e) => {
        const message = e instanceof Error ? e.message : String(e);
        if (isIpBan(e)) setHealth(ID, { state: 'error', at: Date.now(), message, code: 'ipban' });
        else if (isTlsError(e)) setHealth(ID, { state: 'error', at: Date.now(), message, code: 'tls' });
        else setHealth(ID, { state: 'error', at: Date.now(), message });
      },
    );
}

export const torrentby: Source = {
  id: ID,
  name: NAME,
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    return load(ctx, SEARCH + encodeURIComponent(query)).then((p) => parse(p.doc, p.res.url || BASE));
  },
  latest(ctx: SourceContext, category: FeedCategory) {
    const paths = FEED[category] || [];
    if (!paths.length) return mergePages([]);
    const section = (path: string) => load(ctx, BASE + path).then((p) => parseSection(p.doc, p.res.url || BASE));
    // the first section goes alone: after its code page no more requests go into the ban
    const first = section(paths[0]);
    const goOn = first.then(
      () => true,
      (e) => !isIpBan(e),
    );
    const rest = paths.slice(1).map((path) => goOn.then((go) => (go ? section(path) : Promise.reject(ipBanError(NAME)))));
    return mergePages([first].concat(rest));
  },
  unblock(ctx: SourceContext) {
    return openSitePage(codeSpec()).then((r) => {
      if (r.result === 'failed' || r.result === 'busy') return false;
      // closed, or the list opened in the sheet: the person's own request asks the site again right away
      clearSourcePause(ID);
      clearHealth(ID);
      return probe(ctx).then(() => true);
    });
  },
};
