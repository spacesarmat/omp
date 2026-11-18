// Pure helpers for scripts/billing-watchdog.mjs (the external check in .github/workflows/billing-watchdog.yml).
// Three public URLs, from GitHub-hosted runners (outside the home network). State is a GitHub issue
// labeled "outage": the Actions cache is evicted by CI caches, so it cannot dedupe alerts.

/** No successful bot poll for this long: the bot (and with it «Мониторинг») is stuck. */
export const BOT_POLL_MAX_AGE_SEC = 600;

/** Three tries, 20s apart, so a short blip does not page. */
export const WATCHDOG_ATTEMPTS = 3;
export const WATCHDOG_GAP_MS = 20_000;

/** Fixed production URLs. Billing `/` has no page (404 means the process answered). */
export const PUBLIC_ENDPOINTS = [
  { id: 'billing', url: 'https://billing.omp-player.online', kind: 'http', label: 'billing.omp-player.online' },
  { id: 'health', url: 'https://billing.omp-player.online/health', kind: 'health', label: 'billing.omp-player.online/health' },
  { id: 'site', url: 'https://omp-player.online', kind: 'http', label: 'omp-player.online' },
];

export const ISSUE_TITLE = 'OMP: внешняя проверка - простой';
export const ISSUE_LABEL = 'outage';

/** The monitor is late when its last scheduled run is older than two intervals, and at least 30 minutes. */
export function monitorMaxAgeSec(intervalMin) {
  const every = Number(intervalMin) > 0 ? Number(intervalMin) * 60 : 15 * 60;
  return Math.max(2 * every, 30 * 60);
}

/**
 * Verdict for one /health answer. `res`: { status, body } (body parsed JSON or null) or { error } when the
 * request failed. Returns { ok, reason } with a short Russian reason when not ok. Fields an older billing does
 * not send are not checked.
 */
export function evaluateHealth(res) {
  if (!res || res.error) return { ok: false, reason: 'billing не отвечает (' + String((res && res.error) || 'нет ответа') + ')' };
  if (res.status !== 200) return { ok: false, reason: '/health ответил HTTP ' + res.status };
  const b = res.body;
  if (!b || typeof b !== 'object' || b.ok !== true) return { ok: false, reason: '/health без ok: true' };
  const problems = [];
  if (b.readOnly === true) problems.push('billing в режиме только чтения');
  if (b.botPollEnabled === true) {
    const age = b.botPollOkAgoSec;
    if (age === null || age === undefined) problems.push('бот ещё ни разу не получил обновления от Telegram');
    else if (Number(age) > BOT_POLL_MAX_AGE_SEC) problems.push('бот не получал обновления ' + minutes(age));
  }
  if (b.monitorScheduled === true) {
    const max = monitorMaxAgeSec(b.monitorIntervalMin);
    if (b.monitorAgoSec !== null && b.monitorAgoSec !== undefined) {
      if (Number(b.monitorAgoSec) > max) problems.push('«Мониторинг» не запускался ' + minutes(b.monitorAgoSec));
    } else if (b.monitorScheduledAgoSec !== null && b.monitorScheduledAgoSec !== undefined && Number(b.monitorScheduledAgoSec) > max) {
      // no finished run yet, though the schedule has been on for longer than a run may take
      problems.push('«Мониторинг» ни разу не завершил прогон за ' + minutes(b.monitorScheduledAgoSec));
    }
  }
  return problems.length ? { ok: false, reason: problems.join('; ') } : { ok: true, reason: '' };
}

function minutes(sec) {
  return Math.round(Number(sec) / 60) + ' мин';
}

/**
 * Plain HTTP check. 5xx (including Cloudflare 530) and a failed request (timeout, DNS, reset) are down.
 * 2xx, 3xx and 4xx are up: billing `/` is 404 by design, and that still means the origin answered.
 */
export function evaluateHttp(res) {
  if (!res || res.error || typeof res.status !== 'number') {
    return { ok: false, reason: 'нет ответа (' + String((res && res.error) || 'нет ответа') + ')' };
  }
  if (res.status >= 500) return { ok: false, reason: 'HTTP ' + res.status };
  return { ok: true, reason: '' };
}

export function verdictFor(endpoint, res) {
  return endpoint.kind === 'health' ? evaluateHealth(res) : evaluateHttp(res);
}

/** Retry timeouts, network errors, 5xx, and a /health body that is not ok:true. A stuck bot is not a blip. */
export function shouldRetry(endpoint, res) {
  if (!res || res.error || typeof res.status !== 'number') return true;
  if (res.status >= 500) return true;
  if (endpoint.kind === 'health' && res.status === 200) {
    const b = res.body;
    if (!b || typeof b !== 'object' || b.ok !== true) return true;
  }
  return false;
}

const ALERT_FOOTER = 'Внешняя проверка из GitHub Actions, не зависит от NUC. Следующее сообщение придёт, когда состояние изменится.';

/** Previous per-check map. A legacy single verdict ({ ok, since, reason }) is the /health check. */
function priorChecks(prev) {
  if (!prev || typeof prev !== 'object') return null;
  if (prev.checks && typeof prev.checks === 'object') return prev.checks;
  if (typeof prev.ok === 'boolean') {
    return { health: { ok: prev.ok, since: prev.since || 0, reason: prev.reason || '' } };
  }
  return null;
}

/**
 * What to send for every check. Only a change is told: ok -> fail once, fail -> ok once.
 * The first run after the state was lost tells a failure but not a plain ok.
 * Returns { text, next } where next is { checks: { id: { ok, since, reason } } }.
 */
