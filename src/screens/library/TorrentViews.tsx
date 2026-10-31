import type { Torrent } from '../../api/types';
import { fmtSize, tp } from '../../i18n';
import { parseReleaseInfo, releaseBadges, displayBadge } from '../../lib/releaseInfo';
import { categoryTabs, categoryOf } from '../../lib/category';
import type { LibraryView } from '../../lib/libraryView';
import { FocusGroup, Focusable } from '../../ui/components';
import { Poster } from './Poster';
import { displayTitle } from '../../lib/torrentName';
import { libraryTitle } from '../../lib/libraryView';
import { groupLabel, groupSize, singleGroup, type SeriesGroup } from '../../lib/seriesGroups';
import { groupPhoneLibrary, type FilmGroup } from '../../../mobile/src/lib/filmGroups';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SeriesTile, useSeriesPill, SeriesPill } from './SeriesTile';
import { tvGlyphs } from '../../ui/tvText';
import { seriesName } from '../../lib/cleanNames';
import { requestSeriesMatch, cachedSeriesMatch, seriesMatchVersion } from '../../lib/seriesMatch';
import { focusedRow, keepRows, keepsImage, rowOf } from '../../lib/gridWindow';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';

/** Tiles per row. The safe width is 1728px (96-1824); the CSS column count matches. */
export const VIEW_COLS: { [v in LibraryView]: number } = { large: 6, small: 9, list: 1, compact: 1 };
/** The height of a row of each view, px (poster, title, meta and the gap under it). */
const ROW_PX: { [v in LibraryView]: number } = { large: 560, small: 420, list: 140, compact: 70 };

interface ItemProps {
  t: Torrent;
  onOpen: (t: Torrent) => void;
  onFocused: (t: Torrent | SeriesGroup) => void;
  /** Far from the focus: the poster image is let go. */
  unload?: boolean;
  /** Replaces the usual meta line (a film card: the year and how many releases). */
  metaLine?: string;
  /** Replaces the torrent's own size (a film card: every release). */
  sizeBytes?: number;
  /** A count on the poster when several releases share the card. */
  count?: number;
}

function filmLine(g: FilmGroup): string {
  const year = libraryTitle(g.lead).meta;
  const n = g.members.length > 1 ? tp('series.releases', g.members.length) : '';
  return [year, n].filter(Boolean).join(' · ');
}

function filmBytes(g: FilmGroup): number {
  return g.members.reduce((n, m) => n + (m.torrent_size || 0), 0);
}

/**
 * The name of a lone torrent: the TMDB show's once its series is matched (looked up once the tile is shown), else the
 * short title; a film keeps its short title.
 */
function useLoneName(t: Torrent): string {
  const g = useMemo(() => singleGroup(t), [t]);
  useEffect(() => {
    if (g) requestSeriesMatch(g);
  }, [g ? g.key : '']);
  void seriesMatchVersion.value; // re-render when a lookup ends
  const card = g ? cachedSeriesMatch(g.key) : null;
  return card && card.title ? card.title : libraryTitle(t).title;
}

function badgesOf(t: Torrent, max: number): string[] {
  const all = releaseBadges(parseReleaseInfo(displayTitle(t))).map(displayBadge);
  // a year on an empty poster is the lowest-priority badge, and it is not shown there at all
  const list = t.poster ? all : all.filter((b) => !/^[0-9]{4}$/.test(b));
  return list.slice(0, max);
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

const metaOf = (t: Torrent) => tvGlyphs(libraryTitle(t).meta);

function Tile(p: ItemProps & { size: 'large' | 'small' }) {
  const t = p.t;
  const name = useLoneName(t);
  return (
    <Focusable focusKey={'torrent-' + t.hash} className={'tile tile-' + p.size} onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} showTitle unload={p.unload}>
        {p.count && p.count >= 2 ? <div class="tile-count">{p.count}</div> : null}
        <Badges list={badgesOf(t, p.size === 'large' ? 2 : 1)} className="art-badges" />
      </Poster>
      <div class="tile-title">{tvGlyphs(name)}</div>
      <div class="tile-meta">{p.metaLine !== undefined ? (p.metaLine || '\u00a0') : (metaOf(t) || (p.size === 'large' ? fmtSize(t.torrent_size || 0) : '\u00a0'))}</div>
    </Focusable>
  );
}

function Row(p: ItemProps) {
  const t = p.t;
  const name = useLoneName(t);
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="lrow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <Poster t={t} unload={p.unload} />
      <div class="lrow-main">
        <div class="lrow-title">{tvGlyphs(name)}</div>
        {(p.metaLine !== undefined ? p.metaLine : metaOf(t)) && <div class="lrow-meta">{p.metaLine !== undefined ? p.metaLine : metaOf(t)}</div>}
        <Badges list={badgesOf(t, 5)} />
      </div>
      <div class="lrow-cat">{categoryLabel(t)}</div>
      <div class="lrow-size">{fmtSize(p.sizeBytes !== undefined ? p.sizeBytes : t.torrent_size || 0)}</div>
    </Focusable>
  );
}

