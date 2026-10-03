import { formatDuration } from '../lib/format';
import { Icon, KeyDot } from '../ui/icons';
import type { Chapter } from './chapters';

interface ControlsProps {
  title: string;
  time: number;
  duration: number;
  paused: boolean;
  seekTarget: number | null;
  hasPrev: boolean;
  hasNext: boolean;
  onToggle: () => void;
  onSeekTo: (t: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTracks: () => void;
  /** Chapters of the file (empty: no ticks, no «Главы»). */
  chapters: Chapter[];
  /** Chapter playing now, -1 when none. */
  chapterIdx: number;
  onChapters: () => void;
}

/** Bottom bar. Keys are handled by the player; mouse handlers serve Magic Remote / ThinQ pointer. */
export function Controls(p: ControlsProps) {
  const shown = p.seekTarget !== null ? p.seekTarget : p.time;
  const pct = p.duration > 0 ? (shown / p.duration) * 100 : 0;
  const cur = p.chapters[p.chapterIdx];
  const barClick = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (p.duration > 0 && rect.width > 0) p.onSeekTo(((e.clientX - rect.left) / rect.width) * p.duration);
  };
  return (
    <div class="player-controls" onClick={(e) => e.stopPropagation()}>
      <div class="player-title">{p.title}{cur && <span class="player-chapter"> · Глава {p.chapterIdx + 1}{cur.title ? ' «' + cur.title + '»' : ''}</span>}</div>
      <div class="player-bar" onClick={barClick}>
        <div class="player-bar-fill" style={{ width: pct + '%' }} />
        {p.duration > 0 && p.chapters.map((ch, i) => (ch.start > 0 && ch.start < p.duration ? <div key={i} class="player-bar-tick" style={{ left: (ch.start / p.duration) * 100 + '%' }} /> : null))}
        {p.seekTarget !== null && <div class="player-bar-target" style={{ left: pct + '%' }} />}
      </div>
      <div class="player-row">
        {p.hasPrev && <span class="player-btn" onClick={p.onPrev}><Icon name="prev" size={32} /></span>}
        <span class="player-btn" onClick={p.onToggle}><Icon name={p.paused ? 'play' : 'pause'} size={32} /></span>
        {p.hasNext && <span class="player-btn" onClick={p.onNext}><Icon name="next" size={32} /></span>}
        <span>{formatDuration(shown)} / {formatDuration(p.duration)}</span>
        <span class="player-btn" onClick={p.onTracks}><Icon name="tracks" size={28} /> Меню</span>
        {p.chapters.length > 0 && <span class="player-btn" onClick={p.onChapters}>Главы</span>}
        <div class="spacer" />
        <span class="player-hints">Влево/вправо — перемотка · Вверх — меню · <KeyDot color="green" /> статистика · {p.chapters.length > 0 ? 'CH− · CH+ — соседняя глава' : 'CH± — серии'}</span>
      </div>
    </div>
  );
}
