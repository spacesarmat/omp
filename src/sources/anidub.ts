// tr.anidub.com (DLE, UTF-8): the search list has releases only; each release page has one or more torrents
// (per format tab) with .torrent links that download without a login, and no magnet links. TorrServer adds an
// http(s) .torrent link itself, so a result carries it in Link (Magnet and hash stay empty).
import { absUrl, parseSize, textOf } from './html';
import { loadDoc, makeResult, PARSE_ERROR, requireHost, toInt } from './site';
import type { Source, SourceContext, SourceResult } from './types';

const HOST = 'tr.anidub.com';
const BASE = 'https://' + HOST;
const SEARCH = BASE + '/index.php?do=search&subaction=search&story=';
/** Release pages opened at once. */
const PARALLEL = 4;
export const ANIDUB_NO_TORRENT = 'На странице раздачи нет ссылки на торрент';

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

/** Opens the release pages, PARALLEL at a time; a failed page is skipped unless every page failed. */
function openReleases(ctx: SourceContext, releases: Release[]): Promise<SourceResult[]> {
  const found: SourceResult[][] = [];
  let failures = 0;
  let firstError: unknown = null;
  let next = 0;
  const worker = (): Promise<void> => {
    if (next >= releases.length) return Promise.resolve();
    const i = next++;
    const r = releases[i];
    return requireHost(r.url, HOST)
      .then(() => loadDoc(ctx, r.url))
      .then(
        (p) => {
          found[i] = parseRelease(p.doc, r);
        },
        (e: unknown) => {
          failures++;
          if (firstError === null) firstError = e;
        },
      )
      .then(worker);
  };
  const workers: Promise<void>[] = [];
  for (let k = 0; k < Math.min(PARALLEL, releases.length); k++) workers.push(worker());
  return Promise.all(workers).then(() => {
    if (releases.length && failures === releases.length) throw firstError;
    const out: SourceResult[] = [];
    for (let i = 0; i < releases.length; i++) if (found[i]) out.push.apply(out, found[i]);
    return out;
  });
}

export const anidub: Source = {
  id: 'anidub',
  name: 'Anidub',
  kind: 'builtin',
  search(query: string, ctx: SourceContext) {
    return loadDoc(ctx, SEARCH + encodeURIComponent(query)).then((p) => openReleases(ctx, parseList(p.doc, p.res.url || BASE)));
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
