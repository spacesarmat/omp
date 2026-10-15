import { accountCard, adminDashboard, financeReport, formatCode, openAppUrl, supportThreads, telegramDisplay } from './logic.mjs';
import { publicAdminSettings } from './services.mjs';
import { storageInfo } from './store.mjs';

function day(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

function subRows(state, now) {
  return state.subscriptions
    .slice()
    .reverse()
    .map((sub) => {
      const account = state.accounts.find((a) => a.id === sub.accountId) || {};
      const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
      const bound = codes.filter((c) => c.deviceId).length;
      const active = sub.paidUntil > now;
      const status = active ? (bound ? 'active' : 'unbound') : 'expired';
      return {
        id: sub.id,
        accountId: sub.accountId,
        who: account.telegramId ? telegramDisplay(account) : account.email || account.id || sub.accountId,
        telegramId: account.telegramId || '',
        telegramUsername: account.telegramUsername || '',
        telegramName: account.telegramName || '',
        paidUntil: sub.paidUntil,
        paidUntilText: day(sub.paidUntil),
        deviceLimit: sub.deviceLimit,
        bound,
        active,
        status,
        codes: codes.map((c) => ({
          id: c.id,
          plain: c.plain || '',
          bound: !!c.deviceId,
          deviceId: c.deviceId ? c.deviceId.slice(0, 8) : '',
          formatted: c.plain ? formatCode(c.plain) : '',
        })),
      };
    });
}

function promoRows(state) {
  return state.promos
    .slice()
    .reverse()
    .map((p) => ({
      id: p.id,
      code: p.code,
      days: p.days,
      uses: (p.uses || []).length,
      maxUses: p.maxUses,
      revoked: !!p.revoked,
    }));
}

function failRows(state) {
  return (state.attempts || [])
    .filter((a) => !a.ok)
    .slice(-40)
    .reverse()
    .map((a) => ({
      at: a.at,
      atText: day(a.at) + ' ' + new Date(a.at).toISOString().slice(11, 16),
      reason: a.reason || '',
      deviceId: (a.deviceId || '').slice(0, 8),
    }));
}

/** JSON bootstrap for the Preact admin SPA. */
export function homePayload(state, file, opts) {
  const now = Date.now();
  const dash = adminDashboard(state, now);
  const finance = financeReport(state, now);
  const s = state.settings;
  return {
    csrf: opts.csrf || '',
    sessionId: opts.sessionId || '',
    flash: {
      code: opts.code || '',
      promo: opts.promo || '',
      text: opts.flash || '',
      error: opts.error || '',
    },
    stats: {
      accounts: state.accounts.length,
      activeSubs: state.subscriptions.filter((x) => x.paidUntil > now).length,
      payments30: finance.summary.month.count,
      revenue30: finance.summary.month.sum,
    },
    alerts: dash.alerts || [],
    events: (dash.events || []).slice(0, 30),
    finance: {
      summary: finance.summary,
      payments: (finance.payments || []).slice(0, 40),
      problems: (finance.problems || []).slice(0, 20),
    },
    subscriptions: subRows(state, now),
    promos: promoRows(state),
    fails: failRows(state),
    sessions: opts.sessions || [],
    support: supportThreads(state).slice(0, 40),
    audit: (state.audit || []).slice(-40).reverse(),
    settings: publicAdminSettings(s),
    storage: storageInfo(file),
  };
}

export function userPayload(state, accountId, opts) {
  const card = accountCard(state, accountId, Date.now());
  if (!card) return null;
  const origin = state.settings.publicOrigin || '';
  const sub = card.sub;
  return {
    csrf: opts.csrf || '',
    flash: {
      code: opts.code || '',
      text: opts.flash || '',
      error: opts.error || '',
    },
    account: {
      id: card.account.id,
      email: card.account.email || '',
      telegramId: card.account.telegramId || '',
      telegramUsername: card.account.telegramUsername || '',
      telegramName: card.account.telegramName || '',
      createdAt: card.account.createdAt || 0,
      createdText: day(card.account.createdAt),
    },
    subscription: sub
      ? {
          id: sub.id,
          paidUntil: sub.paidUntil,
          paidUntilText: day(sub.paidUntil),
          active: !!sub.active,
          deviceLimit: sub.deviceLimit,
        }
      : null,
    codes: (card.codes || []).map((c) => ({
      id: c.id,
      plain: c.plain || '',
      formatted: c.plain ? formatCode(c.plain) : '',
      bound: !!c.deviceId,
      deviceId: c.deviceId ? c.deviceId.slice(0, 8) : '',
      openUrl: c.plain ? openAppUrl(origin, c.plain) : '',
    })),
    payments: card.payments || [],
    promos: card.promos || [],
    attempts: card.attempts || [],
    reveal: card.reveal || null,
  };
}
