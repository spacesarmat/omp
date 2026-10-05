import { Icon } from './Icon';
import { useBackHandler } from './backStack';

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
      <button type="button" class="m-sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div class="m-dialog" role="dialog" aria-labelledby="oldtv-title">
        <div class="m-dialog-icon">
          <Icon d={DOWNLOAD} size={24} />
        </div>
        <div class="m-sheet-title" id="oldtv-title">
          Обновите OMP на телевизоре
        </div>
        <div class="m-dialog-text">
          На {tvName} стоит OMP {version}. Запуск серии с позиции и управление плеером с телефона работают с версии 0.8.
        </div>
        <div class="m-muted m-small">На ТВ: Настройки → Обновление → «Проверить обновление».</div>
        <button type="button" class="m-btn m-btn-primary" onClick={onContinue}>
          Всё равно запустить
        </button>
        <button type="button" class="m-btn m-btn-secondary" onClick={onGuide}>
          Как обновить
        </button>
      </div>
    </div>
  );
}
