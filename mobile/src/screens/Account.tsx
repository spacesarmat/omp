import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { billingGet, billingPost } from '../../../src/billing/client';
import { emitBillingChange } from '../../../src/billing/session';
import { withDeviceToken } from '../../../src/billing/tokens';
import { goBack } from '../nav';
import { phoneSourceContext } from '../searchContext';
import { Icon } from '../ui/Icon';
import { OmpJackettCard } from './OmpJackettCard';
import { FaqDone } from '../ui/faqJump';

const BACK = 'M15 5l-7 7 7 7';

/** Login, plan and Telegram link for the paid OMP account. */
export function Account() {
  return (
    <div class="m-screen" data-route="account">
      <FaqDone mark="account" />
      <div class="m-bar">
        <button type="button" class="m-icon-btn tm" data-code="P12.1" aria-label={t('common.back')} onClick={() => goBack()}>
          <Icon d={BACK} />
        </button>
        <h1 class="m-bar-title">{t('settings.account')}</h1>
      </div>
      <OmpJackettCard />
      <ThanksList />
      <PromoEntry />
    </div>
  );
}

function ThanksList() {
  const [names, setNames] = useState<{ name: string; amount?: number }[] | null>(null);
  const [showAmounts, setShowAmounts] = useState(false);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let stop = false;
    billingGet(phoneSourceContext(), '/v1/thanks', { timeoutMs: 8000 })
      .then((res) => {
        if (stop) return;
        if (res.status < 200 || res.status >= 300) {
          setDown(true);
          return;
        }
        try {
          const body = JSON.parse(res.text) as { names?: { name?: string; amount?: number }[]; showAmounts?: boolean };
          const rows = Array.isArray(body.names) ? body.names : [];
          setNames(rows.filter((row) => row && row.name).map((row) => ({ name: String(row.name), amount: typeof row.amount === 'number' ? row.amount : undefined })));
          setShowAmounts(body.showAmounts === true);
        } catch (e) {
          setDown(true);
        }
      })
      .catch(() => {
        if (!stop) setDown(true);
      });
    return () => {
      stop = true;
    };
  }, []);
  return (
    <section class="m-set-group" data-thanks="1">
      <h2 class="m-small">{t('sources.billing.thanksTitle')}</h2>
      {down ? <p class="m-small m-muted">{t('sources.billing.thanksDown')}</p> : null}
      {names && names.length === 0 && !down ? <p class="m-small m-muted">{t('sources.billing.thanksEmpty')}</p> : null}
      {names && names.length
        ? names.map((row) => (
            <div class="m-src-row" key={row.name}>
              {row.name}
              {showAmounts && row.amount != null ? ' - ' + row.amount + ' ₽' : ''}
            </div>
          ))
        : null}
    </section>
  );
}

function PromoEntry() {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  return (
    <section class="m-set-group" data-section="promo">
      <div class="m-set-label">{t('settings.promoTitle')}</div>
      <div class="m-acct-card m-promo-row">
        <input class="m-input" placeholder={t('settings.promoTitle')} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        <button
          type="button"
          class="m-btn m-btn-primary m-promo-apply"
          disabled={!code.trim()}
          onClick={() => {
          const value = code.trim();
          if (!value) return;
          void withDeviceToken(phoneSourceContext(), (headers) =>
            billingPost(phoneSourceContext(), '/v1/promo', { code: value }, { headers, timeoutMs: 12000 }),
          )
            .then((res) => {
              const ok = res.status === 200 && res.text.indexOf('"ok":true') >= 0;
              if (ok) emitBillingChange();
              setNote(ok ? t('settings.promoOk') : t('settings.promoBad'));
            })
            .catch(() => setNote(t('settings.promoBad')));
        }}
      >
        {t('settings.promoApply')}
      </button>
      </div>
      {note ? <p class="m-small m-muted">{note}</p> : null}
    </section>
  );
}
