// Without the OMP subscription a new monitoring subscription past FREE_SUBS_MAX is refused here: the reason and the way
// to the OMP subscription («Аккаунт»).
import { Sheet } from './Sheet';
import { navigate } from '../nav';
import { t } from '../../../src/i18n';
import { FREE_SUBS_MAX } from '../../../src/monitor/limit';

export function SubsLimitSheet({ onClose }: { onClose: () => void }) {
  const go = () => {
    onClose();
    navigate({ name: 'account' });
  };
  return (
    <Sheet label={t('monitor.limit.title', { n: FREE_SUBS_MAX })} testId="PD05" onClose={onClose}>
      <div class="m-sheet-title">{t('monitor.limit.title', { n: FREE_SUBS_MAX })}</div>
      <p class="m-want-text" data-subs-limit>
        {t('monitor.limit.text', { n: FREE_SUBS_MAX })}
      </p>
      <button type="button" class="m-btn m-btn-primary" onClick={go}>
        {t('monitor.limit.go')}
      </button>
      <button type="button" class="m-btn m-btn-secondary" onClick={onClose}>
        {t('common.close')}
      </button>
    </Sheet>
  );
}
