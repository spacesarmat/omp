import { Icon, ICONS } from './Icon';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { nowPlaying, linkStatus, sendCmd } from '../tv/playerLink';
import { formatDuration } from '../../../src/lib/format';
import { playerPosterStyle } from '../screens/NowPlaying';

/** «S02E03» from «Show · S02E03»; empty when the subtitle has no code part. */
export function subtitleCode(subtitle: string): string {
  const i = subtitle.lastIndexOf(' · ');
  return i >= 0 ? subtitle.slice(i + 3) : '';
}

/** Compact player above the tab bar; hidden while the TV link is gone. */
export function MiniPlayer() {
  const s = nowPlaying.value;
  if (!s || linkStatus.value === 'none') return null;
  const code = subtitleCode(s.subtitle);
  const tv = activeTv.value;
  const pct = s.duration > 0 ? Math.max(0, Math.min(100, (s.time / s.duration) * 100)) : 0;
  const time = formatDuration(s.time) + (s.duration > 0 ? ' из ' + formatDuration(s.duration) : '');
  return (
    <div class="m-mini">
      <div class="m-mini-poster" style={playerPosterStyle(s)} />
      <button type="button" class="m-mini-text" onClick={() => navigate({ name: 'nowPlaying' })}>
        <span class="m-mini-title">{(code ? code + ' · ' : '') + s.title}</span>
        <span class="m-mini-sub">{(tv ? 'На ' + tv.name + ' · ' : '') + time}</span>
      </button>
      <button type="button" class="m-mini-btn" aria-label="Назад на 10 секунд" onClick={() => sendCmd({ type: 'skip', d: -10 })}>
        <Icon d={ICONS.back10} />
      </button>
      <button
        type="button"
        class="m-mini-btn play"
        aria-label={s.paused ? 'Играть' : 'Пауза'}
        onClick={() => sendCmd({ type: s.paused ? 'play' : 'pause' })}
      >
        <Icon d={s.paused ? ICONS.play : ICONS.pause} size={20} />
      </button>
      <div class="m-mini-line">
        <div style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}
