/**
 * How long log rows are kept (Andy, 19.10.2026): the admin audit and problem YooMoney notifications 1 year,
 * activation attempts 90 days. Applied once by the Postgres data migration and daily by a Postgres store.
 * Rows without a numeric `at` are kept (nothing to judge them by).
 */
const DAY = 24 * 60 * 60 * 1000;

export const LOG_RETENTION_DAYS = { audit: 365, webhooks: 365, attempts: 90 };

/** Postgres tables of the same logs (dead rows there are deleted by the same cutoff). */
export const LOG_TABLES = { audit: 'audit', webhooks: 'webhook_problems', attempts: 'activation_attempts' };

export function retentionCutoffs(now) {
  const out = {};
  for (const [name, days] of Object.entries(LOG_RETENTION_DAYS)) out[name] = now - days * DAY;
  return out;
}

function keep(row, cutoff) {
  const at = row && typeof row === 'object' ? row.at : undefined;
  return typeof at !== 'number' || !Number.isFinite(at) || at >= cutoff;
}

/** Rows each log would lose at `now` (no change). */
export function expiredLogCounts(state, now) {
  const cut = retentionCutoffs(now);
  const out = {};
  for (const name of Object.keys(LOG_RETENTION_DAYS)) {
    const list = Array.isArray(state[name]) ? state[name] : [];
    out[name] = list.filter((r) => !keep(r, cut[name])).length;
  }
  return out;
}

/** The state without log rows older than their retention. The same object when nothing expired. */
export function pruneLogs(state, now) {
  const counts = expiredLogCounts(state, now);
  if (!Object.values(counts).some((n) => n > 0)) return state;
  const cut = retentionCutoffs(now);
  const next = { ...state };
  for (const name of Object.keys(LOG_RETENTION_DAYS)) {
    if (counts[name]) next[name] = state[name].filter((r) => keep(r, cut[name]));
  }
  return next;
}
