import { useEffect, useState } from 'preact/hooks';
import { BILLING_BOT_URL } from '../../../src/billing/config';
import { billingPost } from '../../../src/billing/client';
import { withDeviceToken } from '../../../src/billing/tokens';
import {
  billingNotice,
  billingSession,
  onBillingChange,
  pendingBillingCode,
  setPendingBillingCode,
  type BillingAccount,
} from '../../../src/billing/session';
import { t, tp } from '../../../src/i18n';
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
import { askConfirm } from '../ui/confirm';
import { billShown, formatPayAmount, paymentDate, paymentKind } from '../../../src/lib/accountBill';

function daysLeft(until: number, now: number): number {
  if (!until || until <= now) return 0;
  return Math.ceil((until - now) / 86400000);
}

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
  const [payOpen, setPayOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const [tgMenu, setTgMenu] = useState(false);
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

  async function disconnect() {
    if (!(await askConfirm(t('sources.billing.disconnectAsk'), t('sources.billing.disconnect')))) return;
    signOutBilling(phoneSourceContext());
    setSession(null);
    setAccount(null);
  }

  async function cancelRenew() {
    if (!(await askConfirm(t('sources.billing.cancelRenewAsk'), t('sources.billing.cancelRenew')))) return;
    try {
      const res = await withDeviceToken(phoneSourceContext(), (headers) =>
        billingPost(phoneSourceContext(), '/v1/auto-renew', { on: 'false' }, { headers, timeoutMs: 12000 }),
      );
      if (!res || res.status < 200 || res.status >= 300) {
        setError(t('sources.billing.down'));
        return;
      }
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sources.billing.down'));
    }
  }

  const linked = !!(account && account.telegramId);

  const until = (account && account.paidUntil) || (session && session.paidUntil) || 0;
  const end = account && account.inGrace && account.accessUntil ? account.accessUntil : until;
  const left = daysLeft(end, Date.now());
  const limited = !!(account && (account.overLimit || account.inGrace));
  const on = !!session && left > 0 && !limited;
  return (
    <section class="m-set-group" data-billing="jackett">
      <div class="m-set-card m-src-card">
        <div class="m-src-row m-note m-muted">{t('sources.billing.text')}</div>

        <div class="m-set-label">{t('sources.billing.telegramTitle')}</div>
        <div class="m-acct-card" data-row="billing-telegram">
          {linked ? (
            <button type="button" class="m-set-row m-set-pick" data-tg-menu aria-expanded={tgMenu} onClick={() => setTgMenu(!tgMenu)}>
              <span>{t('sources.billing.telegramTitle')}</span>
              <span class="m-muted">{tgMenu ? t('sources.billing.unlinkTelegram') : t('sources.billing.openBot')}</span>
            </button>
          ) : (
            <button type="button" class="m-btn m-btn-primary m-acct-wide" disabled={linkBusy} onClick={() => void linkTelegram()}>
              {linkBusy ? t('sources.billing.linking') : t('sources.billing.linkTelegram')}
            </button>
          )}
          {linked && tgMenu && (
            <div class="m-acct-links" data-tg-actions>
              <button type="button" class="m-btn-text" onClick={() => window.open(BILLING_BOT_URL, '_system')}>
                {t('sources.billing.openBot')}
              </button>
              <button type="button" class="m-btn-text" disabled={linkBusy} onClick={() => void unlinkTelegram()}>
                {linkBusy ? t('sources.billing.unlinking') : t('sources.billing.unlinkTelegram')}
              </button>
            </div>
          )}
        </div>

        {session ? (
          <>
            <div class="m-set-label">{t('sources.billing.subHead')}</div>
            <div class="m-acct-card">
            <div class="m-bill-status" data-bill-status data-paid-until={day(until)}>
              {on ? <span class="m-bill-dot" data-bill-dot /> : null}
              <span class="m-bill-days" data-bill-days>{left > 0 ? tp('sources.billing.daysLeft', left) : t('sources.billing.expired')}</span>
              <button type="button" class="m-bill-info" data-bill-info aria-expanded={info} aria-label={t('sources.billing.about')} onClick={() => setInfo(!info)}>
                i
              </button>
            </div>
            {account && account.bill && billShown(account.bill.priceRub, account.bill.feeRub, account.bill.totalRub).mode !== 'hide' && (
              <p class="m-small" data-bill-price>
                {(() => {
                  const shown = billShown(account.bill!.priceRub, account.bill!.feeRub, account.bill!.totalRub);
                  return shown.mode === 'full'
                    ? t('sources.billing.priceLine', { price: shown.price, fee: shown.fee, total: shown.total })
                    : t('sources.billing.priceOnly', { price: shown.price });
                })()}
              </p>
            )}
            {info && (
              <div class="m-src-row m-note m-muted" data-bill-about>
                {account && account.inGrace
                  ? t('sources.billing.grace', { date: day(account.paidUntil), until: day(account.accessUntil || 0) || '-' })
                  : t('sources.billing.paidUntil', { date: day(until) || '-' })}
              </div>
            )}
            {account && account.overLimit ? <div class="m-src-row m-note">{t('sources.billing.overLimit')}</div> : null}
            {account && account.supporter ? <div class="m-src-row m-note" data-supporter="1">{t('sources.billing.supporter')}</div> : null}
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
            <button
              type="button"
              class="m-btn m-btn-primary m-acct-wide"
              data-action="renew"
              aria-expanded={payOpen}
              onClick={() => setPayOpen(!payOpen)}
            >
              {t('sources.billing.renew')}
            </button>
            {payOpen && (
              <div class="m-src-row" data-pay-methods>
                <button type="button" class="m-btn m-btn-secondary" data-pay="card" onClick={() => window.open(BILLING_BOT_URL + '?start=renew', '_system')}>
                  {t('sources.billing.payCard')}
                </button>
                <button type="button" class="m-btn m-btn-secondary" data-pay="stars" onClick={() => window.open(BILLING_BOT_URL + '?start=renew', '_system')}>
                  {t('sources.billing.payStars')}
                </button>
                <button
                  type="button"
                  class="m-btn m-btn-secondary"
                  data-pay="crypto"
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
                  {cryptoBusy ? t('sources.billing.cryptoBusy') : t('sources.billing.payCrypto')}
                </button>
              </div>
            )}
            {account && account.bill && account.bill.autoRenew && (
              <button type="button" class="m-btn-text" data-bill-cancel onClick={() => void cancelRenew()}>
                {t('sources.billing.cancelRenew')}
              </button>
            )}
            <button type="button" class="m-btn-text" data-action="disconnect" onClick={() => void disconnect()}>
              {t('sources.billing.disconnect')}
            </button>
            </div>
            {account && account.bill && account.bill.payments.length > 0 && (
              <>
                <div class="m-set-label">{t('sources.billing.payments')}</div>
                <div class="m-acct-card" data-bill-payments>
                  {account.bill.payments.map((p) => {
                    const kind = paymentKind(p.title, p.currency);
                    const label = kind === 'card' ? t('sources.billing.payLineCard')
                      : kind === 'stars' ? t('sources.billing.payLineStars')
                      : kind === 'crypto' ? t('sources.billing.payLineCrypto')
                      : kind === 'promo' ? t('sources.billing.payLinePromo')
                      : p.title;
                    return (
                      <div class="m-set-row" key={p.at + ':' + p.amount} data-payment>
                        <span class="m-set-text">
                          <span>{label}</span>
                          {p.at ? <span class="m-muted m-small">{paymentDate(p.at)}</span> : null}
                        </span>
                        <span>{formatPayAmount(p.amount, p.currency)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
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
