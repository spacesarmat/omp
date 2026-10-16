import { t } from '../../../src/i18n';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { OmpJackettCard } from './OmpJackettCard';

const BACK = 'M15 5l-7 7 7 7';

/** Login, plan and Telegram link for the paid OMP account. */
export function Account() {
  return (
    <div class="m-screen" data-route="account">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('settings.account')}</h1>
      </div>
      <OmpJackettCard />
    </div>
  );
}
