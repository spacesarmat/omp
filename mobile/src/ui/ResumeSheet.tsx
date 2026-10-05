import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { formatDuration } from '../../../src/lib/format';
import { t } from '../../../src/i18n';

const PLAY = 'M7 5l11 7-11 7z';
const RESTART = 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4';

/** «Откуда смотреть?»: continue from the saved position or start over. */
export function ResumeSheet({
  info,
  at,
  duration,
  onResume,
  onRestart,
  onCancel,
}: {
  info: string;
  at: number;
  duration?: number;
  onResume: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  const known = duration !== undefined && duration > at;
  const left = known ? Math.max(1, Math.round((duration! - at) / 60)) : 0;
  return (
    <Sheet onClose={onCancel} label={t('torrent.resume.label')}>
      <div class="m-muted m-small">{info}</div>
      <div class="m-sheet-title">{t('torrent.resume.title')}</div>
      {known && (
        <div class="m-bar-track">
          <span class="m-bar-fill" style={{ width: Math.min(100, (at / duration!) * 100) + '%' }} />
        </div>
      )}
      <button type="button" class="m-opt primary" onClick={onResume}>
        <Icon d={PLAY} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{t('torrent.resume.from', { time: formatDuration(at) })}</span>
          {known && <span class="m-opt-sub">{t('torrent.resume.left', { n: left })}</span>}
        </span>
      </button>
      <button type="button" class="m-opt" onClick={onRestart}>
        <Icon d={RESTART} size={26} />
        <span class="m-opt-text">
          <span class="m-opt-name">{t('torrent.resume.restart')}</span>
          <span class="m-opt-sub">{t('torrent.resume.zero')}</span>
        </span>
      </button>
      <button type="button" class="m-btn m-btn-secondary" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </Sheet>
  );
}
