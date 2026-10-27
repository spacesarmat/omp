// «Обзор»: the catalog error block (feed, search, title card) - the text by the code, «Повторить», and
// «Как получить ключ» when there is no TMDB key.
import { t } from '../../../../src/i18n';
import { navigate } from '../../nav';
import { catalogErrorKey, type CatalogErrorCode } from '../../../../src/catalog/client';
import { OFFLINE_TITLE } from '../../catalog/phoneCatalog';
import { online } from '../../lib/online';

export function CatalogError({ code, onRetry }: { code: CatalogErrorCode; onRetry: () => void }) {
  // no network at all: say so, not «TMDB не отвечает из этой сети» with a mirror hint
  const noNet = !online.value;
  const keyHelp = !noNet && (code === 'nokey' || code === 'badkey');
  return (
    <div class="m-disc-error" role="alert">
      <p class="m-disc-error-title">{noNet ? t('common.offlineTitle') : t(OFFLINE_TITLE)}</p>
      <p class="m-muted">{noNet ? t('common.offlineText') : t(catalogErrorKey(code, 'phone'))}</p>
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
