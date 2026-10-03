// All search sources: TorrServer rutor and Torznab first, then the built-in parsers (registered by their modules).
import type { SearchResult } from '../api/types';
import type { SearchSource } from '../api/torrserver';
import { infohashFromMagnet, parseDate, parseSize } from './html';
import type { Source, SourceContext, SourceResult } from './types';

/** A TorrServer search result as a SourceResult of `source`. */
export function fromSearchResult(r: SearchResult, source: string): SourceResult {
  const out: SourceResult = { ...r, source };
  const hex = typeof r.Hash === 'string' ? r.Hash.toLowerCase() : '';
  const hash = /^[0-9a-f]{40}$/.test(hex) ? hex : infohashFromMagnet(r.Magnet);
  if (hash) out.hash = hash;
  const size = parseSize(r.Size);
  if (size !== null) out.sizeBytes = size;
  const date = parseDate(r.CreateDate);
  if (date !== undefined) out.date = date;
  if (typeof r.Link === 'string' && /^https?:\/\//i.test(r.Link)) out.detailUrl = r.Link;
  return out;
}

function torrServerSource(id: string, name: string, kind: SearchSource): Source {
  return {
    id,
    name,
    kind: 'torrserver',
    search(query: string, ctx: SourceContext) {
      if (!ctx.client) return Promise.reject(new Error('Нет сервера'));
      return ctx.client.search(query, kind).then((list) => (list || []).map((r) => fromSearchResult(r, id)));
    },
  };
}

const TS: Source[] = [
  torrServerSource('ts-rutor', 'rutor (TorrServer)', 'rutor'),
  torrServerSource('ts-torznab', 'Torznab', 'torznab'),
];

let builtins: Source[] = [];

export function torrServerSources(): Source[] {
  return TS.slice();
}

export function builtinSources(): Source[] {
  return builtins.slice();
}

/** Adds a built-in source (replaces one with the same id). */
export function registerSource(s: Source): void {
  builtins = builtins.filter((b) => b.id !== s.id).concat([s]);
}

export function unregisterSource(id: string): void {
  builtins = builtins.filter((b) => b.id !== id);
}

export function allSources(): Source[] {
  return TS.concat(builtins);
}

export function getSource(id: string): Source | undefined {
  const all = allSources();
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return undefined;
}
