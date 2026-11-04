// Asks /v1/me again so ads and the monitoring cap do not sit on a stale cache.
// On resume when the last answer is older than PREMIUM_RESUME_MIN_MS, and about every PREMIUM_FRESH_MS while
// the app stays open. A timeout or a 5xx keeps the previous answer (offline-safe). No session: no request.
import type { SourceContext } from '../sources/types';
import { billingSession } from './session';
import { PREMIUM_FRESH_MS, PREMIUM_RESUME_MIN_MS, premiumCheckedAt } from './entitlement';

export function premiumRecheckDue(now: number, reason: 'resume' | 'interval'): boolean {
  if (!billingSession()) return false;
  const at = premiumCheckedAt();
  if (!at || at > now + 60000) return true;
  const age = now - at;
  if (reason === 'resume') return age >= PREMIUM_RESUME_MIN_MS;
  return age >= PREMIUM_FRESH_MS;
}

/**
 * Wait until the next interval check. Measured from the last /v1/me, not from when the timer was created.
 * A startup request that finishes after the wait began would otherwise look a few seconds short of 6 hours
 * on the first tick, get skipped, and not run again until about 12 hours.
 */
export function nextRecheckDelay(now: number): number {
  const at = premiumCheckedAt();
  if (!at || at > now + 60000) return PREMIUM_FRESH_MS;
  const remain = at + PREMIUM_FRESH_MS - now;
  return remain > 0 ? remain : PREMIUM_FRESH_MS;
}

let inflight: Promise<void> | null = null;

/** One /v1/me when it is due. `force` asks even inside the resume gap (a list already over the free cap). */
export function recheckPremium(
  ctx: SourceContext,
  reason: 'resume' | 'interval',
  now?: number,
  opts?: { force?: boolean },
): Promise<void> {
  const at = now === undefined ? Date.now() : now;
  if (!billingSession()) return Promise.resolve();
  if (!(opts && opts.force) && !premiumRecheckDue(at, reason)) return Promise.resolve();
  if (inflight) return inflight;
  // Dynamic: the TV entry must not statically import the paid sources (the LG bundle test).
  const run = import('../sources/ompJackett')
    .then((m) => m.refreshOmpJackettSources(ctx))
    .then(
      () => undefined,
      () => undefined,
    );
  inflight = run;
  void run.then(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/**
 * Foreground page: check at start, when the app comes back, and again 6 hours after the last answer.
 * The wait is armed when a check settles, so a slow startup /v1/me does not push the next one to 12 hours.
 * Returns a stopper (tests).
 */
export function startPremiumRecheck(ctxOf: () => SourceContext): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    const wait = nextRecheckDelay(Date.now());
    timer = setTimeout(() => {
      timer = null;
      void recheckPremium(ctxOf(), 'interval').then(arm, arm);
    }, wait);
  };
  void recheckPremium(ctxOf(), 'resume').then(arm, arm);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    void recheckPremium(ctxOf(), 'resume').then(arm, arm);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
