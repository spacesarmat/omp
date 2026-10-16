// «Обзор»: the catalog error block (feed, search, title card) — the text by the code, «Повторить», and
// «Как получить ключ» when there is no TMDB key.
import { t } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { catalogErrorKey, type CatalogErrorCode } from '../../../../src/catalog/client';
import { OFFLINE_TITLE } from '../../catalog/phoneCatalog';

export function CatalogError({ code, onRetry }: { code: CatalogErrorCode; onRetry: () => void }) {
  const keyHelp = code === 'nokey' || code === 'badkey';
  return (
    <div class="m-disc-error" role="alert">
      <p class="m-disc-error-title">{t(OFFLINE_TITLE)}</p>
      <p class="m-muted">{t(catalogErrorKey(code, 'phone'))}</p>
      <div class="m-disc-error-actions">
        <button type="button" class="m-btn m-btn-primary" onClick={onRetry}>
          {t('common.retry')}
        </button>
        {keyHelp && (
          <button type="button" class="m-btn m-btn-secondary" onClick={() => navigate({ name: 'faq', q: 'tmdb-key' })}>
            {t('discover.howToKey')}
          </button>
        )}
      </div>
    </div>
  );
}
