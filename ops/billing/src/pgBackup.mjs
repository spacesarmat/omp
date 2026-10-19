/**
 * Daily pg_dump of the billing database (docs/billing/postgres-cutover.md).
 *
 * On when both BILLING_PG_BACKUP_DIR and BILLING_DATABASE_URL are set (the NUC compose mounts
 * /opt/omp-backups/pg there). Dumps are `pg_dump -Fc` files named billing-YYYYMMDD-HHMMSS.dump (MSK),
 * mode 600, written to a .part file first and renamed when pg_dump succeeds.
 * Frequency and retention are admin settings: backupEveryHours (1–168, default 24) and
 * backupKeepDays (1–365, default 30); the newest dump is never deleted.
 * The password goes to pg_dump through PGPASSWORD, never on the command line or in a log.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MSK = 3 * HOUR;
const DUMP_RE = /^billing-(\d{8})-(\d{6})\.dump$/;

export const BACKUP_DEFAULTS = { everyHours: 24, keepDays: 30 };

function whole(v, lo, hi, d) {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) return d;
  return n;
}

export function validBackupEveryHours(v) {
  return whole(v, 1, 168, null) !== null;
}
export function validBackupKeepDays(v) {
  return whole(v, 1, 365, null) !== null;
}

/** Hours between dumps (1–168, default 24). */
export function backupEveryHours(settings) {
  return whole(settings && settings.backupEveryHours, 1, 168, BACKUP_DEFAULTS.everyHours);
}
/** Days a dump is kept (1–365, default 30). */
export function backupKeepDays(settings) {
  return whole(settings && settings.backupKeepDays, 1, 365, BACKUP_DEFAULTS.keepDays);
}

/** { dir, url } when backups are on, otherwise null. */
export function backupConfig(env) {
  const src = env || process.env;
  const dir = String(src.BILLING_PG_BACKUP_DIR || '').trim();
  const url = String(src.BILLING_DATABASE_URL || '').trim();
  return dir && url ? { dir, url } : null;
}

/** pg_dump connection env from a postgres:// URL; the URL itself is not passed on. */
export function pgEnv(url) {
  const u = new URL(url);
  const env = {
    PGHOST: decodeURIComponent(u.hostname),
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || decodeURIComponent(u.username),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

/** billing-YYYYMMDD-HHMMSS.dump for `now`, in MSK. */
export function dumpName(now) {
  const d = new Date(now + MSK);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return (
    'billing-' + p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + '.dump'
  );
}

/** Finished dumps, newest first: { name, at, size } (`at` is the file's mtime). */
export function listDumps(dir) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!DUMP_RE.test(name)) continue;
    try {
      const st = statSync(join(dir, name));
      if (st.isFile() && st.size > 0) out.push({ name, at: st.mtimeMs, size: st.size });
    } catch {
      /* removed meanwhile */
    }
  }
  return out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
}

/** Delete dumps older than keepDays; the newest one always stays. Returns the deleted names. */
export function pruneDumps(dir, keepDays, now) {
  const list = listDumps(dir);
  const cutoff = now - keepDays * DAY;
  const gone = [];
  for (let i = 1; i < list.length; i++) {
    if (list[i].at >= cutoff) continue;
    try {
      unlinkSync(join(dir, list[i].name));
      gone.push(list[i].name);
    } catch {
      /* keep going */
    }
  }
  return gone;
}

/** A dump is due when there is none or the newest is everyHours old (5 min early is fine). */
export function backupDue(dir, settings, now) {
  const last = listDumps(dir)[0];
  return !last || now - last.at >= backupEveryHours(settings) * HOUR - 5 * 60 * 1000;
}

/**
 * Stale: no dump at all, or the newest is older than everyHours + 3 h
 * (the scheduler looks every 10 minutes and a dump takes a while).
 */
export function backupStatus(dir, settings, now, lastError) {
  const list = listDumps(dir);
  const last = list[0] || null;
  const everyHours = backupEveryHours(settings);
  const ageSec = last ? Math.max(0, Math.floor((now - last.at) / 1000)) : null;
  return {
    enabled: true,
    everyHours,
    keepDays: backupKeepDays(settings),
    last: last ? { name: last.name, at: last.at, size: last.size } : null,
    ageSec,
    count: list.length,
    totalBytes: list.reduce((n, x) => n + x.size, 0),
    stale: !last || now - last.at > (everyHours + 3) * HOUR,
    lastError: lastError || '',
  };
}

/** Admin alert text for a stale backup, or ''. */
export function backupAlert(status) {
  if (!status || !status.enabled || !status.stale) return '';
  if (!status.last) return 'Бэкапов Postgres ещё нет' + (status.lastError ? ': ' + status.lastError : '');
  const hours = Math.floor((status.ageSec || 0) / 3600);
  return 'Последний бэкап Postgres ' + hours + ' ч назад (должен быть раз в ' + status.everyHours + ' ч)' +
    (status.lastError ? ': ' + status.lastError : '');
}

