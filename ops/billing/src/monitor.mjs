/**
 * «Мониторинг»: scheduled health checks (monitorChecks.mjs), 7 days of history in Postgres and Telegram alerts.
 *
 * - Interval: kv monitor_config.intervalMin (5-1440 minutes, default 15), editable in the tab, applied on the
 *   next minute tick without a restart.
 * - Before an alert, the failed checks run once more after 30 s; only a check still failing is reported.
 * - One message when a problem starts (no repeats while it lasts) and one «починилось» when it is over
 *   (a tracker site that now only asks for a code, yellow, closes its alert with a «просит код» line):
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
  // A list that could not be read: the rows it would have made were not checked, so they keep their state.
  const unread = rows.filter((r) => r.scope).map((r) => r.scope);
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
      if (r.ok === false && !r.alert && r.pairAlert) {
        const direct = rows.find((x) => x.id === r.pair + ':direct');
        recovered.push({ id: r.id, text: was.text, partial: true, ...(direct && direct.warn ? { code: true } : {}) });
      }
      else if (r.ok === false) next[r.id] = was;
      else recovered.push(r.ok === true && r.warn ? { id: r.id, text: was.text, code: true } : { id: r.id, text: was.text });
    }
  }
  for (const id of Object.keys(prev)) {
    if (seen.has(id)) continue;
    if (unread.some((p) => id.startsWith(p))) next[id] = prev[id];
    else recovered.push({ id, text: prev[id].text, gone: true });
  }
  return { problems, recovered, next };
}

/**
 * Split lines into Telegram-sized messages, each starting with `head`. Returns [{ text, items: [line indexes] }],
 * so the caller can mark as told only the lines of messages that went out.
 */
export function splitMessages(lines, head) {
  const out = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const line = raw.length > MAX_MESSAGE - head.length - 1 ? raw.slice(0, MAX_MESSAGE - head.length - 2) + '…' : raw;
    if (!cur || cur.text.length + line.length + 1 > MAX_MESSAGE) {
      cur = { text: head, items: [] };
      out.push(cur);
    }
    cur.text += '\n' + line;
    cur.items.push(i);
  });
  if (out.length > 1) out.forEach((m, n) => (m.text = m.text.replace(head, head + ' (' + (n + 1) + '/' + out.length + ')')));
  return out;
}

const PROBLEM_HEAD = '⚠️ Мониторинг OMP: проблема (проверено дважды, с паузой 30 с)';
const RECOVERED_HEAD = '✅ Мониторинг OMP: починилось';

function problemLines(problems) {
  return problems.map((r) => '• ' + label(r) + ': ' + (r.detail || 'ошибка') + (r.context ? ' (' + r.context + ')' : ''));
}

function recoveredLines(recovered) {
  return recovered.map(
    (r) => '• ' + r.text + (r.gone ? ': больше не проверяется' : r.partial ? (r.code ? ': напрямую сайт отвечает, но просит код (жёлтый статус, без алерта)' : ': сайт снова открывается напрямую') : r.code ? ': сайт отвечает, но просит код (жёлтый статус, без алерта)' : ''),
  );
}

export function problemMessages(problems) {
  return splitMessages(problemLines(problems), PROBLEM_HEAD);
}

export function recoveredMessages(recovered) {
  return splitMessages(recoveredLines(recovered), RECOVERED_HEAD);
}

/** One message (the first part when it needs several). */
export function problemText(problems) {
  return problemMessages(problems).map((m) => m.text)[0] || PROBLEM_HEAD;
}

