import { useEffect, useState } from 'preact/hooks';
import { BILLING_BOT, BILLING_BOT_URL } from '../../../src/billing/config';
import {
  billingSession,
  onBillingChange,
  pendingBillingCode,
  setPendingBillingCode,
  type BillingAccount,
} from '../../../src/billing/session';
import { t } from '../../../src/i18n';
import {
  activateCode,
  clearBilling,
  clearTelegramLink,
  fetchBillingAccount,
  startTelegramLink,
} from '../../../src/sources/ompJackett';
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
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  async function refreshAccount() {
    setAccount(await fetchBillingAccount(phoneSourceContext()));
  }

  useEffect(() => {
    async function applyPending(raw: string) {
      setCode(raw);
      if (billingSession()) return;
      setBusy(true);
      setError('');
      try {
        const row = await activateCode(phoneSourceContext(), raw);
        setSession(row);
        setCode('');
        setPendingBillingCode(null);
        await refreshAccount();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('sources.billing.down'));
      } finally {
        setBusy(false);
      }
    }
    const pending = pendingBillingCode();
    if (pending) void applyPending(pending);
    return onBillingChange(() => {
      setSession(billingSession());
      const next = pendingBillingCode();
      if (next && !billingSession()) void applyPending(next);
      else if (next) setCode(next);
      else void refreshAccount();
    });
  }, []);

  useEffect(() => {
    void refreshAccount();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshAccount();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [session]);

  async function connect(fromCode?: string) {
    if (busy) return;
    const value = (fromCode || code).trim();
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      const row = await activateCode(phoneSourceContext(), value);
      setSession(row);
      setCode('');
      setPendingBillingCode(null);
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sources.billing.down'));
    } finally {
      setBusy(false);
    }
  }

  async function linkTelegram() {
    if (linkBusy) return;
    setLinkBusy(true);
    setError('');
    try {
      const deepLink = await startTelegramLink(phoneSourceContext());
      window.open(deepLink, '_system');
      window.setTimeout(() => void refreshAccount(), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sources.billing.down'));
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkTelegram() {
    if (linkBusy) return;
    setLinkBusy(true);
    setError('');
    try {
      await clearTelegramLink(phoneSourceContext());
      setAccount((prev) => (prev ? { ...prev, telegramId: '' } : prev));
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sources.billing.down'));
    } finally {
      setLinkBusy(false);
    }
  }

  const linked = !!(account && account.telegramId);

  return (
    <section class="m-set-group" data-billing="jackett">
      <div class="m-set-label">{t('sources.billing.title')}</div>
      <div class="m-set-card m-src-card">
        <div class="m-src-row m-note m-muted">{t('sources.billing.text')}</div>

        <div class="m-src-row" data-row="billing-telegram">
          <div class="m-set-text" style="flex-grow: 1">
            <span>{t('sources.billing.telegramTitle')}</span>
            {linked ? (
              <span class="m-small m-accent" data-telegram="linked">
                {t('sources.billing.linked', { id: account!.telegramId })}
              </span>
            ) : (
              <span class="m-small m-muted">{t('sources.billing.telegramHint')}</span>
            )}
          </div>
        </div>
        {linked ? (
          <div class="m-src-row" style="gap: 8px; flex-wrap: wrap">
            <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(BILLING_BOT_URL, '_system')}>
              {t('sources.billing.openBot')}
            </button>
            <button type="button" class="m-btn m-btn-secondary" disabled={linkBusy} onClick={() => void unlinkTelegram()}>
              {linkBusy ? t('sources.billing.unlinking') : t('sources.billing.unlinkTelegram')}
            </button>
          </div>
        ) : (
          <div class="m-src-row" style="gap: 8px; flex-wrap: wrap">
            <button type="button" class="m-btn m-btn-primary" disabled={linkBusy} onClick={() => void linkTelegram()}>
              {linkBusy ? t('sources.billing.linking') : t('sources.billing.linkTelegram')}
            </button>
            <button type="button" class="m-btn m-btn-secondary" onClick={() => window.open(BILLING_BOT_URL, '_system')}>
              {t('sources.billing.openBot')}
            </button>
          </div>
        )}
        <div class="m-src-row m-note m-muted">{t('sources.billing.bot', { name: BILLING_BOT })}</div>

        {session && session.token ? (
          <>
            <div class="m-src-row">
              {t('sources.billing.connected', {
                date: day((account && account.paidUntil) || session.paidUntil),
              })}
            </div>
            <button
              type="button"
              class="m-btn m-btn-secondary"
              onClick={() => {
                clearBilling();
                setSession(null);
                setAccount(null);
              }}
            >
              {t('sources.billing.disconnect')}
            </button>
          </>
        ) : (
          <div class="m-field">
            <label for="omp-code">{t('sources.billing.code')}</label>
            <input
              id="omp-code"
              class="m-input"
              value={code}
              autoCapitalize="characters"
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            {error && (
              <div class="m-error" role="alert">
                {error}
              </div>
            )}
            <button type="button" class="m-btn m-btn-primary" disabled={busy} onClick={() => void connect()}>
              {busy ? t('sources.billing.connecting') : t('sources.billing.connect')}
            </button>
          </div>
        )}
        {error && session ? (
          <div class="m-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