export function transitionChecks(prev, verdicts, now) {
  const prior = priorChecks(prev);
  const at = now || Date.now();
  const down = [];
  const up = [];
  const freshDown = new Set();
  const checks = {};
  for (const v of verdicts) {
    const p = prior && prior[v.id];
    const had = !!(p && typeof p.ok === 'boolean');
    if (v.ok) {
      if (had && p.ok === false) up.push('✅ ' + v.label + ' снова в порядке (было: ' + (p.reason || 'сбой') + ')');
      checks[v.id] = { ok: true, since: had && p.ok ? p.since : at, reason: '' };
    } else if (had && p.ok === false) {
      checks[v.id] = { ok: false, since: p.since, reason: v.reason };
    } else {
      down.push('🔴 ' + v.label + ': ' + v.reason);
      freshDown.add(v.id);
      checks[v.id] = { ok: false, since: at, reason: v.reason };
    }
  }
  const lines = down.concat(up);
  if (lines.length) {
    const still = verdicts.filter((v) => !v.ok && !freshDown.has(v.id));
    if (still.length) lines.push('Ещё не в порядке: ' + still.map((v) => v.label).join(', '));
    lines.push(ALERT_FOOTER);
  }
  return { text: lines.join('\n'), next: { checks } };
}

/** Single /health verdict, same shape as before ({ text, next: { ok, since, reason } }). */
export function transition(prev, verdict, now) {
  const plan = transitionChecks(
    prev,
    [{ id: 'health', label: 'billing.omp-player.online', ok: verdict.ok, reason: verdict.reason }],
    now,
  );
  return { text: plan.text, next: plan.next.checks.health };
}

export function summaryFor(state) {
  const checks = state && state.checks;
  const lines = [];
  for (const ep of PUBLIC_ENDPOINTS) {
    const c = checks && checks[ep.id];
    if (c && c.ok === false) lines.push('- ' + ep.label + ': ' + c.reason);
  }
  return lines.length ? 'Не отвечают:\n' + lines.join('\n') : 'Все проверки в порядке.';
}

export function encodeIssueBody(state) {
  return summaryFor(state) + '\n\n```omp-uptime-state\n' + JSON.stringify(state) + '\n```\n';
}

export function decodeIssueBody(body) {
  const m = /```omp-uptime-state\n([\s\S]*?)\n```/.exec(String(body || ''));
  if (!m) return null;
  try {
    const state = JSON.parse(m[1]);
    if (!state || typeof state !== 'object' || !state.checks || typeof state.checks !== 'object') return null;
    return state;
  } catch {
    return null;
  }
}

/** What to do with the open outage issue after a run. `openIssue` is { number, body } or null. */
export function issueAction(openIssue, nextState) {
  const checks = (nextState && nextState.checks) || {};
  const values = Object.values(checks);
  const allOk = values.length > 0 && values.every((c) => c && c.ok === true);
  if (allOk) return openIssue ? { action: 'close', number: openIssue.number } : { action: 'noop' };
  const body = encodeIssueBody(nextState);
  if (!openIssue) return { action: 'create', title: ISSUE_TITLE, body };
  const prev = decodeIssueBody(openIssue.body);
  if (prev && JSON.stringify(prev) === JSON.stringify(nextState)) return { action: 'noop' };
  return { action: 'update', number: openIssue.number, body };
}

function stateFor(prior, endpoints, asOk) {
  const checks = {};
  for (const ep of endpoints) {
    const p = prior && prior[ep.id];
    if (!asOk && p && typeof p.ok === 'boolean') checks[ep.id] = { ok: p.ok, since: p.since || 0, reason: p.reason || '' };
    else checks[ep.id] = { ok: true, since: 0, reason: '' };
  }
  return { checks };
}

/**
 * One run. deps: { probe(url) -> res, send(text) -> boolean, readState() -> state|null, writeState(state),
 * sleep(ms), log(line), now(), endpoints? }. Failed retriable checks are tried again, up to `attempts`,
 * `gapMs` apart. Others are probed once. Returns 1 only when something is down and Telegram was not told.
 * A message that was not sent keeps the old state, so the next run tries again.
 */
export async function runWatchdog(deps, attempts = WATCHDOG_ATTEMPTS, gapMs = WATCHDOG_GAP_MS) {
  const endpoints = deps.endpoints || PUBLIC_ENDPOINTS;
  const results = new Map();
  let pending = endpoints.slice();
  for (let i = 0; i < attempts && pending.length; i++) {
    if (i) await deps.sleep(gapMs);
    const probed = await Promise.all(
      pending.map(async (ep) => {
        const res = await deps.probe(ep.url);
        return { ep, res, verdict: verdictFor(ep, res) };
      }),
    );
    const again = [];
    for (const row of probed) {
      results.set(row.ep.id, row);
      if (!row.verdict.ok) {
        deps.log('attempt ' + (i + 1) + ' ' + row.ep.id + ': ' + row.verdict.reason);
        if (i + 1 < attempts && shouldRetry(row.ep, row.res)) again.push(row.ep);
      }
    }
    pending = again;
  }
  const verdicts = endpoints.map((ep) => {
    const row = results.get(ep.id);
    const verdict = row ? row.verdict : { ok: false, reason: 'нет ответа (нет проверки)' };
    return { id: ep.id, label: ep.label, ok: verdict.ok, reason: verdict.reason };
  });
  const prev = await deps.readState();
  const plan = transitionChecks(prev, verdicts, deps.now());
  let next = plan.next;
  let unsent = false;
  if (plan.text) {
    unsent = !(await deps.send(plan.text));
    if (unsent) next = stateFor(priorChecks(prev), endpoints, !prev);
  }
  await deps.writeState(next);
  const bad = verdicts.filter((v) => !v.ok);
  deps.log(bad.length ? 'problem: ' + bad.map((v) => v.id + ' ' + v.reason).join('; ') : 'public endpoints ok');
  return unsent && bad.length ? 1 : 0;
}
