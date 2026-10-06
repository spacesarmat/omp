// One library card for a whole series: its newest season's poster, how many torrents it holds, and the TMDB status.
import { useEffect } from 'preact/hooks';
import { Focusable } from '../../ui/components';
import { Poster } from './Poster';
import { seriesName } from '../../lib/cleanNames';
import { groupLabel, type SeriesGroup } from '../../lib/seriesGroups';
import { requestSeriesMatch, cachedSeriesMatch, seriesMatchVersion } from '../../lib/seriesMatch';
import { seriesPill, type StatusPill } from '../../lib/seriesStatus';
import { tvGlyphs } from '../../ui/tvText';

/** The status of the series (null until TMDB answered, or when it has no such show); asks for the lookup once mounted. */
export function useSeriesPill(g: SeriesGroup): StatusPill | null {
  useEffect(() => { requestSeriesMatch(g); }, [g.key]);
  seriesMatchVersion.value; // re-render when a lookup ends
  const card = cachedSeriesMatch(g.key);
  return card ? seriesPill(card, Date.now()) : null;
}

export function SeriesPill(p: { pill: StatusPill; inline?: boolean }) {
  return <span class={'series-pill pill-' + p.pill.tone + (p.inline ? ' series-pill-inline' : '')}>{p.pill.text}</span>;
}

export function SeriesTile(p: { g: SeriesGroup; size: 'large' | 'small'; onOpen: (g: SeriesGroup) => void; onFocused: (g: SeriesGroup) => void; unload?: boolean }) {
  const g = p.g;
  const pill = useSeriesPill(g);
  return (
    <Focusable focusKey={'series-' + g.key} className={'tile tile-series tile-' + p.size} onPress={() => p.onOpen(g)} onFocused={() => p.onFocused(g)}>
      <Poster t={g.lead} showTitle unload={p.unload}>
        {g.members.length >= 2 && <div class="tile-count">{g.members.length}</div>}
        {pill && <SeriesPill pill={pill} />}
      </Poster>
      <div class="tile-title">{tvGlyphs(seriesName(g))}</div>
      {p.size === 'large' && <div class="tile-meta">{groupLabel(g)}</div>}
    </Focusable>
  );
}
