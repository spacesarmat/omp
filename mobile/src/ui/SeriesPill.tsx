// The status pill of a series (the series screen's hero and the «Обзор» card): green while airing, grey when ended,
// red when canceled, the accent while in production or a season is still to come. Nothing when unknown.
import { seriesPill } from '../lib/seriesStatus';
import type { CatalogCard } from '../../../src/catalog/tmdb';

export function SeriesPill({ card }: { card: CatalogCard }) {
  const pill = seriesPill(card);
  if (!pill) return null;
  return <span class={'m-status-pill m-status-' + pill.tone}>{pill.text}</span>;
}
