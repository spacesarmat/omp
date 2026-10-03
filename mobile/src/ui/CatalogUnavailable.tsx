import { Icon } from './Icon';
import { CATALOG_HINT } from '../../../src/lib/catalogState';

const OFF = 'M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18';

export function CatalogUnavailable(p: {
  reason: string;
  onRetry: () => void;
  onChangeServer: () => void;
  onStart?: () => void;
  starting?: boolean;
  onFaq: () => void;
}) {
  return (
    <div class="m-offline" role="alert">
      <span class="m-offline-icon">
        <Icon d={OFF} size={40} />
      </span>
      <h2 class="m-offline-title">Каталог недоступен</h2>
      <p class="m-muted m-offline-reason">{p.reason}</p>
      <div class="m-offline-actions">
        <button type="button" class="m-btn m-btn-primary" onClick={p.onRetry}>Повторить</button>
        {p.onStart && (
          <button type="button" class="m-btn m-btn-secondary" disabled={p.starting} onClick={p.onStart}>Запустить сервер</button>
        )}
        <button type="button" class="m-btn m-btn-secondary" onClick={p.onChangeServer}>Сменить сервер</button>
      </div>
      <p class="m-muted m-note m-offline-hint">
        {CATALOG_HINT}. <button type="button" class="m-link" onClick={p.onFaq}>Вопросы и ответы</button>
      </p>
    </div>
  );
}
