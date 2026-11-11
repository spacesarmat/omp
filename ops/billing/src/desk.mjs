/** Admin desk: dashboard numbers, search, sources, roles, alerts, presence. Pure helpers. */
import { createHash } from 'node:crypto';
import { SEEN_EVERY_MS } from './deviceAdmin.mjs';
import { creditOf, logAudit, mainSubscription } from './logic.mjs';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** last_seen is written at most once per SEEN_EVERY_MS, so online must cover that gap. */
export const ONLINE_MS = SEEN_EVERY_MS + 5 * 60 * 1000;
export const FUNNEL = ['install', 'login', 'trial', 'payment', 'renewal'];
const FUNNEL_SET = new Set(FUNNEL);

export const RESTART_ALLOW = ['omp-jackett', 'omp-jacred', 'omp-torrserver', 'omp-flaresolverr', 'omp-bitmagnet'];

/** Settings a rollback may restore. Secrets and wallets stay out. */
export const ROLLBACK_KEYS = [
  'botUsername',
  'publicOrigin',
  'adminTelegramIds',
  'adminReaders',
  'adminNotify',
  'jackettUrl',
  'jackettEnabled',
  'jacredUrl',
  'jacredEnabled',
  'bitmagnetUrl',
  'bitmagnetEnabled',
  'torrserverUrl',
  'indexerUser',
  'smtpHost',
  'smtpUser',
  'smtpFrom',
  'priceRub',
  'periodDays',
  'extraDeviceRub',
  'baseDevices',
  'graceDays',
  'publicPromo',
  'backupEveryHours',
  'backupKeepDays',
  'dhtPerMinute',
  'cacheNodesEnabled',
  'cachePrefixMb',
  'cachePrefixPercent',
  'betaPercent',
];

const SOURCE_KEYS = ['jackett', 'jacred', 'bitmagnet', 'torrserver'];

