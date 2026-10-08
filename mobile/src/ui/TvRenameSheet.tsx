import { t } from '../../../src/i18n';
import { RenameSheet } from './RenameSheet';
import { isTvRenamed, renameTv, resetTvName, type SavedTv } from '../tv/tvStore';

/**
 * Renames a saved TV on the phone only (the name is kept with the saved TV, keyed by its IP); an empty name or
 * «Вернуть имя телевизора» shows the TV's own name again.
 */
export function TvRenameSheet({ tv, onClose }: { tv: SavedTv; onClose: () => void }) {
  return (
    <RenameSheet
      title={t('tvScreen.renameTitle')}
      value={tv.name}
      onSave={(n) => {
        renameTv(tv.ip, n);
        onClose();
      }}
      onCancel={onClose}
      reset={
        isTvRenamed(tv)
          ? {
              label: t('tvScreen.resetName'),
              onReset: () => {
                resetTvName(tv.ip);
                onClose();
              },
            }
          : undefined
      }
    />
  );
}
