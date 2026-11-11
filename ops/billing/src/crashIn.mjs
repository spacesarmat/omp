/** Crash groups. Reports are scrubbed again on the server. No magnets, tokens or IPs are kept. */
import { createHash } from 'node:crypto';
import { redactText } from './desk.mjs';

const CAP_GROUPS = 200;
const CAP_REPORTS = 40;

export function crashFingerprint(message, stack) {
  const lines = String(stack || message || '')
    .split('\n')
    .slice(0, 8)
    .map((l) => l.replace(/:\d+:\d+/g, '').replace(/\d+/g, '#'))
    .join('\n');
  return createHash('sha256').update(lines).digest('hex').slice(0, 16);
}

function versionLess(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => Number(x) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0;
  }
  return false;
}

export function ingestCrash(state, raw, now) {
  const message = redactText(raw.message || '').slice(0, 500);
  const stack = redactText(raw.stack || '').slice(0, 4000);
  const logs = redactText(raw.logs || '').slice(0, 60000);
  const comment = redactText(raw.comment || '').slice(0, 1000);
  const id = crashFingerprint(message, stack);
  const version = String(raw.version || '').slice(0, 40);
  const platform = String(raw.platform || '').slice(0, 24);
  const device = String(raw.device || '').slice(0, 16);
  const groups = (state.crashGroups || []).slice();
  let group = groups.find((g) => g.id === id);
  let alert = '';
  if (!group) {
    group = {
      id,
      status: 'new',
      count: 0,
      devices: [],
      versions: [],
      firstAt: now,
      lastAt: now,
      title: message.slice(0, 140) || 'сбой',
      regression: false,
      recent: [],
    };
    groups.push(group);
    alert = 'new';
  }
  let newest = '';
  const known = group.versions || [];
  for (let i = 0; i < known.length; i++) {
    if (!newest || versionLess(newest, known[i])) newest = known[i];
  }
  if (group.status === 'fixed' && version && versionLess(newest, version)) {
    group.status = 'new';
    group.regression = true;
    alert = 'regression';
  }
  group.count += 1;
  group.lastAt = now;
  if (version && group.versions.indexOf(version) < 0) group.versions.push(version);
  if (device && group.devices.indexOf(device) < 0 && group.devices.length < 200) group.devices.push(device);
  group.recent = (group.recent || []).concat([now]).filter((t) => now - t < 15 * 60 * 1000).slice(-30);
  if (!alert && group.recent.length >= 8) alert = 'spike';
  const shot = String(raw.screenshot || '');
  const report = {
    id: id + ':' + now,
    groupId: id,
    at: now,
    version,
    platform,
    device,
    message,
    stack,
    logs,
    comment,
    crumbs: redactText(Array.isArray(raw.crumbs) ? raw.crumbs.join('\n') : raw.crumbs || '').slice(0, 4000),
    screenshot: shot.length > 0 && shot.length <= 120000 ? shot : '',
    kind: String(raw.kind || 'error').slice(0, 24),
  };
  const crashReports = (state.crashReports || []).concat([report]).slice(-CAP_REPORTS);
  const crashGroups = groups.slice(-CAP_GROUPS);
  return { state: { ...state, crashGroups, crashReports }, alert, group };
}

export function setCrashStatus(state, id, status) {
  const allowed = ['new', 'progress', 'fixed', 'ignored'];
  if (allowed.indexOf(status) < 0) return { state, error: 'bad_status' };
  let found = false;
  const crashGroups = (state.crashGroups || []).map((g) => {
    if (g.id !== id) return g;
    found = true;
    return { ...g, status, regression: status === 'fixed' ? false : g.regression };
  });
  if (!found) return { state, error: 'not_found' };
  return { state: { ...state, crashGroups }, error: '' };
}

export function crashDraft(group) {
  if (!group) return '';
  return (
    'Сбой OMP ' + (group.title || group.id) +
    '\n\nГруппа: ' + group.id +
    '\nСтатус: ' + group.status +
    '\nРаз: ' + group.count +
    '\nУстройства: ' + (group.devices || []).length +
    '\nВерсии: ' + (group.versions || []).join(', ') +
    (group.regression ? '\nРегрессия: да' : '') +
    '\n\nЧто случилось:\n'
  );
}

export function crashLogText(report) {
  if (!report) return '';
  return [report.message, report.stack, report.crumbs, report.logs].filter(Boolean).join('\n\n');
}

export function versionSummary(versions) {
  const map = new Map();
  const rows = versions || {};
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i++) {
    const v = rows[keys[i]];
    const key = (v.platform || '?') + ' ' + (v.version || '?');
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

export function betaCohort(deviceId, percent) {
  const pct = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)));
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  const n = parseInt(createHash('sha256').update(String(deviceId || '')).digest('hex').slice(0, 8), 16);
  return n % 100 < pct;
}

export function broadcastAudience(state, segment, now) {
  const accounts = state.accounts || [];
  const subs = state.subscriptions || [];
  const active = new Set(subs.filter((s) => s.paidUntil > now).map((s) => s.accountId));
  const out = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    if (!a.telegramId) continue;
    if (segment === 'active' && !active.has(a.id)) continue;
    if (segment === 'lapsed' && active.has(a.id)) continue;
    out.push(String(a.telegramId));
  }
  return out;
}

export function loginNote(state, row) {
  const loginJournal = (state.loginJournal || []).concat([row]).slice(-200);
  return { ...state, loginJournal };
}
