// Duplicates across sources: by infohash when known (the row, the Hash field, or the magnet), else by
// normalized title + size within ±1%.
import { infohashFromMagnet } from './html';
import type { SourceResult } from './types';

/** Lowercase, ё→е, punctuation and spaces collapsed to single spaces. */
export function normalizeTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim();
}

function sameSize(a: number | undefined, b: number | undefined): boolean {
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(a, b) * 0.01;
}

/** Lowercase infohash: `.hash`, a 40-hex `Hash`, or the magnet. '' when the row has none. */
function hashKey(r: SourceResult): string {
  const direct = (r.hash || '').toLowerCase();
  if (direct) return direct;
  const field = (r.Hash || '').toLowerCase();
  if (/^[0-9a-f]{40}$/.test(field)) return field;
  return infohashFromMagnet(r.Magnet) || '';
}

interface Item {
  r: SourceResult;
  title: string;
}

function same(a: Item, b: Item): boolean {
  const ha = hashKey(a.r);
  const hb = hashKey(b.r);
  if (ha && hb) return ha === hb;
  return a.title !== '' && a.title === b.title && sameSize(a.r.sizeBytes, b.r.sizeBytes);
}

/**
 * Merges duplicates: the kept result is the one with most seeds, `sources` lists the other sources
 * (each once, never the kept one). A missing magnet / hash is taken from a duplicate. Group order is the
 * order of first appearance; the input is not changed.
 */
export function mergeResults(list: SourceResult[]): SourceResult[] {
  const groups: Item[][] = [];
  list.forEach((r) => {
    const item: Item = { r, title: normalizeTitle(r.Title) };
    const hash = hashKey(r);
    let target: Item[] | null = null;
    // a known infohash wins: the group holding the same hash, before any title + size match
    if (hash) {
      for (let i = 0; i < groups.length && !target; i++) {
        if (groups[i].some((g) => hashKey(g.r) === hash)) target = groups[i];
      }
    }
    for (let i = 0; i < groups.length && !target; i++) {
      const conflict = !!hash && groups[i].some((g) => {
        const gh = hashKey(g.r);
        return !!gh && gh !== hash;
      });
      if (!conflict && groups[i].some((g) => same(g, item))) target = groups[i];
    }
    if (target) target.push(item);
    else groups.push([item]);
  });
  return groups.map((g) => {
    let best = g[0].r;
    g.forEach((it) => {
      if (it.r.Seed > best.Seed) best = it.r;
    });
    const out: SourceResult = { ...best };
    delete out.sources;
    const first = g[0].r;
    out.groupKey = first.groupKey || first.detailUrl || first.Link || first.Hash || first.Title;
    const others: string[] = [];
    g.forEach((it) => {
      const r = it.r;
      if (r.source !== best.source && others.indexOf(r.source) < 0) others.push(r.source);
      if (!out.Magnet && r.Magnet) out.Magnet = r.Magnet;
      if (!out.hash && r.hash) out.hash = r.hash;
      if (!out.hash) {
        const h = hashKey(r);
        if (h) out.hash = h;
      }
    });
    if (others.length) out.sources = others;
    return out;
  });
}