/** Problem text for a Telegram notice: a stale backup (backupAlert) or a failed pg_dump; '' when all is well. */
export function backupProblem(status) {
  if (!status || !status.enabled) return '';
  const stale = backupAlert(status);
  if (stale) return stale;
  return status.lastError ? 'Бэкап Postgres не удался: ' + status.lastError : '';
}

/**
 * One Telegram notice per episode: when a problem starts, and once when it is over.
 * Returns { alerted, text } — text is '' when nothing should be sent.
 */
export function backupNotice(alerted, status) {
  const problem = backupProblem(status);
  if (problem && !alerted) return { alerted: true, text: '⚠️ ' + problem };
  if (!problem && alerted) {
    const last = status && status.last;
    return { alerted: false, text: '✅ Бэкап Postgres снова в порядке' + (last ? ': ' + last.name + ', ' + last.size + ' байт' : '') };
  }
  return { alerted, text: '' };
}

/**
 * Run pg_dump into dir. Resolves { ok, name, size } or { ok: false, error } (error has no secrets:
 * the exit code and the last line of pg_dump's stderr, which never holds the password).
 */
export function runDump(cfg, now, opts) {
  const o = opts || {};
  const spawnImpl = o.spawn || spawn;
  const bin = o.bin || 'pg_dump';
  mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(cfg.dir, 0o700); // a bind-mount directory Docker created is 755
  } catch {
    /* not ours to change */
  }
  const name = dumpName(now);
  const final = join(cfg.dir, name);
  const part = final + '.part';
  let env;
  try {
    env = { ...process.env, ...pgEnv(cfg.url) };
  } catch {
    return Promise.resolve({ ok: false, error: 'bad BILLING_DATABASE_URL' });
  }
  delete env.BILLING_DATABASE_URL;
  return new Promise((resolve) => {
    let err = '';
    let child;
    try {
      child = spawnImpl(bin, ['--format=custom', '--no-owner', '--no-privileges', '--file', part], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, error: 'pg_dump: ' + String((e && e.code) || (e && e.message) || e) });
      return;
    }
    if (child.stderr) child.stderr.on('data', (b) => (err = (err + String(b)).slice(-2000)));
    const fail = (msg) => {
      try {
        if (existsSync(part)) unlinkSync(part);
      } catch {
        /* nothing to clean */
      }
      resolve({ ok: false, error: msg });
    };
    child.on('error', (e) => fail('pg_dump: ' + String((e && e.code) || (e && e.message) || e)));
    child.on('close', (code) => {
      if (code !== 0) {
        const line = err.trim().split('\n').pop() || '';
        return fail('pg_dump exit ' + code + (line ? ': ' + line.slice(0, 200) : ''));
      }
      try {
        chmodSync(part, 0o600);
        renameSync(part, final);
        resolve({ ok: true, name, size: statSync(final).size });
      } catch (e) {
        fail('dump file: ' + String((e && e.code) || (e && e.message) || e));
      }
    });
  });
}

/**
 * Scheduler: looks every 10 minutes (first look after 2 minutes), dumps when due, then prunes.
 * `getSettings()` returns the current settings (they live in the store). Returns { status(now), runNow(), stop() }.
 */
export function startPgBackups(cfg, getSettings, opts) {
  const o = opts || {};
  const log = o.log || ((s) => process.stdout.write(s + '\n'));
  let lastError = '';
  let lastSettings = {};
  let alerted = false;
  let busy = null;
  /** Telegram notice to the admins (opts.onAlert) when a problem starts or ends; a failed send is retried next tick. */
  async function notify() {
    if (!o.onAlert) return;
    const n = backupNotice(alerted, backupStatus(cfg.dir, lastSettings, Date.now(), lastError));
    if (!n.text) return;
    try {
      await o.onAlert(n.text);
      alerted = n.alerted;
    } catch {
      /* next tick */
    }
  }
  async function tick(force) {
    if (busy) return busy;
    busy = (async () => {
      const settings = (await getSettings()) || {};
      lastSettings = settings;
      const now = Date.now();
      if (!force && !backupDue(cfg.dir, settings, now)) {
        await notify();
        return null;
      }
      const r = await runDump(cfg, now, o);
      if (r.ok) {
        lastError = '';
        const gone = pruneDumps(cfg.dir, backupKeepDays(settings), Date.now());
        log('pg backup ' + r.name + ' ' + r.size + ' bytes' + (gone.length ? ', removed ' + gone.length + ' old' : ''));
      } else {
        lastError = r.error;
        process.stderr.write('pg backup failed: ' + r.error + '\n');
      }
      await notify();
      return r;
    })()
      .catch((e) => {
        lastError = String((e && e.message) || e);
        return { ok: false, error: lastError };
      })
      .finally(() => {
        busy = null;
      });
    return busy;
  }
  const first = setTimeout(() => void tick(false), o.firstDelayMs ?? 2 * 60 * 1000);
  const every = setInterval(() => void tick(false), o.everyMs ?? 10 * 60 * 1000);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
  return {
    status: (settings, now) => backupStatus(cfg.dir, settings || lastSettings, now ?? Date.now(), lastError),
    runNow: () => tick(true),
    tick: () => tick(false),
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
