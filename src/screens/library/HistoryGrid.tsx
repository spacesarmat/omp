import { categoryOf } from '../../lib/category';
import { episodeLine, positionLabel, remainingLabel } from '../../lib/libraryView';
import { historyFilters, sourceLine, type HistoryFilter, type HistoryItem } from '../../lib/history';
import { FocusGroup, Focusable, ProgressBar } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { Poster } from './Poster';
import { displayTitle } from '../../lib/torrentName';

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
      {p.entries.map((e) => {
        const t = e.torrent;
        const pr = e.progress;
        return (
          <Focusable
            key={t.hash + ':' + e.fileIndex}
            focusKey={'hist-' + t.hash + '-' + e.fileIndex}
            className="hcard"
            onPress={() => p.onOpen(e)}
            onFocused={() => p.onFocused(e)}
          >
            <Poster t={t} />
            <div class="hcard-main">
              <div class="hcard-title">{displayTitle(t)}</div>
              <div class="hcard-ep">{episodeLine(p.filePath(e), categoryOf(t.category) === 'movie')}</div>
              <div class="hcard-time">
                <span>{positionLabel(pr.time, pr.duration)}</span>
                <span class="hcard-left">{remainingLabel(pr.time, pr.duration)}</span>
              </div>
              {pr.duration > 0 && <ProgressBar ratio={pr.time / pr.duration} />}
              <div class="hcard-src">
                <Icon name={e.source.src === 'phone' ? 'phone' : 'tv'} size={22} />
                <span class="hcard-src-text">{sourceLine(e.source, now)}</span>
              </div>
            </div>
          </Focusable>
        );
      })}
    </FocusGroup>
  );
}
