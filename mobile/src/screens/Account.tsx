import { useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { billingPost } from '../../../src/billing/client';
import { withDeviceToken } from '../../../src/billing/tokens';
import { goBack } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { Icon } from '../ui/Icon';
import { OmpJackettCard } from './OmpJackettCard';

const BACK = 'M15 5l-7 7 7 7';

/** Login, plan and Telegram link for the paid OMP account. */
export function Account() {
  return (
    <div class="m-screen" data-route="account">
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P12.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('settings.account')}</h1>
      </div>
      <OmpJackettCard />
      <PromoEntry />
    </div>
  );
}

function PromoEntry() {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  return (
    <section class="m-set-group">
      <label class="m-set-row">
        <span>{t('settings.promoTitle')}</span>
        <input class="m-input" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
      </label>
      <button
        type="button"
        class="m-btn"
        onClick={() => {
          const value = code.trim();
          if (!value) return;
          void withDeviceToken(phoneSourceContext(), (headers) =>
            billingPost(phoneSourceContext(), '/v1/promo', { code: value }, { headers, timeoutMs: 12000 }),
          )
            .then((res) => setNote(res.status === 200 && res.text.indexOf('"ok":true') >= 0 ? t('settings.promoOk') : t('settings.promoBad')))
            .catch(() => setNote(t('settings.promoBad')));
        }}
      >
        {t('settings.promoApply')}
      </button>
      {note ? <p class="m-small m-muted">{note}</p> : null}
    </section>
  );
}
