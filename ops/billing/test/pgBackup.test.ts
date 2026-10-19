import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupAlert,
  backupNotice,
  backupProblem,
  backupConfig,
  backupDue,
  backupEveryHours,
  backupKeepDays,
  backupStatus,
  dumpName,
  listDumps,
  pgEnv,
  pruneDumps,
  runDump,
  startPgBackups,
} from '../src/pgBackup.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { homePayload } from '../src/adminApi.mjs';
import { healthPayload } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-19T13:00:00Z'); // 16:00 MSK

function tmp() {
  return mkdtempSync(join(tmpdir(), 'omp-pgbk-'));
}

/** A finished dump file whose mtime is `at`. */
function dump(dir: string, at: number, size = 10) {
  const name = dumpName(at);
  writeFileSync(join(dir, name), Buffer.alloc(size, 1));
  utimesSync(join(dir, name), at / 1000, at / 1000);
  return name;
}

/** child_process.spawn stand-in: writes the --file target (or fails) and records what it was given. */
function fakeSpawn(opts: { code?: number; stderr?: string; write?: boolean } = {}) {
  const calls: { bin: string; args: string[]; env: Record<string, string> }[] = [];
  const impl = (bin: string, args: string[], o: { env: Record<string, string> }) => {
    calls.push({ bin, args, env: o.env });
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      const file = args[args.indexOf('--file') + 1];
      if (opts.write !== false) writeFileSync(file, 'PGDMP fake');
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.code ?? 0);
    });
    return child;
  };
  return { impl, calls };
}

const URL_ = 'postgres://billing:s%40cret-pw@postgres:5432/billing';

describe('Postgres backups: settings', () => {
  it('backupEveryHours 1–168 (24) and backupKeepDays 1–365 (30); bad values keep the current one', () => {
    expect(backupEveryHours({})).toBe(24);
    expect(backupKeepDays({})).toBe(30);
    expect(backupEveryHours({ backupEveryHours: 6 })).toBe(6);
    expect(backupEveryHours({ backupEveryHours: 0 })).toBe(24);
    expect(backupKeepDays({ backupKeepDays: 400 })).toBe(30);
    let s = mergeSettings({}, { backupEveryHours: '12', backupKeepDays: '30' });
    expect(s).toMatchObject({ backupEveryHours: 12, backupKeepDays: 30 });
    s = mergeSettings(s, { backupEveryHours: '1.5', backupKeepDays: '0' });
    expect(s).toMatchObject({ backupEveryHours: 12, backupKeepDays: 30 });
    s = mergeSettings(s, {});
    expect(s).toMatchObject({ backupEveryHours: 12, backupKeepDays: 30 });
    expect(publicAdminSettings(s)).toMatchObject({ backupEveryHours: 12, backupKeepDays: 30 });
  });

  it('is on only with both BILLING_PG_BACKUP_DIR and BILLING_DATABASE_URL', () => {
    expect(backupConfig({})).toBeNull();
    expect(backupConfig({ BILLING_PG_BACKUP_DIR: '/backups/pg' })).toBeNull();
    expect(backupConfig({ BILLING_DATABASE_URL: URL_ })).toBeNull();
    expect(backupConfig({ BILLING_PG_BACKUP_DIR: '/backups/pg', BILLING_DATABASE_URL: URL_ })).toEqual({ dir: '/backups/pg', url: URL_ });
  });

  it('pg_dump gets the connection through PG* variables (password decoded), names are MSK', () => {
    expect(pgEnv(URL_)).toEqual({ PGHOST: 'postgres', PGPORT: '5432', PGUSER: 'billing', PGDATABASE: 'billing', PGPASSWORD: 's@cret-pw' });
    expect(dumpName(NOW)).toBe('billing-20261019-160000.dump');
  });
});

describe('Postgres backups: files', () => {
  it('lists finished dumps newest first, ignores .part and other files', () => {
    const dir = tmp();
    dump(dir, NOW - 2 * DAY);
    const newest = dump(dir, NOW - HOUR, 20);
    writeFileSync(join(dir, newest + '.part'), 'x');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const list = listDumps(dir);
    expect(list.map((x) => x.name)).toEqual([newest, dumpName(NOW - 2 * DAY)]);
    expect(list[0].size).toBe(20);
    expect(listDumps(join(dir, 'missing'))).toEqual([]);
  });

  it('prunes dumps older than keepDays and never the newest', () => {
    const dir = tmp();
    const old1 = dump(dir, NOW - 20 * DAY);
    const old2 = dump(dir, NOW - 15 * DAY);
    const keep = dump(dir, NOW - 3 * DAY);
    expect(pruneDumps(dir, 14, NOW).sort()).toEqual([old1, old2].sort());
    expect(readdirSync(dir)).toEqual([keep]);
    // only one, very old: it stays
    const lone = tmp();
    const only = dump(lone, NOW - 100 * DAY);
    expect(pruneDumps(lone, 14, NOW)).toEqual([]);
    expect(readdirSync(lone)).toEqual([only]);
  });

  it('due / stale / alert follow backupEveryHours', () => {
    const dir = tmp();
    expect(backupDue(dir, {}, NOW)).toBe(true);
    let st = backupStatus(dir, {}, NOW, '');
    expect(st).toMatchObject({ enabled: true, last: null, stale: true, count: 0 });
    expect(backupAlert(st)).toBe('Бэкапов Postgres ещё нет');
    dump(dir, NOW - 23 * HOUR, 1234);
    expect(backupDue(dir, {}, NOW)).toBe(false);
    expect(backupDue(dir, { backupEveryHours: 6 }, NOW)).toBe(true);
    st = backupStatus(dir, {}, NOW, '');
    expect(st).toMatchObject({ stale: false, count: 1, totalBytes: 1234, everyHours: 24, keepDays: 30, ageSec: 23 * 3600 });
    expect(backupAlert(st)).toBe('');
    st = backupStatus(dir, {}, NOW + 5 * HOUR, 'pg_dump exit 1: connection refused');
    expect(st.stale).toBe(true);
    expect(backupAlert(st)).toBe('Последний бэкап Postgres 28 ч назад (должен быть раз в 24 ч): pg_dump exit 1: connection refused');
  });
});

