/**
 * «Мониторинг»: scheduled health checks (monitorChecks.mjs), 7 days of history in Postgres and Telegram alerts.
 *
 * - Interval: kv monitor_config.intervalMin (5-1440 minutes, default 15), editable in the tab, applied on the
 *   next minute tick without a restart.
 * - Before an alert, the failed checks run once more after 30 s; only a check still failing is reported.
 * - One message when a problem starts (no repeats while it lasts) and one «починилось» when it is over:
 *   kv monitor_alerts holds the checks already reported. A failed send is retried on the next run.
 * - Alerts go to BILLING_MONITOR_CHAT_ID (default 536445442) with the billing bot, sendMessage only.
 * - The scheduler runs only on the instance that polls the bot and is not read-only, so a standby copy
 *   never doubles an alert. «Проверить сейчас» runs on any writable instance.
 */
import { GROUPS, buildTasks, finalize, runTasks } from './monitorChecks.mjs';

export const MONITOR_DEFAULTS = { intervalMin: 15 };
export const MONITOR_RETRY_MS = 30 * 1000;
export const MONITOR_KEEP_DAYS = 7;
export const MONITOR_CHAT_DEFAULT = '536445442';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MAX_MESSAGE = 3800;

/** Whole minutes 5-1440, or null. */
export function validInterval(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= 5 && n <= 1440 ? n : null;
}

