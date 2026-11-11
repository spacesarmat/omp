import { useEffect, useState } from 'preact/hooks';
import { BILLING_BOT, BILLING_BOT_URL } from '../../../src/billing/config';
import {
  billingNotice,
  billingSession,
  onBillingChange,
  pendingBillingCode,
  setPendingBillingCode,
  type BillingAccount,
} from '../../../src/billing/session';
import { t } from '../../../src/i18n';
import {
  activateCode,
  allowBillingSignIn,
  claimLinkedSession,
  clearTelegramLink,
  invalidateBillingClaims,
  fetchBillingAccount,
  fetchCryptoLinks,
  refreshOmpJackettSources,
  signOutBilling,
  startTelegramLink,
} from '../../../src/sources/ompJackett';
import { phoneSourceContext } from '../searchContext';
import { TextField } from '../ui/TextField';

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
  const [cryptoBusy, setCryptoBusy] = useState(false);
  const [cryptoError, setCryptoError] = useState('');
  const [cryptoLinks, setCryptoLinks] = useState<{ asset: string; amount: string; webUrl: string; url: string }[]>([]);

  async function refreshAccount() {
    const ctx = phoneSourceContext();
    try {
      const acc = await fetchBillingAccount(ctx);
      setAccount(acc);
      // Linked Telegram, no session yet: the server issues one when the subscription is active (grace included).
      if (!billingSession() && acc && acc.telegramId && (acc.active || acc.overLimit)) {
        try {
          const row = await claimLinkedSession(ctx);
          if (row) setSession(row);
          setError('');
        } catch (e) {
          setError(e instanceof Error ? e.message : t('sources.billing.down'));
        }
      }
      await refreshOmpJackettSources(ctx);
    } catch {
      // A blip must not clear the account already on screen. Source flags stay as they were.
    }
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
    allowBillingSignIn();
    setLinkBusy(true);
    setError('');
    try {
      const deepLink = await startTelegramLink(phoneSourceContext());
      window.open(deepLink, '_system');
      window.setTimeout(() => void refreshAccount(), 2500);
      window.setTimeout(() => void refreshAccount(), 8000);
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
    // Before the round trip: a claim that is already in flight must not sign this phone back in.
    invalidateBillingClaims();
    try {
      await clearTelegramLink(phoneSourceContext());
      signOutBilling(phoneSourceContext());
      setSession(null);
      setAccount(null);
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

        {session ? (
          <>
            <div class="m-src-row" data-paid-until={day((account && account.paidUntil) || session.paidUntil)}>
              {account && account.inGrace
                ? t('sources.billing.grace', { date: day(account.paidUntil), until: day(account.accessUntil || 0) || '-' })
                : t('sources.billing.paidUntil', {
                    date: day((account && account.paidUntil) || session.paidUntil) || '-',
                  })}
            </div>
            {account && account.overLimit ? <div class="m-src-row m-note">{t('sources.billing.overLimit')}</div> : null}
            {cryptoError ? (
              <div class="m-src-row m-note" role="alert">
                {cryptoError}
              </div>
            ) : null}
            {cryptoLinks.length ? (
              <div class="m-src-row" style="gap: 8px; flex-wrap: wrap">
                {cryptoLinks.map((link) => (
                  <button
                    type="button"
                    class="m-btn m-btn-secondary"
                    key={link.asset}
                    onClick={() => window.open(link.webUrl || link.url, '_system')}
                  >
                    {t('sources.billing.cryptoPay', { asset: link.asset + ' ' + link.amount })}
                  </button>
                ))}
              </div>
            ) : null}
            <div class="m-src-row" style="gap: 8px; flex-wrap: wrap">
              <button
                type="button"
                class="m-btn m-btn-primary"
                data-action="renew"
                onClick={() => window.open(BILLING_BOT_URL + '?start=renew', '_system')}
              >
                {t('sources.billing.renew')}
              </button>
              <button
                type="button"
                class="m-btn m-btn-secondary"
                data-action="crypto"
                disabled={cryptoBusy}
                onClick={() => {
                  setCryptoBusy(true);
                  setCryptoError('');
                  void fetchCryptoLinks(phoneSourceContext()).then(
                    (links) => {
                      setCryptoLinks(links);
                      setCryptoBusy(false);
                    },
                    (e: unknown) => {
                      setCryptoLinks([]);
                      setCryptoError(e instanceof Error ? e.message : t('sources.billing.cryptoDown'));
                      setCryptoBusy(false);
                    },
                  );
                }}
              >
                {cryptoBusy ? t('sources.billing.cryptoBusy') : t('sources.billing.crypto')}
              </button>
              <button
                type="button"
                class="m-btn m-btn-secondary"
                onClick={() => {
                  signOutBilling(phoneSourceContext());
                  setSession(null);
                  setAccount(null);
                }}
              >
                {t('sources.billing.disconnect')}
              </button>
            </div>
          </>
        ) : (
          <div class="m-field">
            <label for="omp-code">{t('sources.billing.code')}</label>
            <TextField
              id="omp-code"
              class="m-input"
              value={code}
              autoCapitalize="characters"
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            {error ? (
              <div class="m-error" role="alert">
                {error}
              </div>
            ) : billingNotice() ? (
              <div class="m-error" role="alert" data-notice={billingNotice()}>
                {billingNotice() === 'keystore' ? t('sources.billing.keystoreLost') : t('sources.billing.revoked')}
              </div>
            ) : null}
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