describe('Postgres backups: pg_dump run', () => {
  it('writes a .part file, then a 600 dump; no password on the command line', async () => {
    const dir = join(tmp(), 'pg');
    const fake = fakeSpawn();
    const r = await runDump({ dir, url: URL_ }, NOW, { spawn: fake.impl });
    expect(r).toMatchObject({ ok: true, name: 'billing-20261019-160000.dump' });
    const file = join(dir, r.name as string);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual([r.name]);
    const call = fake.calls[0];
    expect(call.bin).toBe('pg_dump');
    expect(call.args).toContain('--format=custom');
    expect(call.args.join(' ')).not.toContain('s@cret');
    expect(call.args.join(' ')).not.toContain('postgres://');
    expect(call.env.PGPASSWORD).toBe('s@cret-pw');
    expect(call.env.BILLING_DATABASE_URL).toBeUndefined();
  });

  it('a failed pg_dump leaves no file and reports the exit code and last stderr line only', async () => {
    const dir = tmp();
    const fake = fakeSpawn({ code: 1, stderr: 'pg_dump: error: connection to server failed\npg_dump: error: could not connect\n' });
    const r = await runDump({ dir, url: URL_ }, NOW, { spawn: fake.impl });
    expect(r).toEqual({ ok: false, error: 'pg_dump exit 1: pg_dump: error: could not connect' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a missing pg_dump binary is an error, not a crash', async () => {
    const dir = tmp();
    const r = await runDump({ dir, url: URL_ }, NOW, { bin: join(dir, 'no-such-pg_dump') });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('ENOENT');
  });

  it('the scheduler dumps when due, prunes, and reports the last error', async () => {
    const dir = tmp();
    dump(dir, Date.now() - 30 * DAY);
    const fake = fakeSpawn();
    const logs: string[] = [];
    const b = startPgBackups({ dir, url: URL_ }, async () => ({ backupEveryHours: 24, backupKeepDays: 14 }), {
      spawn: fake.impl,
      firstDelayMs: 1e9,
      everyMs: 1e9,
      log: (s: string) => logs.push(s),
    });
    const r = await b.tick();
    expect(r && r.ok).toBe(true);
    expect(listDumps(dir)).toHaveLength(1); // the 30-day-old one is gone
    expect(logs[0]).toMatch(/^pg backup billing-\d{8}-\d{6}\.dump \d+ bytes, removed 1 old$/);
    expect(await b.tick()).toBeNull(); // not due again
    const st = b.status();
    expect(st).toMatchObject({ enabled: true, stale: false, count: 1, lastError: '' });
    b.stop();

    const failing = startPgBackups({ dir: tmp(), url: URL_ }, async () => ({}), {
      spawn: fakeSpawn({ code: 2, stderr: 'boom' }).impl,
      firstDelayMs: 1e9,
      everyMs: 1e9,
      log: () => {},
    });
    await failing.runNow();
    expect(failing.status()).toMatchObject({ stale: true, lastError: 'pg_dump exit 2: boom' });
    failing.stop();
  });
});

describe('Postgres backups: health and admin', () => {
  it('/health adds pgBackupOk / pgBackupAgoSec only when backups are on', () => {
    expect(healthPayload(NOW)).not.toHaveProperty('pgBackupOk');
    const dir = tmp();
    dump(dir, NOW - HOUR);
    expect(healthPayload(NOW, { backup: backupStatus(dir, {}, NOW, '') })).toMatchObject({ ok: true, pgBackupOk: true, pgBackupAgoSec: 3600 });
    expect(healthPayload(NOW, { backup: backupStatus(tmp(), {}, NOW, '') })).toMatchObject({ ok: true, pgBackupOk: false, pgBackupAgoSec: null });
  });

  it('the admin home shows the last dump and raises an alert when it is stale', () => {
    const state = emptyState();
    const dir = tmp();
    dump(dir, NOW - 40 * HOUR, 2048);
    const backup = backupStatus(dir, {}, NOW, '');
    const home = homePayload(state, null, { csrf: 'c', backup });
    expect(home.backup).toMatchObject({ last: { size: 2048 }, stale: true });
    expect(home.alerts[0]).toEqual({ level: 'bad', text: 'Последний бэкап Postgres 40 ч назад (должен быть раз в 24 ч)' });
    const off = homePayload(state, null, { csrf: 'c' });
    expect(off.backup).toBeNull();
    expect(off.alerts.some((a: { text: string }) => a.text.indexOf('Postgres') >= 0)).toBe(false);
    const ro = homePayload(state, null, { csrf: 'c', readOnly: true });
    expect(ro.readOnly).toBe(true);
    expect(ro.alerts[0].text).toContain('только чтения');
  });
});

// A real pg_dump against the test database, when the client is new enough for the server (CI's runner client may be older).
const DB = process.env.BILLING_TEST_DATABASE_URL || '';
function pgDumpMajor() {
  try {
    const m = /(\d+)\./.exec(execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}
const realOk = !!DB && pgDumpMajor() >= 17;

describe.skipIf(!realOk)('Postgres backups: real pg_dump', () => {
  it('dumps the test database into a custom-format file', async () => {
    // Its own small database: the shared one holds the schemas of the files running in parallel.
    const pg = (await import('pg')).default;
    const name = 'dump_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 8);
    const admin = new pg.Client({ connectionString: DB });
    await admin.connect();
    await admin.query('CREATE DATABASE ' + name);
    const url = new URL(DB);
    url.pathname = '/' + name;
    const dir = join(tmp(), 'pg');
    let r;
    try {
      const own = new pg.Client({ connectionString: url.toString() });
      await own.connect();
      await own.query('CREATE TABLE t (id int PRIMARY KEY); INSERT INTO t VALUES (1)');
      await own.end();
      r = await runDump({ dir, url: url.toString() }, Date.now());
    } finally {
      await admin.query('DROP DATABASE IF EXISTS ' + name).catch(() => {});
      await admin.end();
    }
    expect(r.ok, String(r.error)).toBe(true);
    const file = join(dir, r.name as string);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file).subarray(0, 5).toString('latin1')).toBe('PGDMP'); // pg_dump custom format
  }, 30_000);
});

describe('Postgres backups: Telegram notice to the admins', () => {
  it('one notice when a problem starts, one when it is over', () => {
    const dir = tmp();
    const fresh = () => backupStatus(dir, {}, NOW, '');
    expect(backupProblem(fresh())).toBe('Бэкапов Postgres ещё нет');
    let n = backupNotice(false, fresh());
    expect(n).toEqual({ alerted: true, text: '⚠️ Бэкапов Postgres ещё нет' });
    expect(backupNotice(true, fresh())).toEqual({ alerted: true, text: '' });
    const name = dump(dir, NOW - HOUR, 99);
    n = backupNotice(true, fresh());
    expect(n).toEqual({ alerted: false, text: '✅ Бэкап Postgres снова в порядке: ' + name + ', 99 байт' });
    expect(backupNotice(false, fresh())).toEqual({ alerted: false, text: '' });
    // a failed pg_dump is a problem even while the last dump is still fresh
    const failed = backupStatus(dir, {}, NOW, 'pg_dump exit 1: boom');
    expect(backupNotice(false, failed)).toEqual({ alerted: true, text: '⚠️ Бэкап Postgres не удался: pg_dump exit 1: boom' });
    expect(backupProblem({ enabled: false } as never)).toBe('');
  });

  it('the scheduler sends the notice once per episode and retries a failed send', async () => {
    const dir = tmp();
    const sent: string[] = [];
    let failSend = true;
    let code = 1;
    const spawnImpl = (bin: string, args: string[], o: { env: Record<string, string> }) => fakeSpawn({ code, stderr: 'boom' }).impl(bin, args, o);
    const b = startPgBackups({ dir, url: URL_ }, async () => ({}), {
      spawn: spawnImpl,
      firstDelayMs: 1e9,
      everyMs: 1e9,
      log: () => {},
      onAlert: async (t: string) => {
        if (failSend) throw new Error('telegram down');
        sent.push(t);
      },
    });
    await b.tick(); // fails, the notice cannot be sent
    expect(sent).toEqual([]);
    failSend = false;
    await b.tick(); // still failing: the notice goes out now
    await b.tick(); // same episode: nothing new
    expect(sent).toEqual(['⚠️ Бэкапов Postgres ещё нет: pg_dump exit 1: boom']);
    code = 0;
    await b.tick(); // dump works
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^✅ Бэкап Postgres снова в порядке: billing-\d{8}-\d{6}\.dump, \d+ байт$/);
    await b.tick(); // not due, all fine: nothing
    expect(sent).toHaveLength(2);
    b.stop();
  });
});