function CompactRow(p: ItemProps) {
  const t = p.t;
  const name = useLoneName(t);
  return (
    <Focusable focusKey={'torrent-' + t.hash} className="crow" onPress={() => p.onOpen(t)} onFocused={() => p.onFocused(t)}>
      <div class="crow-title">{tvGlyphs(name)}{(p.metaLine !== undefined ? p.metaLine : metaOf(t)) && <span class="crow-meta">{' · ' + (p.metaLine !== undefined ? p.metaLine : metaOf(t))}</span>}</div>
      <Badges list={badgesOf(t, 2)} className="crow-badges" />
      <div class="crow-size">{fmtSize(p.sizeBytes !== undefined ? p.sizeBytes : t.torrent_size || 0)}</div>
    </Focusable>
  );
}

function SeriesRow(p: { g: SeriesGroup; onOpen: (g: SeriesGroup) => void; onFocused: (g: SeriesGroup) => void; unload?: boolean }) {
  const g = p.g;
  const pill = useSeriesPill(g, true);
  return (
    <Focusable focusKey={'series-' + g.key} className="lrow" onPress={() => p.onOpen(g)} onFocused={() => p.onFocused(g)}>
      <Poster t={g.lead} unload={p.unload} />
      <div class="lrow-main">
        <div class="lrow-title">{tvGlyphs(seriesName(g))}</div>
        <div class="lrow-meta">{groupLabel(g)}</div>
        {pill && <SeriesPill pill={pill} inline />}
      </div>
      <div class="lrow-cat">{categoryLabel(g.named)}</div>
      <div class="lrow-size">{fmtSize(groupSize(g))}</div>
    </Focusable>
  );
}

function SeriesCompact(p: { g: SeriesGroup; onOpen: (g: SeriesGroup) => void; onFocused: (g: SeriesGroup) => void }) {
  const g = p.g;
  const pill = useSeriesPill(g, true);
  return (
    <Focusable focusKey={'series-' + g.key} className="crow" onPress={() => p.onOpen(g)} onFocused={() => p.onFocused(g)}>
      <div class="crow-title">{tvGlyphs(seriesName(g))}<span class="crow-meta">{' · ' + groupLabel(g)}</span></div>
      {pill && <SeriesPill pill={pill} inline />}
      <div class="crow-size">{fmtSize(groupSize(g))}</div>
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
    () => (grouped ? groupPhoneLibrary(p.list) : p.list.map((tor) => ({ kind: 'torrent' as const, tor }))),
    [p.list, grouped],
  );
  const openSeries = p.onOpenSeries || (() => undefined);
  // the focused row: posters further than about 3 screens from it are let go (webOS 4 memory)
  const cols = VIEW_COLS[p.view];
  const keep = keepRows(ROW_PX[p.view]);
  const [focusRow, setFocusRow] = useState(0);
  const rowRef = useRef(0);
  const setRow = (r: number) => {
    if (r === rowRef.current) return;
    rowRef.current = r;
    setFocusRow(r);
  };
  const focusAt = (i: number) => setRow(rowOf(i, cols));
  // another tab, a search or a refresh: the window follows the focused tile where it is now (the top when none)
  const keys = items.map((it) => (it.kind === 'series' ? 'series-' + it.key : 'torrent-' + (it.kind === 'film' ? it.lead.hash : it.tor.hash)));
  const keysId = keys.join('|') + '#' + cols;
  useEffect(() => {
    let cur = '';
    try {
      cur = getCurrentFocusKey() || '';
    } catch (e) {
      cur = '';
    }
    setRow(focusedRow(keys, cur, cols));
  }, [keysId]);
  return (
    <FocusGroup focusKey="LIB-GRID" className={tiles ? 'views-tiles' : 'views-rows'}>
      {items.map((it, i) => {
        const unload = !keepsImage(i, focusRow, cols, keep);
        const focused = (x: Torrent | SeriesGroup) => {
          focusAt(i);
          p.onFocused(x);
        };
        if (it.kind === 'series') {
          if (p.view === 'large' || p.view === 'small') return <SeriesTile key={'s-' + it.key} g={it} size={p.view} onOpen={openSeries} onFocused={focused} unload={unload} />;
          if (p.view === 'list') return <SeriesRow key={'s-' + it.key} g={it} onOpen={openSeries} onFocused={focused} unload={unload} />;
          return <SeriesCompact key={'s-' + it.key} g={it} onOpen={openSeries} onFocused={focused} />;
        }
        if (it.kind === 'film') {
          const g = it;
          const line = filmLine(g);
          const bytes = filmBytes(g);
          if (p.view === 'large' || p.view === 'small') return <Tile key={'f-' + g.lead.hash} t={g.lead} size={p.view} metaLine={line} count={g.members.length} onOpen={p.onOpen} onFocused={focused} unload={unload} />;
          if (p.view === 'list') return <Row key={'f-' + g.lead.hash} t={g.lead} metaLine={line} sizeBytes={bytes} onOpen={p.onOpen} onFocused={focused} unload={unload} />;
          return <CompactRow key={'f-' + g.lead.hash} t={g.lead} metaLine={line} sizeBytes={bytes} onOpen={p.onOpen} onFocused={focused} />;
        }
        const t = it.tor;
        if (p.view === 'large' || p.view === 'small') return <Tile key={t.hash} t={t} size={p.view} onOpen={p.onOpen} onFocused={focused} unload={unload} />;
        if (p.view === 'list') return <Row key={t.hash} t={t} onOpen={p.onOpen} onFocused={focused} unload={unload} />;
        return <CompactRow key={t.hash} t={t} onOpen={p.onOpen} onFocused={focused} />;
      })}
    </FocusGroup>
  );
}
