import { Icon } from './Icon';
import { useBackHandler } from './backStack';
import { t } from '../../../src/i18n';

const DOWNLOAD = 'M12 4v10M8 10l4 4 4-4M5 20h14';

/** The TV runs an OMP older than the player-control version. */
export function OldTvDialog({
  tvName,
  version,
  onContinue,
  onGuide,
  onClose,
}: {
  tvName: string;
  version: string;
  onContinue: () => void;
  onGuide: () => void;
  onClose: () => void;
}) {
  useBackHandler(onClose);
  return (
    <div class="m-sheet-host m-dialog-host">
      <button type="button" class="m-sheet-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div class="m-dialog" role="dialog" aria-labelledby="oldtv-title">
        <div class="m-dialog-icon">
          <Icon d={DOWNLOAD} size={24} />
        </div>
        <div class="m-sheet-title" id="oldtv-title">
          {t('remote.oldTv.title')}
        </div>
        <div class="m-dialog-text">
          {t('remote.oldTv.text', { name: tvName, version })}
        </div>
        <div class="m-muted m-small">{t('remote.oldTv.how')}</div>
        <button type="button" class="m-btn m-btn-primary" onClick={onContinue}>
          {t('remote.oldTv.anyway')}
        </button>
        <button type="button" class="m-btn m-btn-secondary" onClick={onGuide}>
          {t('remote.oldTv.guide')}
        </button>
      </div>
    </div>
  );
}
