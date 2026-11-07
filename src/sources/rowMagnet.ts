// A feed row can name its site, size and seed count and still have no magnet. NNM-Club's list page
// is that case: the announce URLs live on the topic page, which source.magnet() already loads.
// Nothing here invents a tracker URL. A failed fetch keeps the source's own error.
import { t } from '../i18n';
import { infohashOf, trackerTargets } from './liveSeeds';
import { getSource } from './registry';
import type { SourceContext, SourceResult } from './types';

/** The list row has no announce URL, and its source can load one from the topic page. */
export function rowNeedsMagnet(r: SourceResult): boolean {
  const hash = infohashOf(r);
  if (hash && trackerTargets(r.Magnet || '', hash).length) return false;
  const src = getSource(r.source);
  return !!(src && src.magnet && /^https?:\/\//i.test(r.detailUrl || ''));
}

/**
 * Copy of the row with the topic page's magnet, when the source knows how to load it.
 * `note` is set only after that load fails or the page has no announce URL.
 */
export function resolveRowMagnet(r: SourceResult, ctx: SourceContext): Promise<{ row: SourceResult; note?: string }> {
  const hash = infohashOf(r);
  if (hash && trackerTargets(r.Magnet || '', hash).length) return Promise.resolve({ row: r });
  const src = getSource(r.source);
  const url = r.detailUrl || '';
  if (!src || !src.magnet || !/^https?:\/\//i.test(url)) return Promise.resolve({ row: r });
  return src.magnet(url, ctx).then(
    (magnet) => {
      if (!magnet || magnet.indexOf('magnet:') !== 0) return { row: r, note: t('sources.seedsOnTopic') };
      const next: SourceResult = { ...r, Magnet: magnet };
      const got = infohashOf(next);
      if (got && trackerTargets(magnet, got).length) return { row: next };
      return { row: next, note: t('sources.seedsNoTracker') };
    },
    (e: unknown) => ({ row: r, note: e instanceof Error && e.message ? e.message : t('sources.seedsOnTopic') }),
  );
}
