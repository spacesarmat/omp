import type { CacheState, FfprobeResult } from '../api/types';
import { cueAt, Cue } from '../lib/subtitles';
import { formatSpeed } from '../lib/format';
import { settings } from '../store/settings';
import { statsLines } from './stats';
import { Spinner, ErrorView } from '../ui/components';

export function StatsOverlay(p: { cache: CacheState | null; probe: FfprobeResult | null }) {
  const lines = statsLines(p.cache, p.probe);
  return (
    <div class="player-stats">
      {lines.length ? lines.map((l) => <div key={l}>{l}</div>) : <div>Нет данных</div>}
    </div>
  );
}

export function BufferingOverlay(p: { cache: CacheState | null }) {
  const t = p.cache && p.cache.Torrent;
  const text = 'Буферизация…' + (t ? ' ' + formatSpeed(t.download_speed || 0) + ' · пиры ' + (t.active_peers || 0) : '');
  return (
    <div class="player-buffer">
      <Spinner text={text} />
    </div>
  );
}

export function SubtitleOverlay(p: { cues: Cue[] | null; time: number; raised: boolean; offset: number }) {
  const s = settings.value;
  if (!p.cues) return null;
  const text = cueAt(p.cues, p.time - p.offset);
  if (!text) return null;
  const cls = 'subtitles sub-' + s.subSize + ' sub-' + s.subColor + (s.subBackground ? ' sub-bg' : ' sub-nobg') + (p.raised ? ' raised' : '');
  return (
    <div class={cls}>
      <span>{text}</span>
    </div>
  );
}

export function NextBanner(p: { seconds: number; title: string; onNext: () => void }) {
  return (
    <div class="next-banner" onClick={p.onNext}>
      <div>Следующая серия через {p.seconds} с</div>
      <div class="meta">{p.title}</div>
      <div class="meta">OK — сейчас · Назад — остаться</div>
    </div>
  );
}

export function PlayerError(p: { message: string; probe: FfprobeResult | null; onRetry: () => void; onBack: () => void }) {
  const details = statsLines(null, p.probe).join('\n');
  return (
    <div class="player-error">
      <ErrorView
        message={p.message + (details ? '\n\n' + details : '')}
        actions={[
          { label: 'Повторить', onPress: p.onRetry },
          { label: 'Назад', onPress: p.onBack },
        ]}
      />
    </div>
  );
}
