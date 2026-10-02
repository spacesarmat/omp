import { formatDuration } from '../lib/format';
import { Icon, KeyDot } from '../ui/icons';

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
}

/** Bottom bar. Keys are handled by the player; mouse handlers serve Magic Remote / ThinQ pointer. */
export function Controls(p: ControlsProps) {
  const shown = p.seekTarget !== null ? p.seekTarget : p.time;
  const pct = p.duration > 0 ? (shown / p.duration) * 100 : 0;
  const barClick = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (p.duration > 0 && rect.width > 0) p.onSeekTo(((e.clientX - rect.left) / rect.width) * p.duration);
  };
  return (
    <div class="player-controls" onClick={(e) => e.stopPropagation()}>
      <div class="player-title">{p.title}</div>
      <div class="player-bar" onClick={barClick}>
        <div class="player-bar-fill" style={{ width: pct + '%' }} />
        {p.seekTarget !== null && <div class="player-bar-target" style={{ left: pct + '%' }} />}
      </div>
      <div class="player-row">
        {p.hasPrev && <span class="player-btn" onClick={p.onPrev}><Icon name="prev" size={32} /></span>}
        <span class="player-btn" onClick={p.onToggle}><Icon name={p.paused ? 'play' : 'pause'} size={32} /></span>
        {p.hasNext && <span class="player-btn" onClick={p.onNext}><Icon name="next" size={32} /></span>}
        <span>{formatDuration(shown)} / {formatDuration(p.duration)}</span>
        <span class="player-btn" onClick={p.onTracks}><Icon name="tracks" size={28} /> Дорожки</span>
        <div class="spacer" />
        <span class="player-hints">Влево/вправо — перемотка · Вверх — дорожки · <KeyDot color="green" /> статистика · CH± — серии</span>
      </div>
    </div>
  );
}