function money(v) {
  const n = Number(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function idsOf(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function deviceKey(id) {
  return createHash('sha256').update(String(id || '')).digest('hex').slice(0, 16);
}

/** full: may change data. read: the panel only. cli stays full. */
export function roleOf(settings, admin) {
  if (!admin) return 'none';
  if (admin.via === 'cli') return 'full';
  const id = String(admin.telegramId || '');
  if (id && idsOf(settings && settings.adminReaders).indexOf(id) >= 0) return 'read';
  return 'full';
}

export function confirmed(body) {
  const v = body && body.confirm;
  return v === 'yes' || v === true || v === 'true';
}

export function restartAllowed(name) {
  const n = String(name || '').replace(/^\//, '');
  return RESTART_ALLOW.indexOf(n) >= 0;
}

export function snapshotSettings(settings) {
  const s = settings || {};
  const out = {};
  for (let i = 0; i < ROLLBACK_KEYS.length; i++) {
    const k = ROLLBACK_KEYS[i];
    out[k] = s[k] === undefined ? null : s[k];
  }
  return out;
}

export function pushRollback(state, row) {
  const deskRollbacks = (state.deskRollbacks || []).concat([row]).slice(-40);
  return { ...state, deskRollbacks };
}

export function findRollback(state, id) {
  return (state.deskRollbacks || []).find((r) => r && r.id === id) || null;
}

export function applyRollback(settings, before) {
  const next = { ...(settings || {}) };
  const src = before || {};
  for (let i = 0; i < ROLLBACK_KEYS.length; i++) {
    const k = ROLLBACK_KEYS[i];
    if (!Object.prototype.hasOwnProperty.call(src, k) || src[k] === null) delete next[k];
    else next[k] = src[k];
  }
  return next;
}

export function paymentFee(p) {
  const got = money(p && p.amount);
  const gross = money(p && p.withdrawAmount);
  if (!(gross > 0) || gross + 0.001 < got) return { fee: null, charged: null };
  return { fee: Math.round((gross - got) * 100) / 100, charged: gross };
}

export function addCredit(state, { accountId, rub, now, actor }) {
  const sub = mainSubscription(state, accountId);
  if (!sub) return { state, result: { error: 'no_sub' } };
  const add = Math.floor(Number(rub) || 0);
  if (add < 1 || add > 100000) return { state, result: { error: 'bad_amount' } };
  const subscriptions = state.subscriptions.map((s) => (s.id === sub.id ? { ...s, creditRub: creditOf(s) + add } : s));
  const next = logAudit(
    { ...state, subscriptions },
    { action: 'credit', detail: '+' + add + ' ₽', now: now || Date.now(), actor, accountId: sub.accountId },
  );
  return { state: next, result: { ok: true, creditRub: creditOf(sub) + add } };
}

export function recordProbes(state, probes, now) {
  const deskSources = { ...(state.deskSources || {}) };
  const at = now || Date.now();
  for (let i = 0; i < SOURCE_KEYS.length; i++) {
    const key = SOURCE_KEYS[i];
    const p = probes && probes[key];
    if (!p) continue;
    const row = { at, ok: !!p.ok, ms: Number(p.latencyMs) || 0, error: String(p.error || '') };
    deskSources[key] = (deskSources[key] || []).concat([row]).slice(-200);
  }
  return { ...state, deskSources };
}

export function sourceStats(samples, probe) {
  const list = samples || [];
  const window = list.slice(-50);
  const ok = window.filter((r) => r.ok).length;
  const lastBad = list.slice().reverse().find((r) => r && !r.ok);
  return {
    ok: probe ? !!probe.ok : null,
    latencyMs: probe ? Number(probe.latencyMs) || 0 : window.length ? window[window.length - 1].ms : 0,
    success: window.length ? Math.round((ok / window.length) * 1000) / 10 : null,
    samples: window.length,
    lastError: lastBad ? lastBad.error || 'down' : '',
    checkedAt: probe && probe.checkedAt ? probe.checkedAt : window.length ? window[window.length - 1].at : 0,
  };
}

function sparkFrom(rows, key) {
  return rows.map((r) => ({ t: r.t, v: r[key] }));
}

export function hourlyPayments(state, now) {
  const start = now - 24 * HOUR;
  const buckets = [];
  for (let i = 0; i < 24; i++) buckets.push({ t: start + i * HOUR, v: 0, n: 0 });
  const payments = state.payments || [];
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (!p || p.error || p.pending || !p.at || p.at < start || p.at > now) continue;
    const idx = Math.min(23, Math.max(0, Math.floor((p.at - start) / HOUR)));
    buckets[idx].v += money(p.amount);
    buckets[idx].n += 1;
  }
  return buckets;
}

export function dailyWindow(series, days) {
  const rows = series || [];
  return rows.slice(-days).map((r) => ({ t: r.day, v: r.revenue, n: r.subs }));
}

export function errorCount(state, now) {
  const from = now - DAY;
  let n = 0;
  const attempts = state.attempts || [];
  for (let i = 0; i < attempts.length; i++) if (attempts[i] && !attempts[i].ok && (attempts[i].at || 0) >= from) n += 1;
  const payments = state.payments || [];
  for (let i = 0; i < payments.length; i++) if (payments[i] && payments[i].error && (payments[i].at || 0) >= from) n += 1;
  const hooks = state.webhooks || [];
  for (let i = 0; i < hooks.length; i++) if (hooks[i] && hooks[i].kind && hooks[i].kind !== 'ok' && (hooks[i].at || 0) >= from) n += 1;
  return n;
}

export function recentFailCount(state, now, windowMs) {
  const from = now - (windowMs || 15 * 60 * 1000);
  let n = 0;
  const attempts = state.attempts || [];
  for (let i = 0; i < attempts.length; i++) if (attempts[i] && !attempts[i].ok && (attempts[i].at || 0) >= from) n += 1;
  const payments = state.payments || [];
  for (let i = 0; i < payments.length; i++) if (payments[i] && payments[i].error && (payments[i].at || 0) >= from) n += 1;
  return n;
}

export function deviceTable(state, registryMap, versions, now) {
  const accounts = new Map((state.accounts || []).map((a) => [a.id, a]));
  const rows = [];
  const seen = new Set();
  if (registryMap && typeof registryMap.values === 'function') {
    for (const r of registryMap.values()) {
      const full = String(r.device_id || '');
      const key = deviceKey(full);
      const ver = versions && versions[key];
      const at = Number(r.last_seen_at) || 0;
      const acc = accounts.get(r.account_id) || {};
      seen.add(full);
      rows.push({
        id: String(r.id || ''),
        deviceId: full.slice(0, 8),
        name: String(r.name || ''),
        accountId: String(r.account_id || ''),
        who: acc.telegramUsername || acc.telegramId || acc.email || '',
        lastSeenAt: at,
        online: at > 0 && now - at < ONLINE_MS,
        version: ver ? ver.version : '',
        platform: ver ? ver.platform : '',
      });
    }
  }
  return rows;
}

export function onlineCount(rows) {
  return (rows || []).filter((r) => r.online).length;
}

export function funnelView(state, now) {
  const events = state.deskEvents || [];
  const steps = FUNNEL.map((name) => {
    const keys = new Set();
    for (let i = 0; i < events.length; i++) if (events[i] && events[i].name === name) keys.add(events[i].key || events[i].at);
    return { name, label: funnelLabel(name), users: keys.size };
  });
  const withRate = steps.map((s, i) => ({
    ...s,
    conversion: i === 0 || !steps[i - 1].users ? null : Math.round((s.users / steps[i - 1].users) * 1000) / 10,
  }));
  const payByAccount = new Map();
  const payments = state.payments || [];
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (!p || p.error || p.pending || !p.accountId) continue;
    payByAccount.set(p.accountId, (payByAccount.get(p.accountId) || 0) + 1);
  }
  let renewed = 0;
  for (const n of payByAccount.values()) if (n >= 2) renewed += 1;
  let trial = 0;
  const promos = state.promos || [];
  for (let i = 0; i < promos.length; i++) trial += ((promos[i] && promos[i].uses) || []).length;
  const bound = (state.codes || []).filter((c) => c && c.deviceId && !c.revoked).length;
  return {
    steps: withRate,
    estimated: {
      note: 'Оценка по биллингу, если приложения ещё не прислали шаги',
      install: (state.accounts || []).length,
      login: bound,
      trial,
      payment: payByAccount.size,
      renewal: renewed,
    },
    asOf: now,
  };
}

function funnelLabel(name) {
  if (name === 'install') return 'Установка';
  if (name === 'login') return 'Вход';
  if (name === 'trial') return 'Пробный';
  if (name === 'payment') return 'Оплата';
  return 'Продление';
}

export function revenueView(state, series, now) {
  const monthStart = now - 30 * DAY;
  const payments = (state.payments || []).filter((p) => p && !p.error && !p.pending);
  let monthSum = 0;
  let monthN = 0;
  const byMonth = new Map();
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const at = p.at || 0;
    if (at >= monthStart && at <= now) {
      monthSum += money(p.amount);
      monthN += 1;
    }
    if (!at) continue;
    const key = new Date(at).toISOString().slice(0, 7);
    const cur = byMonth.get(key) || { month: key, sum: 0, n: 0 };
    cur.sum += money(p.amount);
    cur.n += 1;
    byMonth.set(key, cur);
  }
  let expired = 0;
  let active = 0;
  let due = 0;
  const price = money(state.settings && state.settings.priceRub);
  const subs = state.subscriptions || [];
  for (let i = 0; i < subs.length; i++) {
    const until = subs[i].paidUntil || 0;
    if (until > now) active += 1;
    if (until >= monthStart && until < now) expired += 1;
    if (until >= now && until < now + 7 * DAY) due += 1;
  }
  const base = expired + active;
  return {
    monthSum: Math.round(monthSum),
    monthN,
    byDay: dailyWindow(series, 30),
    byMonth: Array.from(byMonth.values()).slice(-12),
    churn: { expired, active, rate: base ? Math.round((expired / base) * 1000) / 10 : 0 },
    forecast: { due, sum: Math.round(due * price), price },
  };
}

export function rankingView(state) {
  const rows = state && Array.isArray(state.watchRank) ? state.watchRank : null;
  if (!rows) {
    return {
      available: false,
      note: 'Список подбора читается из базы на экране «Подбор». В снимке панели строк нет.',
      rows: [],
    };
  }
  return {
    available: true,
    note: '',
    rows: rows.slice(0, 50).map((r) => ({
      title: String(r.title || r.name || ''),
      infohash: String(r.infohash || ''),
      watches: Number(r.watches || r.samples || 0),
      winner: String(r.winner || r.release || ''),
      why: String(r.why || r.reason || ''),
      pinned: !!r.pinned,
      banned: !!r.banned,
    })),
  };
}

export function setWatchFlag(state, { infohash, flag, on }) {
  if (!Array.isArray(state.watchRank)) return { state, result: { error: 'unavailable' } };
  const hash = String(infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return { state, result: { error: 'bad_hash' } };
  let found = false;
  const watchRank = state.watchRank.map((r) => {
    if (String(r.infohash || '').toLowerCase() !== hash) return r;
    found = true;
    if (flag === 'ban') return { ...r, banned: !!on, pinned: on ? false : r.pinned };
    return { ...r, pinned: !!on, banned: on ? false : r.banned };
  });
  if (!found) return { state, result: { error: 'not_found' } };
  return { state: { ...state, watchRank }, result: { ok: true } };
}

export function searchDesk(state, devices, q) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return [];
  const out = [];
  const accounts = state.accounts || [];
  for (let i = 0; i < accounts.length && out.length < 20; i++) {
    const a = accounts[i];
    const hay = [a.id, a.email, a.telegramId, a.telegramUsername, a.telegramName].join(' ').toLowerCase();
    if (hay.indexOf(query) >= 0) {
      out.push({
        kind: 'account',
        id: a.id,
        title: a.telegramUsername || a.telegramName || a.email || a.id,
        href: '/admin/?id=' + encodeURIComponent(a.id),
      });
    }
  }
  const list = devices || [];
  for (let i = 0; i < list.length && out.length < 20; i++) {
    const d = list[i];
    const hay = [d.deviceId, d.name, d.who, d.accountId].join(' ').toLowerCase();
    if (hay.indexOf(query) >= 0) {
      out.push({
        kind: 'device',
        id: d.id || d.deviceId,
        title: (d.name || d.deviceId) + (d.who ? ' · ' + d.who : ''),
        href: d.accountId ? '/admin/?id=' + encodeURIComponent(d.accountId) : '/admin/?tab=devices',
      });
    }
  }
  const payments = state.payments || [];
  for (let i = payments.length - 1; i >= 0 && out.length < 20; i--) {
    const p = payments[i];
    const hay = [p.operationId, p.label, p.amount, p.accountId].join(' ').toLowerCase();
    if (hay.indexOf(query) >= 0) {
      out.push({
        kind: 'order',
        id: p.operationId || String(p.at || i),
        title: (p.amount || '-') + (p.label ? ' · ' + p.label : ''),
        href: p.accountId ? '/admin/?id=' + encodeURIComponent(p.accountId) : '/admin/?tab=finance',
      });
    }
  }
  const ranks = Array.isArray(state.watchRank) ? state.watchRank : [];
  for (let i = 0; i < ranks.length && out.length < 20; i++) {
    const r = ranks[i];
    const title = String(r.title || r.name || r.winner || '');
    if (title.toLowerCase().indexOf(query) >= 0 || String(r.infohash || '').indexOf(query) >= 0) {
      out.push({ kind: 'release', id: String(r.infohash || i), title: title || String(r.infohash || ''), href: '/admin/?tab=rank' });
    }
  }
  return out;
}

export function usersFrom(state, now) {
  const subs = state.subscriptions || [];
  const byAccount = new Map();
  for (let i = 0; i < subs.length; i++) {
    const cur = byAccount.get(subs[i].accountId);
    if (!cur || (subs[i].paidUntil || 0) > (cur.paidUntil || 0)) byAccount.set(subs[i].accountId, subs[i]);
  }
  return (state.accounts || []).map((a) => {
    const sub = byAccount.get(a.id);
    return {
      id: a.id,
      who: a.telegramUsername || a.telegramName || a.email || a.telegramId || a.id,
      telegramId: a.telegramId || '',
      email: a.email || '',
      paidUntil: sub ? sub.paidUntil || 0 : 0,
      active: !!(sub && sub.paidUntil > now),
    };
  });
}

export function parsePresence(body) {
  const raw = body && body.payload ? parseJson(body.payload) : body || {};
  const events = Array.isArray(raw.events)
    ? raw.events
    : String(raw.events || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    version: String(raw.version || '').slice(0, 40),
    platform: String(raw.platform || '').slice(0, 24),
    diagnostics: raw.diagnostics === true || raw.diagnostics === '1' || raw.diagnostics === 'true',
    events: events.map((x) => String(x).slice(0, 24)).filter((x) => FUNNEL_SET.has(x)).slice(0, 8),
  };
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return {};
  }
}

