import { useEffect, useState } from 'preact/hooks';
import { BILLING_BOT, BILLING_BOT_URL } from '../../../src/billing/config';
import { billingSession, onBillingChange } from '../../../src/billing/session';
import { t } from '../../../src/i18n';
import { activateCode, clearBilling } from '../../../src/sources/ompJackett';
import { phoneSourceContext } from '../searchContext';

function day(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

/** Code entry for the paid Jackett. No address and no API key. */
export function OmpJackettCard() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(billingSession());
  useEffect(() => onBillingChange(() => setSession(billingSession())), []);
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const row = await activateCode(phoneSourceContext(), code);
      setSession(row);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sources.billing.down'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="m-set-group" data-billing="jackett">
      <div class="m-set-label">{t('sources.billing.title')}</div>
      <div class="m-set-card m-src-card">
        <div class="m-src-row m-note m-muted">{t('sources.billing.text')}</div>
        <div class="m-src-row m-note m-muted">{t('sources.billing.bot', { name: BILLING_BOT })}</div>
        <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(BILLING_BOT_URL, '_system')}>
          {t('sources.billing.openBot')}
        </button>
        {session && session.token ? (
          <>
            <div class="m-src-row">{t('sources.billing.connected', { date: day(session.paidUntil) })}</div>
            <button type="button" class="m-btn m-btn-secondary" onClick={() => { clearBilling(); setSession(null); }}>
              {t('sources.billing.disconnect')}
            </button>
          </>
        ) : (
          <div class="m-field">
            <label for="omp-code">{t('sources.billing.code')}</label>
            <input id="omp-code" class="m-input" value={code} autoCapitalize="characters" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            {error && <div class="m-error" role="alert">{error}</div>}
            <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void connect()}>
              {busy ? t('sources.billing.connecting') : t('sources.billing.connect')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
