// The small badge of a series tile in «Мои»: «новая серия 12.10» / «новый сезон» from the series' TMDB card.
// Only a match found before is read on render; a tile not looked up yet asks for a lookup once it comes into view
// (IntersectionObserver; the queue runs 2 at a time, one per series). Nothing without TMDB or a match.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { lang, t } from '../../../src/i18n';
import { cachedSeriesMatch, requestSeriesMatch, seriesMatchVersion } from '../../../src/lib/seriesMatch';
import { tileBadgeInfo } from '../../../src/lib/seriesStatus';
import { singleGroup, type SeriesGroup } from '../../../src/lib/seriesGroups';
import type { Torrent } from '../../../src/api/types';

export function SeriesTileBadge({ group, tor, split }: { group?: SeriesGroup; tor?: Torrent; split?: boolean }) {
  const g = useMemo(() => group || (tor ? singleGroup(tor) : null), [group, tor]);
  void seriesMatchVersion.value;
  const l = lang.value;
  const ref = useRef<HTMLSpanElement>(null);
  const card = g ? cachedSeriesMatch(g.key) : null;
  const unknown = !!g && card === undefined;
  useEffect(() => {
    const node = ref.current;
    if (!g || !unknown || !node || typeof IntersectionObserver === 'undefined') return;
    // the badge is empty until known: the tile it sits in is what comes into view
    const target = node.closest('[data-anchor]') || node.parentElement || node;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      requestSeriesMatch(g);
    });
    io.observe(target);
    return () => io.disconnect();
  }, [g ? g.key : '', unknown, l]);
  if (!g) return null;
  const info = card ? tileBadgeInfo(card, g.seasons) : { kind: '' as const, text: '', date: '' };
  const text = split && info.kind === 'episode' ? t('series.badgeEpisode') : info.text;
  const kind = info.kind === 'season' ? ' filled' : info.kind === 'episode' ? ' outline' : '';
  return (
    <span ref={ref} class={'m-new-badge' + kind} data-kind={info.kind || undefined} data-date={info.date || undefined}>
      {text}
    </span>
  );
}
