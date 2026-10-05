// «Обзор»: the sort and the filters, kept across launches (sanitized on read).
import { loadJson, saveJson } from '../../../../src/store/storage';
import { sanitizeDiscoverQuery, type DiscoverQuery } from '../../../../src/catalog/discoverQuery';

export const DISCOVER_QUERY_KEY = 'tsp.discoverQuery';

export function loadDiscoverQuery(): DiscoverQuery {
  return sanitizeDiscoverQuery(loadJson<unknown>(DISCOVER_QUERY_KEY, null));
}

export function saveDiscoverQuery(q: DiscoverQuery): void {
  saveJson(DISCOVER_QUERY_KEY, sanitizeDiscoverQuery(q));
}