/** Trial, payment and renewal come from billing rows, not from the app's paid flag. */
export function billingFunnelSteps(state, accountId) {
  const names = [];
  const promos = state.promos || [];
  for (let i = 0; i < promos.length; i++) {
    const uses = (promos[i] && promos[i].uses) || [];
    for (let u = 0; u < uses.length; u++) {
      if (uses[u] && uses[u].accountId === accountId) {
        names.push('trial');
        i = promos.length;
        break;
      }
    }
  }
  let pays = 0;
  const payments = state.payments || [];
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (p && p.accountId === accountId && !p.error && !p.pending) pays += 1;
  }
  if (pays >= 1) names.push('payment');
  if (pays >= 2) names.push('renewal');
  return names;
}

export function ingestPresence(state, input, now) {
  const at = now || Date.now();
  let deskEvents = state.deskEvents || [];
  const names = (input.events || []).filter((name) => FUNNEL_SET.has(name));
  if (input.diagnostics && input.accountId) {
    const facts = billingFunnelSteps(state, input.accountId);
    for (let i = 0; i < facts.length; i++) if (names.indexOf(facts[i]) < 0) names.push(facts[i]);
  }
  if (input.diagnostics && names.length) {
    const seen = {};
    for (let i = 0; i < deskEvents.length; i++) {
      if (deskEvents[i] && deskEvents[i].key === input.key) seen[deskEvents[i].name] = true;
    }
    const extra = [];
    for (let i = 0; i < names.length; i++) {
      if (seen[names[i]]) continue;
      extra.push({
        name: names[i],
        at,
        key: input.key,
        accountId: input.accountId || '',
        version: input.version || '',
        platform: input.platform || '',
      });
    }
    deskEvents = deskEvents.concat(extra).slice(-2000);
  }
  const deskVersions = { ...(state.deskVersions || {}) };
  if (input.diagnostics && input.version && input.key) {
    deskVersions[input.key] = {
      version: input.version,
      platform: input.platform || '',
      at,
      accountId: input.accountId || '',
    };
    const keys = Object.keys(deskVersions);
    if (keys.length > 5000) delete deskVersions[keys[0]];
  }
  return { ...state, deskEvents, deskVersions };
}

