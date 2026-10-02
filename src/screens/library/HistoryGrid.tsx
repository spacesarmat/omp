import type { Torrent } from '../../api/types';
import type { Progress } from '../../store/progress';
import { categoryOf } from '../../lib/category';
import { episodeLine, positionLabel, remainingLabel } from '../../lib/libraryView';
import { FocusGroup, Focusable, ProgressBar } from '../../ui/components';
import { Poster } from './Poster';

export interface HistoryEntry {
  torrent: Torrent;
  fileIndex: number;
  progress: Progress;
}

export function HistoryGrid(p: {
  entries: HistoryEntry[];
  filePath: (e: HistoryEntry) => string;
  onOpen: (e: HistoryEntry) => void;
  onFocused: (e: HistoryEntry) => void;
}) {
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
              <div class="hcard-title">{t.title || t.name || t.hash}</div>
              <div class="hcard-ep">{episodeLine(p.filePath(e), categoryOf(t.category) === 'movie')}</div>
              <div class="hcard-time">
                <span>{positionLabel(pr.time, pr.duration)}</span>
                <span class="hcard-left">{remainingLabel(pr.time, pr.duration)}</span>
              </div>
              {pr.duration > 0 && <ProgressBar ratio={pr.time / pr.duration} />}
            </div>
          </Focusable>
        );
      })}
    </FocusGroup>
  );
}
