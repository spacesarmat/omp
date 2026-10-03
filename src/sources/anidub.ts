// tr.anidub.com (DLE, UTF-8): the search list has releases only; each release page has one or more torrents
// (per format tab) with .torrent links that download without a login, and no magnet links. TorrServer adds an
// http(s) .torrent link itself, so a result carries it in Link (Magnet and hash stay empty).
import { absUrl, parseSize, textOf } from './html';
import { loadDoc, makeResult, NO_TORRENT, PARSE_ERROR, requireHost, toInt } from './site';
import type { Source, SourceContext, SourceResult } from './types';

const HOST = 'tr.anidub.com';
const BASE = 'https://' + HOST;
const SEARCH = BASE + '/index.php?do=search&subaction=search&story=';
/** Release pages opened at once. */
export const ANIDUB_PARALLEL = 4;
/** At most this many release pages per search (the site lists 15 per page). */
export const ANIDUB_MAX_RELEASES = 15;
/** Own timeout of one release page. */
export const ANIDUB_PAGE_TIMEOUT_MS = 5000;
/** From the start of a search: no new release pages after it, and the results found so far are returned. */
export const ANIDUB_DEADLINE_MS = 12000;
export const ANIDUB_NO_TORRENT = NO_TORRENT;

interface Release {
  title: string;
  url: string;
  category: string;
}

function parseList(doc: Document, base: string): Release[] {
  const posts = doc.querySelectorAll('div.search_post');
  if (!posts.length && !doc.querySelector('input[name="story"]')) throw new Error(PARSE_ERROR);
  const out: Release[] = [];
  for (let i = 0; i < posts.length; i++) {
    const a = posts[i].querySelector('h2 a');
    const url = a ? absUrl(a.getAttribute('href'), base) : '';
    if (!a || !url) continue;
    out.push({ title: textOf(a), url, category: textOf(posts[i].querySelector('.inf .lcol a')) });
  }
  return out;
}

function downloadUrl(id: string): string {
  return BASE + '/engine/download.php?id=' + id;
}

/** Torrent blocks `div#torrent_<id>_info` of a release page. */
function torrentBlocks(doc: Document): { id: string; el: Element }[] {
  const out: { id: string; el: Element }[] = [];
  const els = doc.querySelectorAll('div[id^="torrent_"]');
  for (let i = 0; i < els.length; i++) {
    const m = /^torrent_(\d+)_info$/.exec(els[i].id);
    if (m) out.push({ id: m[1], el: els[i] });
  }
  return out;
}

/** Name of the format tab holding the block («BD (720p)», «PSP»). */
function tabName(doc: Document, el: Element): string {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!p.id) continue;
    const tabs = doc.querySelectorAll('a[href="#' + p.id + '"]');
    if (tabs.length) return textOf(tabs[0]);
  }
  return '';
}

function sizeOf(block: Element): string {
  const down = block.querySelector('.list.down');
  if (!down) return '';
  const reds = down.querySelectorAll('span.red');
  return reds.length ? textOf(reds[0]) : '';
}

function parseRelease(doc: Document, r: Release): SourceResult[] {
  return torrentBlocks(doc).map((b) => {
    const tab = tabName(doc, b.el);
    const size = sizeOf(b.el);
    return makeResult('anidub', 'Anidub', {
      title: r.title + (tab ? ' [' + tab + ']' : ''),
      detailUrl: r.url.split('#')[0] + '#torrent_' + b.id + '_info',
      link: downloadUrl(b.id),
      categories: r.category,
      size,
      sizeBytes: parseSize(size),
      seeds: toInt(textOf(b.el.querySelector('.li_distribute_m'))),
      peers: toInt(textOf(b.el.querySelector('.li_swing_m'))),
    });
  });
}

/**
 * Opens the release pages, ANIDUB_PARALLEL at a time, each with its own timeout. A failed page is skipped unless
 * every page failed. At `deadline` (unix ms) no new page is started and the results found so far are returned:
 * one slow page never costs the ones already read.
 */
function openReleases(ctx: SourceContext, releases: Release[], deadline: number): Promise<SourceResult[]> {
  const list = releases.slice(0, ANIDUB_MAX_RELEASES);
  const found: SourceResult[][] = [];
  let failures = 0;
  let firstError: unknown = null;
  let next = 0;
  let over = false;
  const collected = (): SourceResult[] => {
    const out: SourceResult[] = [];
    for (let i = 0; i < list.length; i++) if (found[i]) out.push.apply(out, found[i]);
    return out;
  };
  const worker = (): Promise<void> => {
    if (over || next >= list.length || Date.now() >= deadline) return Promise.resolve();
    const i = next++;
    const r = list[i];
    return requireHost(r.url, HOST)
      .then(() => loadDoc(ctx, r.url, { timeoutMs: ANIDUB_PAGE_TIMEOUT_MS }))
      .then(
        (p) => {
          if (!over) found[i] = parseRelease(p.doc, r);
        },
        (e: unknown) => {
          failures++;
          if (firstError === null) firstError = e;
        },
      )
      .then(worker);
  };
  return new Promise<SourceResult[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      over = true;
      resolve(collected());
    }, Math.max(0, deadline - Date.now()));
    const workers: Promise<void>[] = [];
    for (let k = 0; k < Math.min(ANIDUB_PARALLEL, list.length); k++) workers.push(worker());
    Promise.all(workers).then(() => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      const out = collected();
      if (!out.length && failures > 0 && failures === next) reject(firstError);
      else resolve(out);
    });
  });
}

export const anidub: Source = {
  id: 'anidub',
  name: 'Anidub',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    const deadline = Date.now() + ANIDUB_DEADLINE_MS;
    return loadDoc(ctx, SEARCH + encodeURIComponent(query)).then((p) => openReleases(ctx, parseList(p.doc, p.res.url || BASE), deadline));
  },
  /** The .torrent link (not a magnet): of the torrent named in the #fragment, else the first one of the page. */
  magnet(detailUrl: string, ctx: SourceContext) {
    return requireHost(detailUrl, HOST).then(() => {
      const id = /#torrent_(\d+)_info$/.exec(detailUrl);
      if (id) return downloadUrl(id[1]);
      return loadDoc(ctx, detailUrl).then((p) => {
        const blocks = torrentBlocks(p.doc);
        if (!blocks.length) throw new Error(ANIDUB_NO_TORRENT);
        return downloadUrl(blocks[0].id);
      });
    });
  },
};