export function watchFor(state, accountId) {
  return (state.deskEvents || [])
    .filter((e) => e && e.accountId === accountId)
    .slice(-40)
    .reverse();
}

export function diskAlert(prev, ratio) {
  const low = ratio != null && ratio < 0.1;
  if (low && prev !== 'low') return { snapshot: 'low', text: 'Диск NUC: свободно меньше 10%' };
  if (!low) return { snapshot: 'ok', text: '' };
  return { snapshot: 'low', text: '' };
}

export function spikeAlert(prevAt, count, now) {
  if (count < 20) return { at: 0, text: '' };
  if (prevAt && now - prevAt < HOUR) return { at: prevAt, text: '' };
  return { at: now, text: 'Всплеск ошибок: ' + count + ' за 15 минут' };
}

export async function diskRatio(paths) {
  let worst = null;
  let statfs;
  try {
    ({ statfs } = await import('node:fs/promises'));
  } catch {
    return null;
  }
  const list = paths || [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    try {
      const st = await statfs(list[i]);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      if (!total) continue;
      const ratio = free / total;
      if (!worst || ratio < worst.ratio) worst = { path: list[i], ratio, free, total };
    } catch {
      /* this path is not mounted here */
    }
  }
  return worst;
}

export function cpuPercent(stats) {
  const cpu = stats && stats.cpu_stats;
  const pre = stats && stats.precpu_stats;
  if (!cpu || !pre || !cpu.cpu_usage || !pre.cpu_usage) return null;
  const delta = Number(cpu.cpu_usage.total_usage) - Number(pre.cpu_usage.total_usage);
  const sys = Number(cpu.system_cpu_usage) - Number(pre.system_cpu_usage);
  const n = Number(cpu.online_cpus) || (cpu.cpu_usage.percpu_usage && cpu.cpu_usage.percpu_usage.length) || 1;
  if (!(sys > 0) || delta < 0) return null;
  return Math.round((delta / sys) * n * 1000) / 10;
}

