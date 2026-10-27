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
  if (b.monitorScheduled === true && b.monitorAgoSec !== null && b.monitorAgoSec !== undefined) {
    if (Number(b.monitorAgoSec) > monitorMaxAgeSec(b.monitorIntervalMin)) problems.push('«Мониторинг» не запускался ' + minutes(b.monitorAgoSec));
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
