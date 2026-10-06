import { useEffect } from 'preact/hooks';
import { positionLabel, remainingLabel } from '../../lib/libraryView';
import { historyFilters, sourceLine, type HistoryFilter, type HistoryItem } from '../../lib/history';
import { FocusGroup, Focusable, ProgressBar } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { Poster } from './Poster';
import { tvGlyphs } from '../../ui/tvText';
import { torrents } from '../../store/library';
import { episodeOf, episodeSubLine, isFilmFile, seriesGroupOf, torrentName } from '../../lib/cleanNames';
import { requestSeriesMatch, seriesMatchVersion } from '../../lib/seriesMatch';
import { useEpisodeName } from '../../lib/useEpisodeName';

export type HistoryEntry = HistoryItem;

/** «Все / С телевизора / С телефона» above the history cards. */
export function HistoryFilterRow(p: { value: HistoryFilter; onChange: (f: HistoryFilter) => void; onFocused?: () => void }) {
  return (
    <FocusGroup focusKey="LIB-HFILTER" className="history-filter">
      {historyFilters().map((f) => (
        <Focusable
          key={f.id}
          focusKey={'hfilter-' + f.id}
          className={'hfilter' + (p.value === f.id ? ' active' : '')}
          onPress={() => p.onChange(f.id)}
          onFocused={p.onFocused}
        >
          {f.label}
        </Focusable>
      ))}
    </FocusGroup>
  );
}

export function HistoryGrid(p: {
  entries: HistoryEntry[];
  /** Unix ms for «сегодня / вчера» (defaults to now). */
  now?: number;
  filePath: (e: HistoryEntry) => string;
  onOpen: (e: HistoryEntry) => void;
  onFocused: (e: HistoryEntry) => void;
}) {
  const now = p.now === undefined ? Date.now() : p.now;
  return (
    <FocusGroup focusKey="LIB-GRID" className="history-grid">
      {p.entries.map((e) => (
        <HistoryCard key={e.torrent.hash + ':' + e.fileIndex} e={e} now={now} path={p.filePath(e)} onOpen={p.onOpen} onFocused={p.onFocused} />
      ))}
    </FocusGroup>
  );
}

/** One history card: the clean name (TMDB's once matched), «Season 2 · Episode 1 · Name», never a file name. */
function HistoryCard(p: { e: HistoryEntry; now: number; path: string; onOpen: (e: HistoryEntry) => void; onFocused: (e: HistoryEntry) => void }) {
  const e = p.e;
  const t = e.torrent;
  const pr = e.progress;
  const list = torrents.value;
  void seriesMatchVersion.value; // re-render when a series lookup ends
  const g = seriesGroupOf(t, list);
  useEffect(() => {
    if (g) requestSeriesMatch(g);
  }, [g ? g.key : '']);
  const ep = episodeOf(p.path, t.title);
  const name = useEpisodeName(t, ep);
  return (
    <Focusable
      focusKey={'hist-' + t.hash + '-' + e.fileIndex}
      className="hcard"
      onPress={() => p.onOpen(e)}
      onFocused={() => p.onFocused(e)}
    >
      <Poster t={t} />
      <div class="hcard-main">
        <div class="hcard-title">{tvGlyphs(torrentName(t, list))}</div>
        <div class="hcard-ep">{tvGlyphs(episodeSubLine(ep, name, isFilmFile(t, p.path)))}</div>
        <div class="hcard-time">
          <span>{positionLabel(pr.time, pr.duration)}</span>
          <span class="hcard-left">{remainingLabel(pr.time, pr.duration)}</span>
        </div>
        {pr.duration > 0 && <ProgressBar ratio={pr.time / pr.duration} />}
        <div class="hcard-src">
          <Icon name={e.source.src === 'phone' ? 'phone' : 'tv'} size={22} />
          <span class="hcard-src-text">{sourceLine(e.source, p.now)}</span>
        </div>
      </div>
    </Focusable>
  );
}
