// Duplicates across sources: by infohash when known, else by normalized title + size within ±1%.
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

interface Item {
  r: SourceResult;
  title: string;
}

function same(a: Item, b: Item): boolean {
  if (a.r.hash && b.r.hash) return a.r.hash === b.r.hash;
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
    let target: Item[] | null = null;
    // a known infohash wins: the group holding the same hash, before any title + size match
    if (item.r.hash) {
      for (let i = 0; i < groups.length && !target; i++) {
        if (groups[i].some((g) => g.r.hash === item.r.hash)) target = groups[i];
      }
    }
    for (let i = 0; i < groups.length && !target; i++) {
      const conflict = !!item.r.hash && groups[i].some((g) => !!g.r.hash && g.r.hash !== item.r.hash);
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
    });
    if (others.length) out.sources = others;
    return out;
  });
}