export function recoveredText(recovered) {
  return recoveredMessages(recovered).map((m) => m.text)[0] || RECOVERED_HEAD;
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
/** Detail of a check added since the last run and not run yet (kept by a row recheck). */
const UNCHECKED = 'ещё не проверялась';
/** Rows that stand for a whole list while it cannot be read (monitorChecks listFailed). */
const LIST_IDS = new Set(['containers', 'jackett:list', 'jacred:list']);

export function createMonitor(deps) {
  const d = deps || {};
  const store = d.store;
  const env = d.env || process.env;
  const now = d.now || (() => Date.now());
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = d.log || ((s) => process.stderr.write(s + '\n'));
  let running = null;
  let runningSince = 0;
  // While a run goes: { trigger, startedAt, total, done, states: { id: 'queued' | 'running' | 'retry' | 'done' } }.
  let progress = null;
  // The last finished run, for the «готово» line: { trigger, startedAt, finishedAt, checked, failed, retried, ids }.
  let lastSummary = null;
  let lastRunAt = 0;
  let timers = [];
  // Last values read from Postgres, so a Postgres outage is still checked and reported.
  // `unsaved`: keys whose last write failed; memory is newer than Postgres until it is written.
  const mem = { settings: null, config: { ...MONITOR_DEFAULTS }, kv: {}, unsaved: new Set(), lastRows: null };

  async function settingsNow() {
    try {
      const s = (await d.getSettings()) || {};
      mem.settings = s;
      return s;
    } catch (e) {
      return mem.settings || {};
    }
  }

  async function kvNow(key, fallback) {
    if (mem.unsaved.has(key)) {
      try {
        await kvSet(store, key, mem.kv[key]);
        mem.unsaved.delete(key);
      } catch (e) {
        /* still down */
      }
      return mem.kv[key];
    }
    try {
      const v = await kvGet(store, key, fallback);
      mem.kv[key] = v;
      return v;
    } catch (e) {
      return mem.kv[key] !== undefined ? mem.kv[key] : fallback;
    }
  }

  async function kvKeep(key, value) {
    mem.kv[key] = value;
    try {
      await kvSet(store, key, value);
      mem.unsaved.delete(key);
    } catch (e) {
      mem.unsaved.add(key);
      log('monitor state not saved: ' + key);
    }
  }

  async function configNow() {
    try {
      mem.config = await readMonitorConfig(store);
    } catch (e) {
      /* Postgres down: the last interval read */
    }
    return mem.config;
  }

  const hooks = {
    onStart(id) {
      if (progress) progress.states[id] = 'running';
    },
    onDone(row) {
      if (!progress) return;
      progress.states[row.id] = 'done';
      progress.done += 1;
    },
  };

  async function check(tasks) {
    return finalize(await runTasks(tasks, 8, 3, now, hooks));
  }

  /**
   * Rows of the last run (for «Перепроверить все ошибки»), or null. The run this process made last wins, saved or
   * not (a run during a Postgres outage is newer than anything in monitor_runs); after a restart, the last saved run.
   */
  async function lastRows() {
    if (mem.lastRows) return mem.lastRows;
    try {
      const last = (await store.query('SELECT rows FROM monitor_runs ORDER BY run_at DESC LIMIT 1')).rows[0];
      if (!last) return mem.lastRows || null;
      return typeof last.rows === 'string' ? JSON.parse(last.rows) : last.rows;
    } catch (e) {
      return mem.lastRows || null;
    }
  }

  /**
   * trigger: 'schedule' | 'manual' | 'recheck'. opts.only === 'failed': run again only the checks that were red in
   * the last run (and new ones); the others keep their last result. opts.ids: run only these checks («Перепроверить»
   * on a row), same handling (retry, alerts, history of the ones that ran). Without a last run it is a full run.
   */
  async function run(trigger, opts) {
    if (running) return running;
    runningSince = now();
    running = (async () => {
      const startedAt = now();
      const settings = await settingsNow();
      const restarts = await kvNow('monitor_restarts', {});
      const ctx = { settings, env, store, backups: d.backups, net: d.net, get: d.get, statfs: d.statfs, now, botPoll: d.botPoll, restarts };
      const tasks = await buildTasks(ctx);
      const ids = opts && Array.isArray(opts.ids) ? new Set(opts.ids.map(String)) : null;
      const prev = (opts && opts.only === 'failed') || ids ? await lastRows() : null;
      // A row recheck needs a last run to keep the other rows from; without one it starts nothing.
      if (ids && !prev) return null;
      let toRun = tasks;
      let kept = [];
      if (prev) {
        const before = new Map(prev.map((r) => [r.id, r]));
        const unchecked = (b) => b.ok === null && b.detail === UNCHECKED;
        if (ids) {
          // A saved id that is no longer a task (a red container or tracker list that loads again and is now
          // one row per item): recheck that whole group, so the list row is replaced.
          const taskIds = new Set(tasks.map((t) => t.id));
          const groups = new Set([...ids].filter((id) => LIST_IDS.has(id) && !taskIds.has(id) && before.has(id)).map((id) => before.get(id).group));
          toRun = tasks.filter((t) => (ids.has(t.id) && before.has(t.id)) || groups.has(t.group));
        } else {
          toRun = tasks.filter((t) => !before.has(t.id) || before.get(t.id).ok === false || unchecked(before.get(t.id)));
        }
        if (ids && !toRun.length) return null; // unknown or new checks: nothing to recheck
        kept = tasks
          .filter((t) => !toRun.includes(t))
          .map((t) => {
            const { run: _run, ...meta } = t;
            const b = before.get(t.id);
            // A check added since the last run that is not in this recheck: shown as not checked yet, and the
            // next «Перепроверить все ошибки» runs it.
            if (!b) return { ...meta, ok: null, detail: UNCHECKED, ms: 0, at: 0, retried: false };
            return { ...meta, ok: b.ok, ...(b.ok === true && b.warn ? { warn: b.warn } : {}), detail: b.detail, ms: b.ms, at: b.at, retried: !!b.retried };
          });
      }
      const ran = new Set(toRun.map((t) => t.id));
      const order = new Map(tasks.map((t, i) => [t.id, i]));
      const merge = (fresh) => finalize([...kept, ...fresh].sort((a, b) => order.get(a.id) - order.get(b.id)));
      progress = { trigger: String(trigger || 'schedule'), startedAt, total: toRun.length, done: 0, states: Object.fromEntries(toRun.map((t) => [t.id, 'queued'])) };
      let rows = merge(await runTasks(toRun, 8, 3, now, hooks));
      let retriedCount = 0;
      const alerted = await kvNow('monitor_alerts', {});
      // One retry after 30 s for every failed check, when one of them would be a new alert.
      const fresh = rows.some((r) => ran.has(r.id) && r.alert && r.ok === false && !alerted[r.id]);
      if (fresh) {
        const failedIds = new Set(rows.filter((r) => ran.has(r.id) && r.ok === false).map((r) => r.id));
        retriedCount = failedIds.size;
        for (const id of failedIds) progress.states[id] = 'retry';
        progress.total += failedIds.size;
        await sleep(MONITOR_RETRY_MS);
        const again = await check(tasks.filter((t) => failedIds.has(t.id)).map((t) => ({ ...t, retried: true })));
        const byId = new Map(again.map((r) => [r.id, r]));
        rows = finalize(rows.map((r) => (byId.has(r.id) ? { ...byId.get(r.id), retried: true } : r)));
      }
      const finishedAt = now();
      // A recheck of the red ones does not move the next full run.
      if (!prev) lastRunAt = finishedAt;
      // Alerts first: with Postgres down the history cannot be saved, but the alert must still go out.
      await notify(alerted, rows, finishedAt, settings);
      // RestartCount per container, for the next run's «перезапускался».
      const counts = { ...restarts };
      for (const r of rows) if (r.group === 'containers' && r.restarts !== undefined) counts[r.name] = r.restarts;
      await kvKeep('monitor_restarts', counts);
      mem.lastRows = rows;
      try {
        await saveRun(startedAt, finishedAt, trigger, rows, ran);
      } catch (e) {
        log('monitor history not saved: ' + String((e && e.code) || (e && e.name) || 'error'));
      }
      lastSummary = {
        trigger: String(trigger || 'schedule'),
        startedAt,
        finishedAt,
        checked: ran.size,
        failed: rows.filter((r) => ran.has(r.id) && r.ok === false).length,
        retried: retriedCount,
        ids: ids ? [...ran] : null,
      };
      return { startedAt, finishedAt, rows };
    })()
      .catch((e) => {
        log('monitor run failed: ' + String((e && e.code) || (e && e.name) || 'error'));
        return null;
      })
      .finally(() => {
        running = null;
        runningSince = 0;
        progress = null;
      });
    return running;
  }

  async function saveRun(startedAt, finishedAt, trigger, rows, ran) {
    const failed = rows.filter((r) => r.ok === false).length;
    const slim = rows.map((r) => ({
      id: r.id,
      group: r.group,
      name: r.name,
      path: r.path || '',
      target: r.target || '',
      ok: r.ok,
      ...(r.ok === true && r.warn ? { warn: String(r.warn) } : {}),
      detail: r.detail,
      context: r.context || '',
      ms: r.ms,
      alert: !!r.alert,
      retried: !!r.retried,
      at: Number(r.at) || finishedAt,
    }));
    await store.query('INSERT INTO monitor_runs (run_at, finished_at, trigger, total, failed, rows) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (run_at) DO NOTHING', [
      startedAt,
      finishedAt,
      String(trigger || 'schedule'),
      rows.length,
      failed,
      JSON.stringify(slim),
    ]);
    // History: only the checks that ran now (a recheck keeps the others' last result without counting it twice).
    const judged = rows.filter((r) => r.ok !== null && (!ran || ran.has(r.id)));
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

  async function notify(alerted, rows, at, settings) {
    const plan = alertPlan(alerted, rows, at);
    const next = { ...plan.next };
    const chat = monitorChatId(env);
    // Long lists go in several messages; only the lines of a message that went out count as told.
    for (const m of problemMessages(plan.problems)) {
      const sent = await safeSend(chat, m.text, settings);
      // Not sent: forget them, so the next run reports them again.
      if (!sent) for (const i of m.items) delete next[plan.problems[i].id];
    }
    for (const m of recoveredMessages(plan.recovered)) {
      const sent = await safeSend(chat, m.text, settings);
      if (!sent) for (const i of m.items) next[plan.recovered[i].id] = alerted[plan.recovered[i].id];
    }
    await kvKeep('monitor_alerts', next);
  }

  async function safeSend(chat, text, settings) {
    if (!d.send) return false;
    try {
      return !!(await d.send(chat, text, settings));
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
    const full = (await store.query("SELECT max(finished_at) AS at FROM monitor_runs WHERE trigger <> 'recheck'")).rows[0];
    const fullAt = Number(full && full.at) || 0;
    return {
      ok: true,
      intervalMin: cfg.intervalMin,
      scheduled: !!d.scheduled,
      running: !!running,
      runningSince,
      progress: progress ? { ...progress, states: { ...progress.states } } : null,
      lastSummary,
      groups: GROUPS.map(([id, title]) => ({ id, title })),
      lastRun: last ? { at: Number(last.run_at), finishedAt: Number(last.finished_at), trigger: last.trigger, total: last.total, failed: last.failed } : null,
      nextRunAt: d.scheduled && fullAt ? fullAt + cfg.intervalMin * 60 * 1000 : 0,
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
        const cfg = await configNow();
        if (!lastRunAt) {
          try {
            const r = (await store.query("SELECT max(finished_at) AS at FROM monitor_runs WHERE trigger <> 'recheck'")).rows[0];
            lastRunAt = Number(r && r.at) || 0;
          } catch (e) {
            lastRunAt = 0; // Postgres down at start: run now, the run reports it
          }
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

  /** For /health (no secrets): is the schedule on here, when the last full run finished, the interval. */
  function health() {
    return { scheduled: !!d.scheduled, lastRunAt, intervalMin: mem.config.intervalMin };
  }

  return { run, snapshot, start, health, isRunning: () => !!running, progress: () => (progress ? { ...progress, states: { ...progress.states } } : null) };
}
