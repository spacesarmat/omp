// Unified search on screen: row keys, quality filter, sorting, the progress line, source states and the link to add.
// Shared by the phone and the Android TV bundle: Chromium 53 rules (no Object.values/entries, regex without u).
import { fmtNumber, t as tr, tp } from '../i18n';
import { parseDate, parseSize } from './html';
import { getSource } from './registry';
import { ipBanText, sourcePaused } from './ipBan';
import { getHealth } from './store';
import type { Source, SourceContext, SourceHealth, SourceResult } from './types';

export const jackettHint = (): string => tr('sources.jackettHint');

/**
 * Row key: two torrents of one release can share a title (Anidub, BigFANGroup), their pages differ.
 * A merged row keeps the key of its first result (groupKey), whichever duplicate wins later.
 */
export function resultKey(r: SourceResult): string {
  return r.groupKey || r.detailUrl || r.Link || r.Hash || r.Title;
}

/**
 * Order while results still stream in: rows already on screen keep their places (no row moves under the
 * finger or the TV cursor), new rows go below them, sorted among themselves.
 */
export function stableOrder(shownKeys: string[], list: SourceResult[], key: SortKey): SourceResult[] {
  const byKey: { [k: string]: SourceResult } = {};
  list.forEach((r) => {
    byKey[resultKey(r)] = r;
  });
  const kept: SourceResult[] = [];
  const seen: { [k: string]: boolean } = {};
  shownKeys.forEach((k) => {
    if (byKey[k] && !seen[k]) {
      kept.push(byKey[k]);
      seen[k] = true;
    }
  });
  return kept.concat(sortResults(list.filter((r) => !seen[resultKey(r)]), key));
}

/** «1 сид», «3 сида», «312 сидов». */
export function seedsText(n: number): string {
  return tp('sources.seeds', n);
}

/** Badge of a row: the source name; Torznab rows also name the tracker behind Jackett / Prowlarr. */
export function sourceBadge(r: SourceResult): string {
  if (r.source === 'ts-torznab' && r.Tracker) return 'Torznab · ' + r.Tracker;
  return sourceName(r.source);
}

/** The error is a Cloudflare block (the site wants a real browser): Jackett / Prowlarr is the way around it. */
export function isCloudflare(message: string | undefined | null): boolean {
  return !!message && message.indexOf('Cloudflare') >= 0;
}

/** 2160 / 1080 / 720 from the title, 0 when unknown. */
export function qualityOf(title: string): number {
  const t = title || '';
  if (/(^|[^0-9a-z])(2160[pi]?|4k|uhd)([^0-9a-z]|$)/i.test(t)) return 2160;
  if (/(^|[^0-9])1080[pi]/i.test(t)) return 1080;
  if (/(^|[^0-9])720p/i.test(t)) return 720;
  return 0;
}

/** '' = any, '1080' = 1080p and better, '2160' = 2160p only. */
export type QualityFilter = '' | '1080' | '2160';

export function filterQuality(list: SourceResult[], q: QualityFilter): SourceResult[] {
  if (!q) return list.slice();
  const min = q === '2160' ? 2160 : 1080;
  return list.filter((r) => qualityOf(r.Title) >= min);
}

export type SortKey = 'seeds' | 'date' | 'size';

export const sortLabels = (): { key: SortKey; label: string }[] => [
  { key: 'seeds', label: tr('sources.sort.seeds') },
  { key: 'date', label: tr('sources.sort.date') },
  { key: 'size', label: tr('library.sortSize') },
];

function sizeOf(r: SourceResult): number {
  if (typeof r.sizeBytes === 'number') return r.sizeBytes;
  const s = parseSize(r.Size || '');
  return s === null ? 0 : s;
}

function dateOf(r: SourceResult): number {
  if (typeof r.date === 'number') return r.date;
  const d = r.CreateDate ? parseDate(r.CreateDate) : undefined;
  return d === undefined ? 0 : d;
}

/** A sorted copy (descending, stable: old engines do not keep equal items in place). */
export function sortResults(list: SourceResult[], key: SortKey): SourceResult[] {
  const val = key === 'date' ? dateOf : key === 'size' ? sizeOf : (r: SourceResult) => r.Seed || 0;
  return list
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.r);
}

export function sourceName(id: string): string {
  const s = getSource(id);
  return s ? s.name : id;
}

export interface Progress {
  found: number;
  answered: number;
  total: number;
  /** Names of the sources still searching. */
  pending: string[];
  /** Names of the sources that failed. */
  failed: string[];
}