export function memBytes(stats) {
  const m = stats && stats.memory_stats;
  if (!m) return null;
  const used = Number(m.usage) || 0;
  const cache = m.stats && Number(m.stats.cache);
  return Math.max(0, used - (Number.isFinite(cache) ? cache : 0));
}

export function containerName(row) {
  const names = row && row.Names;
  const raw = Array.isArray(names) && names.length ? names[0] : row && (row.name || row.Name);
  return String(raw || '').replace(/^\//, '');
}

export function redactText(text) {
  return String(text || '')
    .replace(/magnet:\?[^\s"'<>]*/gi, 'magnet:[скрыто]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/g, '$1 [скрыто]')
    .replace(/\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g, '[ip]')
    .replace(/\b[0-9a-fA-F]{40}\b/g, '[hash]')
    .slice(0, 20000);
}

export function buildHealth(probes, samples) {
  const billing = { name: 'billing', ok: true, latencyMs: 0, success: 100, lastError: '', enabled: true, configured: true };
  const out = [billing];
  for (let i = 0; i < SOURCE_KEYS.length; i++) {
    const key = SOURCE_KEYS[i];
    const probe = probes && probes[key];
    const stat = sourceStats(samples && samples[key], probe);
    out.push({
      name: key,
      ok: stat.ok,
      latencyMs: stat.latencyMs,
      success: stat.success,
      lastError: stat.lastError,
      enabled: probe ? probe.enabled !== false : true,
      configured: probe ? !!probe.configured : false,
      checkedAt: stat.checkedAt,
    });
  }
  return out;
}

export { sparkFrom };