/** BILLING_MONITOR: on unless 0 / false / off / no. */
export function monitorEnabled(env) {
  const raw = String(((env || process.env).BILLING_MONITOR) ?? '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/** Chat for alerts: BILLING_MONITOR_CHAT_ID (a numeric id) or Andy's chat. */
export function monitorChatId(env) {
  const raw = String(((env || process.env).BILLING_MONITOR_CHAT_ID) || '').trim();
  return /^-?\d{1,20}$/.test(raw) ? raw : MONITOR_CHAT_DEFAULT;
}

async function kvGet(store, key, fallback) {
  const r = await store.query('SELECT value FROM kv WHERE key = $1', [key]);
  if (!r.rows[0]) return fallback;
  try {
    return JSON.parse(r.rows[0].value);
  } catch (e) {
    return fallback;
  }
}

async function kvSet(store, key, value) {
  await store.query('INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
}

export async function readMonitorConfig(store) {
  const c = await kvGet(store, 'monitor_config', {});
  return { intervalMin: validInterval(c && c.intervalMin) || MONITOR_DEFAULTS.intervalMin };
}

export async function saveMonitorConfig(store, body) {
  const n = validInterval(body && body.intervalMin);
  if (!n) return { ok: false, error: 'Интервал: целое число минут от 5 до 1440' };
  await kvSet(store, 'monitor_config', { intervalMin: n });
  return { ok: true, intervalMin: n };
}

function label(row) {
  const pre = row.group === 'jackett' ? 'Jackett: ' : row.group === 'jacred' && row.pair ? 'JacRed: ' : '';
  return pre + row.name + pathSuffix(row);
}

function pathSuffix(row) {
  if (row.path === 'jackett') return ' (поиск через Jackett)';
  if (row.pairAlert) return ' (сайт не открывается ни напрямую, ни через WARP)';
  return '';
}

/**
 * What to tell after a run. `alerted`: { [checkId]: { since, text } } already reported.
 * Returns { problems: rows newly failing, recovered: [{ id, text, gone }], next: the new alerted map
 * assuming every message goes out }.
 */
export function alertPlan(alerted, rows, now) {
  const prev = alerted || {};
  const next = {};
  const problems = [];
  const recovered = [];
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.id);
    const was = prev[r.id];
    if (r.alert && r.ok === false) {
      if (was) next[r.id] = was;
      else {
        problems.push(r);
        next[r.id] = { since: now, text: label(r) };
      }
    } else if (was) {
      // ok again, or no longer alert-worthy (a pair whose direct path came back)
      if (r.ok === false && !r.alert && r.pairAlert) recovered.push({ id: r.id, text: was.text, partial: true });
      else if (r.ok === false) next[r.id] = was;
      else recovered.push({ id: r.id, text: was.text });
    }
  }
  for (const id of Object.keys(prev)) {
    if (!seen.has(id)) recovered.push({ id, text: prev[id].text, gone: true });
  }
  return { problems, recovered, next };
}

function clip(lines, head) {
  let out = head;
  let n = 0;
  for (const line of lines) {
    if (out.length + line.length + 1 > MAX_MESSAGE) break;
    out += '\n' + line;
    n += 1;
  }
  if (n < lines.length) out += '\n… и ещё ' + (lines.length - n);
  return out;
}

export function problemText(problems) {
  return clip(
    problems.map((r) => '• ' + label(r) + ': ' + (r.detail || 'ошибка') + (r.context ? ' (' + r.context + ')' : '')),
    '⚠️ Мониторинг OMP: проблема (проверено дважды, с паузой 30 с)',
  );
}

export function recoveredText(recovered) {
  return clip(
    recovered.map((r) => '• ' + r.text + (r.gone ? ': больше не проверяется' : r.partial ? ': сайт снова открывается напрямую' : '')),
    '✅ Мониторинг OMP: починилось',
  );
}

/** Seven days as 168 hourly cells per check: 'g' all ok, 'r' a failure in that hour, '-' no data. */
export function historyStrip(points, now) {
  const end = Math.floor(now / HOUR);
  const start = end - 7 * 24 + 1;
  const cells = new Array(7 * 24).fill('-');
  for (const p of points) {
    const i = Number(p.h) - start;
    if (i < 0 || i >= cells.length) continue;
    cells[i] = p.allOk ? 'g' : 'r';
  }
  return cells.join('');
}

/**
 * The monitor of one process. deps: { store, env, backups, getSettings, send(chatId, text) => Promise<boolean>,
 * net, get, statfs, now, sleep, botPoll, log }.
 */
export function createMonitor(deps) {
  const d = deps || {};
  const store = d.store;
  const env = d.env || process.env;
  const now = d.now || (() => Date.now());
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = d.log || ((s) => process.stderr.write(s + '\n'));
  let running = null;
  let runningSince = 0;
  let lastRunAt = 0;
  let timers = [];

  async function check(tasks) {
    return finalize(await runTasks(tasks, 8, 3));
  }

  async function run(trigger) {
    if (running) return running;
    runningSince = now();
    running = (async () => {
      const startedAt = now();
      const settings = (await d.getSettings()) || {};
      const restarts = await kvGet(store, 'monitor_restarts', {});
      const ctx = { settings, env, store, backups: d.backups, net: d.net, get: d.get, statfs: d.statfs, now, botPoll: d.botPoll, restarts };
      const tasks = await buildTasks(ctx);
      let rows = await check(tasks);
      const alerted = await kvGet(store, 'monitor_alerts', {});
      // One retry after 30 s for every failed check, when one of them would be a new alert.
      const fresh = rows.some((r) => r.alert && r.ok === false && !alerted[r.id]);
      if (fresh) {
        await sleep(MONITOR_RETRY_MS);
        const failedIds = new Set(rows.filter((r) => r.ok === false).map((r) => r.id));
        const again = await check(tasks.filter((t) => failedIds.has(t.id)).map((t) => ({ ...t, retried: true })));
        const byId = new Map(again.map((r) => [r.id, r]));
        rows = finalize(rows.map((r) => (byId.has(r.id) ? { ...byId.get(r.id), retried: true } : r)));
      }
      const finishedAt = now();
      await saveRun(startedAt, finishedAt, trigger, rows);
      // RestartCount per container, for the next run's «перезапускался».
      const counts = { ...restarts };
      for (const r of rows) if (r.group === 'containers' && r.restarts !== undefined) counts[r.name] = r.restarts;
      await kvSet(store, 'monitor_restarts', counts);
      await notify(alerted, rows, finishedAt);
      lastRunAt = finishedAt;
      return { startedAt, finishedAt, rows };
    })()
      .catch((e) => {
        log('monitor run failed: ' + String((e && e.code) || (e && e.name) || 'error'));
        return null;
      })
      .finally(() => {
        running = null;
        runningSince = 0;
      });
    return running;
  }

  async function saveRun(startedAt, finishedAt, trigger, rows) {
    const failed = rows.filter((r) => r.ok === false).length;
    const slim = rows.map((r) => ({
      id: r.id,
      group: r.group,
      name: r.name,
      path: r.path || '',
      target: r.target || '',
      ok: r.ok,
      detail: r.detail,
      context: r.context || '',
      ms: r.ms,
      alert: !!r.alert,
      retried: !!r.retried,
    }));
    await store.query('INSERT INTO monitor_runs (run_at, finished_at, trigger, total, failed, rows) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (run_at) DO NOTHING', [
      startedAt,
      finishedAt,
      String(trigger || 'schedule'),
      rows.length,
      failed,
      JSON.stringify(slim),
    ]);
    const judged = rows.filter((r) => r.ok !== null);
    if (judged.length) {
      const values = [];
      const params = [startedAt];
      judged.forEach((r, i) => {
        params.push(r.id, r.ok);
        values.push('($1, $' + (2 + i * 2) + ', $' + (3 + i * 2) + ')');
      });
      await store.query('INSERT INTO monitor_results (run_at, check_id, ok) VALUES ' + values.join(', '), params);
    }
    const cut = finishedAt - MONITOR_KEEP_DAYS * DAY;
    await store.query('DELETE FROM monitor_results WHERE run_at < $1', [cut]);
    await store.query('DELETE FROM monitor_runs WHERE run_at < $1', [cut]);
  }

  async function notify(alerted, rows, at) {
    const plan = alertPlan(alerted, rows, at);
    const next = { ...plan.next };
    const chat = monitorChatId(env);
    if (plan.problems.length) {
      const sent = await safeSend(chat, problemText(plan.problems));
      // Not sent: forget them, so the next run reports them again.
      if (!sent) for (const r of plan.problems) delete next[r.id];
    }
    if (plan.recovered.length) {
      const sent = await safeSend(chat, recoveredText(plan.recovered));
      if (!sent) for (const r of plan.recovered) if (alerted[r.id]) next[r.id] = alerted[r.id];
    }
    await kvSet(store, 'monitor_alerts', next);
  }

  async function safeSend(chat, text) {
    if (!d.send) return false;
    try {
      return !!(await d.send(chat, text));
    } catch (e) {
      log('monitor alert not sent: ' + String((e && e.name) || 'error'));
      return false;
    }
  }

  /** Payload for GET /admin/api/monitor. */
  async function snapshot() {
    const at = now();
    const cfg = await readMonitorConfig(store);
    const last = (await store.query('SELECT run_at, finished_at, trigger, total, failed, rows FROM monitor_runs ORDER BY run_at DESC LIMIT 1')).rows[0] || null;
    const hist = await store.query(
      'SELECT check_id, floor(run_at / 3600000)::bigint AS h, bool_and(ok) AS all_ok, count(*)::int AS n, sum(CASE WHEN ok THEN 1 ELSE 0 END)::int AS good FROM monitor_results WHERE run_at >= $1 GROUP BY check_id, h',
      [at - MONITOR_KEEP_DAYS * DAY],
    );
    const byCheck = new Map();
    for (const p of hist.rows) {
      const list = byCheck.get(p.check_id) || [];
      list.push({ h: Number(p.h), allOk: !!p.all_ok, n: Number(p.n), good: Number(p.good) });
      byCheck.set(p.check_id, list);
    }
    const rows = last ? (typeof last.rows === 'string' ? JSON.parse(last.rows) : last.rows) : [];
    const alerted = await kvGet(store, 'monitor_alerts', {});
    return {
      ok: true,
      intervalMin: cfg.intervalMin,
      scheduled: !!d.scheduled,
      running: !!running,
      runningSince,
      groups: GROUPS.map(([id, title]) => ({ id, title })),
      lastRun: last ? { at: Number(last.run_at), finishedAt: Number(last.finished_at), trigger: last.trigger, total: last.total, failed: last.failed } : null,
      nextRunAt: d.scheduled && last ? Number(last.finished_at) + cfg.intervalMin * 60 * 1000 : 0,
      chat: monitorChatId(env),
      checks: rows.map((r) => {
        const pts = byCheck.get(r.id) || [];
        const n = pts.reduce((a, p) => a + p.n, 0);
        const good = pts.reduce((a, p) => a + p.good, 0);
        return { ...r, alerted: !!alerted[r.id], history: historyStrip(pts, at), uptime: n ? Math.round((good / n) * 1000) / 10 : null };
      }),
    };
  }

  /** Minute ticks; a run starts when the interval has passed since the last one. */
  function start(opts) {
    const o = opts || {};
    d.scheduled = true;
    const tick = async () => {
      try {
        if (running) return;
        const cfg = await readMonitorConfig(store);
        if (!lastRunAt) {
          const r = (await store.query('SELECT max(finished_at) AS at FROM monitor_runs')).rows[0];
          lastRunAt = Number(r && r.at) || 0;
        }
        if (now() - lastRunAt >= cfg.intervalMin * 60 * 1000) await run('schedule');
      } catch (e) {
        log('monitor tick failed');
      }
    };
    const first = setTimeout(() => void tick(), o.firstMs ?? 60 * 1000);
    const every = setInterval(() => void tick(), o.everyMs ?? 60 * 1000);
    if (first.unref) first.unref();
    if (every.unref) every.unref();
    timers = [first, every];
    return () => {
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      d.scheduled = false;
    };
  }

  return { run, snapshot, start, isRunning: () => !!running };
}