/** «Найдено N · K из M источников ответили · ещё ищу в …». */
export function progressText(p: Progress): string {
  let s = tp('sources.progress.line', p.answered, { found: p.found, sources: tp('sources.progress.sources', p.total) });
  if (p.pending.length) s += ' · ' + tr('sources.progress.searchingIn', { names: p.pending.join(', ') });
  else if (p.failed.length) s += ' · ' + tr('sources.progress.failed', { names: p.failed.join(', ') });
  return s;
}

export interface HealthLine {
  text: string;
  tone: 'ok' | 'bad' | 'muted';
}

/** State line of a source in «Источники поиска»; null before its first search. */
export function healthText(h: SourceHealth | null): HealthLine | null {
  if (!h) return null;
  if (h.state === 'ok') {
    const secs = typeof h.ms === 'number' ? ' · ' + fmtNumber(Math.round(h.ms / 100) / 10, 1) + ' ' + tr('common.sec') : '';
    return { text: tr('sources.state.ok') + secs, tone: 'ok' };
  }
  if (h.state === 'login') return { text: tr('sources.state.login'), tone: 'muted' };
  if (isCloudflare(h.message)) return { text: h.message!, tone: 'bad' };
  // the site's code page: its own message («torrent.by просит ввести проверочный код»), not «не отвечает»
  if (h.code === 'ipban' && h.message) return { text: h.message, tone: 'bad' };
  return { text: tr('sources.state.noAnswer'), tone: 'bad' };
}

/**
 * The site's code page (ipBan.ts): the message of its last search, or of a background pause when it has no state yet;
 * '' otherwise.
 */
export function ipBanNote(id: string): string {
  const h = getHealth(id);
  if (h) return h.code === 'ipban' && h.message ? h.message : '';
  return sourcePaused(id) ? ipBanText(sourceName(id)) : '';
}

/** The short hint under a site whose last search hit Cloudflare. */
export interface CloudflareHint {
  text: string;
  /** Add the «Как» link to the FAQ about Jackett / Prowlarr (a site without a browser login). */
  how: boolean;
}

/**
 * The site's own way past Cloudflare: a site with a browser login signs in there (again, when it is signed in already);
 * any other site goes through Jackett / Prowlarr, FlareSolverr included.
 */
export function cloudflareHint(s: Pick<Source, 'name' | 'browserLogin'>, loggedIn: boolean): CloudflareHint {
  if (s.browserLogin) return { text: tr(loggedIn ? 'sources.cfHint.again' : 'sources.cfHint.login'), how: false };
  return { text: tr('sources.cfHint.jackett', { name: s.name }), how: true };
}

/** A site behind Cloudflare: «за Cloudflare» joins its note unless the note is an error. */
export function withCloudflareNote(note: HealthLine | null): HealthLine {
  const cf = tr('sources.state.behindCf');
  if (!note) return { text: cf, tone: 'muted' };
  if (note.tone === 'bad') return note;
  return { text: note.text + ' · ' + cf, tone: note.tone };
}

function two(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** dd.mm.yyyy of the release, '' when unknown. */
export function resultDate(r: SourceResult): string {
  const t = dateOf(r);
  if (!t) return '';
  const d = new Date(t);
  return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
}

const ADDABLE = /^(magnet:\?|https?:\/\/)/i;

function fail(msg: string): Promise<string> {
  return Promise.reject(new Error(msg));
}

/**
 * The link TorrServer adds: the magnet of the result, else the one the source takes from the release page
 * (a magnet, or an http(s) .torrent link), else Link, else a magnet from the hash.
 */
export function resolveLink(r: SourceResult, ctx: SourceContext): Promise<string> {
  if (r.Magnet) return Promise.resolve(r.Magnet);
  const src = getSource(r.source);
  if (src && src.resolve) {
    try {
      return Promise.resolve(src.resolve(r, ctx));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  if (src && src.magnet && r.detailUrl) {
    let p: Promise<string>;
    try {
      p = Promise.resolve(src.magnet(r.detailUrl, ctx));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then((l) => (typeof l === 'string' && ADDABLE.test(l.trim()) ? l.trim() : fail(tr('sources.cannotGetLink'))));
  }
  if (r.Link) return Promise.resolve(r.Link);
  if (r.Hash) return Promise.resolve('magnet:?xt=urn:btih:' + r.Hash);
  return fail(tr('sources.noLink'));
}
