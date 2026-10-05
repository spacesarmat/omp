import { Icon, ICONS } from './Icon';
import { navigate } from '../nav';
import { activeTv } from '../tv/tvStore';
import { nowPlaying, linkStatus, sendCmd } from '../tv/playerLink';
import { formatDuration } from '../../../src/lib/format';
import { displayTitle } from './displayTitle';
import { playerPosterStyle } from './playerPoster';
import { t } from '../../../src/i18n';

/** «S02E03» from «Show · S02E03»; empty when the subtitle has no code part. */
export function subtitleCode(subtitle: string): string {
  const i = subtitle.lastIndexOf(' · ');
  return i >= 0 ? subtitle.slice(i + 3) : '';
}

/** Compact player above the tab bar; hidden while the TV link is gone. */
export function MiniPlayer() {
  const s = nowPlaying.value;
  const status = linkStatus.value;
  if (!s || status === 'none') return null;
  const live = status === 'live';
  const code = subtitleCode(s.subtitle);
  const tv = activeTv.value;
  const pct = s.duration > 0 ? Math.max(0, Math.min(100, (s.time / s.duration) * 100)) : 0;
  const time = s.duration > 0 ? t('remote.mini.of', { time: formatDuration(s.time), total: formatDuration(s.duration) }) : formatDuration(s.time);
  return (
    <div class="m-mini">
      <div class="m-mini-poster" style={playerPosterStyle(s)} />
      <button type="button" class="m-mini-text" onClick={() => navigate({ name: 'nowPlaying' })}>
        <span class="m-mini-title">{(code ? code + ' · ' : '') + displayTitle(s.title)}</span>
        {live ? (
          <span class="m-mini-sub">{tv ? t('remote.mini.onTv', { name: tv.name, time }) : time}</span>
        ) : (
          <span class="m-mini-sub warn">{t('remote.mini.noAnswer')}</span>
        )}
      </button>
      <button type="button" class="m-mini-btn" aria-label={t('remote.mini.back10')} disabled={!live} onClick={() => sendCmd({ type: 'skip', d: -10 })}>
        <Icon d={ICONS.back10} />
      </button>
      <button
        type="button"
        class="m-mini-btn play"
        disabled={!live}
        aria-label={s.paused ? t('remote.mini.play') : t('remote.mini.pause')}
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
