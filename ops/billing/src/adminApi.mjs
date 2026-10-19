import { maskIp, pendingPayments, swapStatus } from './deviceAdmin.mjs';
import {
  accountCard,
  activeExtras,
  adminDashboard,
  bonusActive,
  bonusRows,
  dailySeries,
  limitBreakdown,
  limitOverrideOf,
  deviceLimitNow,
  financeReport,
  mainSubscription,
  subAccess,
  supportThreads,
  telegramDisplay,
} from './logic.mjs';
import { publicAdminSettings } from './services.mjs';
import { backupAlert } from './pgBackup.mjs';

const DAY = 24 * 60 * 60 * 1000;

function day(ms) {
  if (!ms) return '-';
  return new Date(ms).toISOString().slice(0, 10);
}

function subStatus(state, sub, bound, now) {
  if (!(sub.paidUntil > now)) return subAccess(state, sub, now).grace ? 'grace' : 'expired';
  const left = sub.paidUntil - now;
  // soon/expiring stay visible as expiry. «Без устройства» matches bound === 0 on its own.
  if (left <= DAY) return 'expiring';
  if (left <= 7 * DAY) return 'soon';
  if (!bound) return 'unbound';
  return 'active';
}

function subRows(state, now) {
  return state.subscriptions
    .slice()
    .reverse()
    .map((sub) => {
      const account = state.accounts.find((a) => a.id === sub.accountId) || {};
      const codes = state.codes.filter((c) => c.subscriptionId === sub.id && !c.revoked);
      const bound = codes.filter((c) => c.deviceId).length;
      const access = subAccess(state, sub, now);
      const active = access.access;
      const limit = deviceLimitNow(state, sub, now);
      return {
        id: sub.id,
        accountId: sub.accountId,
        who: account.telegramId ? telegramDisplay(account) : account.email || account.id || sub.accountId,
        telegramId: account.telegramId || '',
        telegramUsername: account.telegramUsername || '',
        telegramName: account.telegramName || '',
        paidUntil: sub.paidUntil,
        paidUntilText: day(sub.paidUntil),
        createdAt: sub.createdAt || 0,
        deviceLimit: limit,
        limitText: limitBreakdown(state, sub, now).text,
        limitOverride: limitOverrideOf(sub),
        extraSlots: activeExtras(state, sub, now),
        extraUntil: Number(sub.extraUntil) || 0,
        inGrace: access.grace,
        accessUntil: access.accessUntil,
        bound,
        active,
        status: subStatus(state, sub, bound, now),
        overLimit: bound > limit,
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
      bonusSlots: p.bonusSlots || 0,
      bonusDays: p.bonusSlots ? p.bonusDays || 0 : 0,
      uses: (p.uses || []).length,
      maxUses: p.maxUses,
      revoked: !!p.revoked,
      createdAt: p.createdAt || 0,
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
    alerts: homeAlerts(dash.alerts || [], opts),
    events: (dash.events || []).slice(0, 80),
    finance: {
      summary: finance.summary,
      payments: (finance.payments || []).slice(0, 40),
      problems: (finance.problems || []).slice(0, 20),
    },
    subscriptions: subRows(state, now),
    pending: pendingPayments(state),
    promos: promoRows(state),
    fails: failRows(state),
    sessions: opts.sessions || [],
    support: supportThreads(state).slice(0, 40),
    audit: (state.audit || []).slice(-40).reverse(),
    series: dailySeries(state, now, 90),
    settings: publicAdminSettings(s),
    // The server passes the store's info (Postgres: engine, database name, size).
    storage: (opts && opts.storage) || null,
    // Postgres dumps: null when BILLING_PG_BACKUP_DIR is not set (file names and sizes only, no paths with secrets).
    backup: (opts && opts.backup) || null,
    readOnly: !!(opts && opts.readOnly),
    // Secrets live in the server's .env: label, .env name, «задан ✅, ****abcd» and the source; never a value.
    secrets: (opts && opts.secrets) || [],
  };
}

/** Dashboard alerts plus the cutover read-only mode and a stale Postgres backup. */
function homeAlerts(alerts, opts) {
  const out = alerts.slice();
  if (opts && opts.readOnly) out.unshift({ level: 'bad', text: 'Биллинг в режиме только чтения (переключение хранилища): изменения не сохраняются' });
  const text = backupAlert(opts && opts.backup);
  if (text) out.unshift({ level: 'bad', text });
  return out;
}

/**
 * The device list comes from the registry (src/registry.mjs) when the server passes `registry`:
 * lastSeen, truncated IP and whether the phone already uses refresh tokens. Without it (tests of
 * the payload alone) the bound codes are listed as before.
 */
function deviceRows(card, registry, overIds) {
  const bound = (card.codes || []).filter((c) => c.deviceId);
  const byCode = new Map(bound.map((c) => [c.id, c]));
  if (typeof registry === 'function' && card.sub) {
    return registry(card.sub.id)
      .filter((r) => byCode.has(r.code_id) && byCode.get(r.code_id).deviceId === r.device_id)
      .map((r) => ({
        id: r.id,
        codeId: r.code_id,
        deviceId: String(r.device_id).slice(0, 8),
        name: String(r.name || ''),
        boundAt: Number(r.bound_at) || 0,
        lastSeenAt: Number(r.last_seen_at) || 0,
        lastIp: maskIp(r.last_ip_net),
        auth: r.auth === 'refresh' ? 'refresh' : 'legacy',
        cloneAt: Number(r.clone_at) || 0,
        cloneCount: Number(r.clone_count) || 0,
        overLimit: overIds.has(r.code_id),
      }));
  }
  return bound
    .sort((a, b) => (a.boundAt || 0) - (b.boundAt || 0))
    .map((c) => ({
      id: '',
      codeId: c.id,
      deviceId: c.deviceId.slice(0, 8),
      boundAt: c.boundAt || 0,
      lastSeenAt: c.lastSeenAt || 0,
      lastIp: maskIp(c.lastIp),
      auth: 'legacy',
      overLimit: overIds.has(c.id),
    }));
}

/**
 * The limit of one subscription for the panel: the breakdown text, the individual limit (null = the global base),
 * the global base, and every bonus row (expired ones too, marked), newest first.
 */
function limitPayload(state, subRow, now) {
  if (!subRow) return {};
  const limit = limitBreakdown(state, subRow, now);
  return {
    limitText: limit.text,
    limitOverride: limit.override,
    globalBase: limit.globalBase,
    bonusSlots: limit.bonusTotal,
    bonus: bonusRows(subRow)
      .map((b) => ({
        id: String(b.id || ''),
        count: Math.floor(Number(b.count)) || 0,
        until: b.until === null || b.until === undefined || b.until === '' ? null : Number(b.until) || 0,
        reason: String(b.reason || ''),
        grantedAt: Number(b.grantedAt) || 0,
        source: b.source === 'promo' ? 'promo' : 'admin',
        active: bonusActive(b, now),
      }))
      .reverse(),
  };
}

export function userPayload(state, accountId, opts) {
  const now = Date.now();
  const card = accountCard(state, accountId, now);
  if (!card) return null;
  const sub = card.sub;
  const subRow = sub ? mainSubscription(state, card.account.id) : null;
  const overIds = new Set(((sub && sub.devices) || []).filter((d) => d.overLimit).map((d) => d.id));
  const boundCount = (card.codes || []).filter((c) => c.deviceId).length;
  const swaps = subRow ? swapStatus(subRow, now, 1) : null;
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
          inGrace: !!sub.inGrace,
          accessUntil: sub.accessUntil || 0,
          deviceLimit: sub.deviceLimit,
          baseLimit: sub.baseLimit,
          ...limitPayload(state, subRow, now),
          extraSlots: sub.extraSlots,
          extraUntil: sub.extraUntil || 0,
          bound: boundCount,
          overLimit: boundCount > sub.deviceLimit,
          swaps: swaps
            ? { used: swaps.used, left: swaps.left, limit: swaps.limit, nextAt: Number.isFinite(swaps.nextAt) ? swaps.nextAt : 0, resetAt: swaps.resetAt }
            : null,
        }
      : null,
    /** Bound devices, oldest binding first. */
    devices: deviceRows(card, opts.registry, overIds),
    pending: pendingPayments(state, card.account.id),
    codes: (card.codes || []).map((c) => ({
      id: c.id,
      hasPlain: !!c.plain,
      bound: !!c.deviceId,
      deviceId: c.deviceId ? c.deviceId.slice(0, 8) : '',
      createdAt: c.createdAt || 0,
      boundAt: c.boundAt || 0,
    })),
    payments: (card.payments || []).map((p) => ({
      at: p.at || 0,
      amount: p.amount || '',
      label: p.label || '',
      operationId: p.operationId || '',
      error: p.error || '',
    })),
    promos: (card.promos || []).map((p) => ({
      code: p.code,
      days: p.days,
      at: p.at || 0,
    })),
    attempts: (card.attempts || []).map((a) => ({
      at: a.at || 0,
      ok: !!a.ok,
      reason: a.reason || '',
      deviceId: a.deviceId ? String(a.deviceId).slice(0, 8) : '',
    })),
  };
}
