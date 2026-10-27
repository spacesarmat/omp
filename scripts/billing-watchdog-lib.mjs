// Pure helpers for scripts/billing-watchdog.mjs (the external watchdog in .github/workflows/billing-watchdog.yml).

/** No successful bot poll for this long: the bot (and with it «Мониторинг») is stuck. */
export const BOT_POLL_MAX_AGE_SEC = 600;

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
 * What to send, given the previous state ({ ok, since, reason } or null on the first run) and the verdict.
 * Only a change is told: ok -> fail once, fail -> ok once. The first run after the state was lost tells a failure
 * but not a plain ok. Returns { text, next }.
 */
export function transition(prev, verdict, now) {
  const at = now || Date.now();
  if (verdict.ok) {
    if (prev && prev.ok === false) {
      return { text: '✅ billing.omp-player.online снова в порядке (внешняя проверка, было: ' + prev.reason + ')', next: { ok: true, since: at, reason: '' } };
    }
    return { text: '', next: { ok: true, since: prev && prev.ok ? prev.since : at, reason: '' } };
  }
  if (prev && prev.ok === false) return { text: '', next: { ok: false, since: prev.since, reason: verdict.reason } };
  return {
    text: '🔴 billing.omp-player.online: ' + verdict.reason + '\nВнешняя проверка из GitHub Actions, не зависит от NUC и ПК. Следующее сообщение придёт, когда починится.',
    next: { ok: false, since: at, reason: verdict.reason },
  };
}

/**
 * One watchdog run. deps: { probe() -> res, send(text) -> boolean, readState() -> state|null, writeState(state),
 * sleep(ms), log(line), now() }. Up to `attempts` probes, `gapMs` apart, until one is ok. Returns the exit code:
 * 1 only when there is a problem and Telegram could not be told, so a down billing does not fail every run.
 * A message that was not sent keeps the old state, so the next run tries again.
 */
export async function runWatchdog(deps, attempts = 3, gapMs = 30_000) {
  let verdict = { ok: false, reason: '' };
  for (let i = 0; i < attempts; i++) {
    if (i) await deps.sleep(gapMs);
    verdict = evaluateHealth(await deps.probe());
    if (verdict.ok) break;
    deps.log('attempt ' + (i + 1) + ': ' + verdict.reason);
  }
  const prev = deps.readState();
  const plan = transition(prev, verdict, deps.now());
  let next = plan.next;
  let unsent = false;
  if (plan.text) {
    unsent = !(await deps.send(plan.text));
    // no state yet: as if it was fine, so the failure is told again
    if (unsent) next = prev || { ok: true, since: 0, reason: '' };
  }
  deps.writeState(next);
  deps.log(verdict.ok ? 'billing ok' : 'billing problem: ' + verdict.reason);
  return unsent && !verdict.ok ? 1 : 0;
}
