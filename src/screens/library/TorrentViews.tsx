import type { Torrent } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { parseReleaseInfo, releaseBadges, displayBadge } from '../../lib/releaseInfo';
import { categoryTabs, categoryOf } from '../../lib/category';
import type { LibraryView } from '../../lib/libraryView';
import { FocusGroup, Focusable } from '../../ui/components';
import { Poster } from './Poster';
import { displayTitle } from '../../lib/torrentName';
import { libraryTitle } from '../../lib/libraryView';
import { groupLibrary, groupLabel, groupSize, type SeriesGroup } from '../../lib/seriesGroups';
import { useMemo } from 'preact/hooks';
import { SeriesTile, useSeriesPill, SeriesPill } from './SeriesTile';
import { tvGlyphs } from '../../ui/tvText';

interface ItemProps {
  t: Torrent;
  onOpen: (t: Torrent) => void;
  onFocused: (t: Torrent | SeriesGroup) => void;
}

function badgesOf(t: Torrent, max: number): string[] {
  return releaseBadges(parseReleaseInfo(displayTitle(t))).map(displayBadge).slice(0, max);
}

function Badges(p: { list: string[]; className?: string }) {
  return p.list.length ? <div class={p.className || 'badges'}>{p.list.map((b) => <span key={b} class="badge">{b}</span>)}</div> : null;
}

function categoryLabel(t: Torrent): string {
  const id = categoryOf(t.category);
  const tabs = categoryTabs();
  for (let i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i].label;
  return '';
}

const titleOf = (t: Torrent) => tvGlyphs(libraryTitle(t).title);
const metaOf = (t: Torrent) => tvGlyphs(libraryTitle(t).meta);

function Tile(p: ItemProps & { size: 'large' | 'small' }) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className={'tile tile-' + p.size} onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} showTitle>
        <Badges list={badgesOf(t, p.size === 'large' ? 3 : 1)} className="art-badges" />
      </Poster>
      <div class="tile-title">{titleOf(t)}</div>
      {p.size === 'large' && <div class="tile-meta">{metaOf(t) || formatBytes(t.torrent_size || 0)}</div>}
    </Focusable>
  );
}

function Row(p: ItemProps) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="lrow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} />
      <div class="lrow-main">
        <div class="lrow-title">{titleOf(t)}</div>
        {metaOf(t) && <div class="lrow-meta">{metaOf(t)}</div>}
        <Badges list={badgesOf(t, 5)} />
      </div>
      <div class="lrow-cat">{categoryLabel(t)}</div>
      <div class="lrow-size">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

function CompactRow(p: ItemProps) {
  const t = p.t;
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="crow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <div class="crow-title">{titleOf(t)}{metaOf(t) && <span class="crow-meta">{' · ' + metaOf(t)}</span>}</div>
      <Badges list={badgesOf(t, 2)} className="crow-badges" />
      <div class="crow-size">{formatBytes(t.torrent_size || 0)}</div>
    </Focusable>
  );
}

function SeriesRow(p: { g: SeriesGroup; onOpen: (g: SeriesGroup) => void; onFocused: (g: SeriesGroup) => void }) {
  const g = p.g;
  const pill = useSeriesPill(g);
  return (
    <Focusable focusKey={'series-' + g.key} className="lrow" onPress={() => p.onOpen(g)} onFocused={() => p.onFocused(g)}>
      <Poster t={g.lead} />
      <div class="lrow-main">
        <div class="lrow-title">{tvGlyphs(libraryTitle(g.named).title)}</div>
        <div class="lrow-meta">{groupLabel(g)}</div>
        {pill && <SeriesPill pill={pill} inline />}
      </div>
      <div class="lrow-cat">{categoryLabel(g.named)}</div>
      <div class="lrow-size">{formatBytes(groupSize(g))}</div>
    </Focusable>
  );
}

function SeriesCompact(p: { g: SeriesGroup; onOpen: (g: SeriesGroup) => void; onFocused: (g: SeriesGroup) => void }) {
  const g = p.g;
  const pill = useSeriesPill(g);
  return (
    <Focusable focusKey={'series-' + g.key} className="crow" onPress={() => p.onOpen(g)} onFocused={() => p.onFocused(g)}>
      <div class="crow-title">{tvGlyphs(libraryTitle(g.named).title)}<span class="crow-meta">{' · ' + groupLabel(g)}</span></div>
      {pill && <SeriesPill pill={pill} inline />}
      <div class="crow-size">{formatBytes(groupSize(g))}</div>
    </Focusable>
  );
}

export function TorrentViews(p: {
  view: LibraryView;
  list: Torrent[];
  /** Group the series (the «Все» and «Сериалы» tabs); default true. */
  group?: boolean;
  onOpen: (t: Torrent) => void;
  onOpenSeries?: (g: SeriesGroup) => void;
  onFocused: (t: Torrent | SeriesGroup) => void;
}) {
  const tiles = p.view === 'large' || p.view === 'small';
  const grouped = p.group !== false;
  const items = useMemo(
    () => (grouped ? groupLibrary(p.list) : p.list.map((tor) => ({ kind: 'torrent' as const, tor }))),
    [p.list, grouped],
  );
  const openSeries = p.onOpenSeries || (() => undefined);
  return (
    <FocusGroup focusKey="LIB-GRID" className={tiles ? 'views-tiles' : 'views-rows'}>
      {items.map((it) => {
        if (it.kind === 'series') {
          if (p.view === 'large' || p.view === 'small') return <SeriesTile key={'s-' + it.key} g={it} size={p.view} onOpen={openSeries} onFocused={p.onFocused} />;
          if (p.view === 'list') return <SeriesRow key={'s-' + it.key} g={it} onOpen={openSeries} onFocused={p.onFocused} />;
          return <SeriesCompact key={'s-' + it.key} g={it} onOpen={openSeries} onFocused={p.onFocused} />;
        }
        const t = it.tor;
        if (p.view === 'large' || p.view === 'small') return <Tile key={t.hash} t={t} size={p.view} onOpen={p.onOpen} onFocused={p.onFocused} />;
        if (p.view === 'list') return <Row key={t.hash} t={t} onOpen={p.onOpen} onFocused={p.onFocused} />;
        return <CompactRow key={t.hash} t={t} onOpen={p.onOpen} onFocused={p.onFocused} />;
      })}
    </FocusGroup>
  );
}
