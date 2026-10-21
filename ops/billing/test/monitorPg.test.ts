import { describe, expect, it, vi } from 'vitest';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { createMonitor, readMonitorConfig, saveMonitorConfig, MONITOR_RETRY_MS } from '../src/monitor.mjs';
import { toStore } from '../src/db/index.mjs';
import { testStore } from './pg';

const KEY = 'jk_' + 'q'.repeat(29);
const SETTINGS = { jackettUrl: 'http://jackett:9117', jackettApiKey: KEY, botToken: '123:' + 'b'.repeat(30) };
const XML =
  '<indexers><indexer id="rutracker" configured="true"><title>RuTracker</title><link>https://rutracker.org/</link></indexer>' +
  '<indexer id="kinozal" configured="true"><title>Kinozal</title><link>https://kinozal.tv/</link></indexer></indexers>';

type World = { failJackett: Set<string>; failOnce: Set<string>; restarts: number; calls: number };

function makeGet(w: World) {
  return async (url: string, opts?: { proxy?: string }) => {
    w.calls += 1;
    const u = new URL(url);
    const base = { ok: true, ms: 3, headers: {} as Record<string, string> };
    if (u.hostname === 'jackett') {
      if (u.searchParams.get('t') === 'indexers') return { ...base, status: 200, body: XML };
      const id = u.pathname.split('/')[4];
      if (w.failOnce.has(id)) {
        w.failOnce.delete(id);
        return { ok: false, error: 'timeout', ms: 1 };
      }
      if (w.failJackett.has(id)) return { ...base, status: 200, body: '<error code="900" description="boom"/>' };
      return { ...base, status: 200, body: '<rss><channel><item/></channel></rss>' };
    }
    if (u.hostname === 'docker-proxy') {
      if (u.pathname === '/containers/json') return { ...base, status: 200, body: JSON.stringify([{ Id: 'c'.repeat(64), Names: ['/omp-jacred'] }]) };
      if (u.pathname.endsWith('/json')) return { ...base, status: 200, body: JSON.stringify({ State: { Status: 'running' }, RestartCount: w.restarts }) };
      return { ...base, status: 200, body: '{}' };
    }
    if (u.hostname === 'www.cloudflare.com') return { ...base, status: 200, body: opts && opts.proxy ? 'warp=on' : 'warp=off' };
    if (u.hostname.endsWith('omp-player.online')) return { ...base, status: u.hostname.startsWith('jack') || u.hostname.startsWith('jacred') ? 401 : 200 };
    return { ...base, status: 200 };
  };
}

async function setup(extra: Record<string, unknown> = {}) {
  const store = await testStore();
  await store.update((s: any) => ({ state: { ...s, settings: { ...s.settings, ...SETTINGS } } }));
  const w: World = { failJackett: new Set(), failOnce: new Set(), restarts: 0, calls: 0 };
  const sent: { chat: string; text: string }[] = [];
  const sleeps: number[] = [];
  let sendOk = true;
  let clock = Date.parse('2026-10-21T20:00:00Z');
  const monitor = createMonitor({
    store,
    env: { BILLING_DOCKER_PROXY_URL: 'http://docker-proxy:2375' },
    getSettings: async () => (await store.read()).settings,
    send: async (chat: string, text: string) => {
      if (!sendOk) return false;
      sent.push({ chat, text });
      return true;
    },
    net: async () => ({ status: 200, ok: true }),
    get: makeGet(w),
    statfs: async () => ({ blocks: 1000000, bsize: 1024 * 1024, bavail: 900000 }),
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    botPoll: () => ({ enabled: true, lastOkAt: clock - 1000 }),
    log: () => {},
    ...extra,
  });
  return {
    store,
    monitor,
    w,
    sent,
    sleeps,
    setSendOk: (v: boolean) => (sendOk = v),
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe('monitor runs on Postgres', () => {
  it('stores the run and the history, and sends nothing while all is fine', async () => {
    const t = await setup();
    const r = await t.monitor.run('manual');
    expect(r!.rows.filter((x: any) => x.ok === false)).toEqual([]);
    expect(t.sent).toEqual([]);
    expect(t.sleeps).toEqual([]);
    const snap = await t.monitor.snapshot();
    expect(snap).toMatchObject({ ok: true, intervalMin: 15, running: false, lastRun: { trigger: 'manual', failed: 0 } });
    const row = snap.checks.find((c: any) => c.id === 'jackett:kinozal');
    expect(row).toMatchObject({ ok: true, uptime: 100, alerted: false });
    expect(row.history).toHaveLength(168);
    expect(row.history.endsWith('g')).toBe(true);
    expect(JSON.stringify(snap)).not.toContain(KEY);
    expect(JSON.stringify(snap)).not.toContain(SETTINGS.botToken);
  });

  it('retries once after 30 s, alerts once, stays quiet, then says it is fixed', async () => {
    const t = await setup();
    t.w.failJackett.add('kinozal');
    await t.monitor.run('schedule');
    expect(t.sleeps).toEqual([MONITOR_RETRY_MS]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].chat).toBe('536445442');
    expect(t.sent[0].text).toContain('• Jackett: Kinozal (поиск через Jackett): ошибка: boom');
    expect((await t.monitor.snapshot()).checks.find((c: any) => c.id === 'jackett:kinozal')).toMatchObject({ ok: false, alerted: true, retried: true });

    t.tick(15 * 60000);
    await t.monitor.run('schedule');
    expect(t.sent).toHaveLength(1);
    expect(t.sleeps).toHaveLength(1);

    t.w.failJackett.clear();
    t.tick(15 * 60000);
    await t.monitor.run('schedule');
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].text).toBe('✅ Мониторинг OMP: починилось\n• Jackett: Kinozal (поиск через Jackett)');
    const snap = await t.monitor.snapshot();
    const row = snap.checks.find((c: any) => c.id === 'jackett:kinozal');
    expect(row.alerted).toBe(false);
    expect(row.uptime).toBeCloseTo(33.3, 1);
  });

  it('a failure that passes on the retry sends nothing', async () => {
    const t = await setup();
    t.w.failOnce.add('rutracker');
    const r = await t.monitor.run('schedule');
    expect(t.sleeps).toEqual([MONITOR_RETRY_MS]);
    expect(t.sent).toEqual([]);
    expect(r!.rows.find((x: any) => x.id === 'jackett:rutracker')).toMatchObject({ ok: true, retried: true });
  });

  it('a message that could not be sent goes out on the next run', async () => {
    const t = await setup();
    t.w.failJackett.add('kinozal');
    t.setSendOk(false);
    await t.monitor.run('schedule');
    expect(t.sent).toEqual([]);
    t.setSendOk(true);
    await t.monitor.run('schedule');
    expect(t.sent).toHaveLength(1);
  });

  it('a container restart between runs is a problem; the next quiet run fixes it', async () => {
    const t = await setup();
    await t.monitor.run('schedule');
    t.w.restarts = 1;
    await t.monitor.run('schedule');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].text).toContain('omp-jacred: работает, перезапускался: 0 → 1');
    await t.monitor.run('schedule');
    expect(t.sent[1].text).toContain('починилось');
  });

  it('keeps 7 days only', async () => {
    const t = await setup();
    const old = t.now() - 8 * 24 * 3600000;
    await t.store.query("INSERT INTO monitor_runs (run_at, finished_at, trigger, total, failed, rows) VALUES ($1, $1, 'schedule', 0, 0, '[]')", [old]);
    await t.store.query("INSERT INTO monitor_results (run_at, check_id, ok) VALUES ($1, 'postgres', true)", [old]);
    await t.monitor.run('schedule');
    expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_runs WHERE run_at = $1', [old])).rows[0].n).toBe(0);
    expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_results WHERE run_at = $1', [old])).rows[0].n).toBe(0);
  });

  it('two calls during a run share it', async () => {
    const t = await setup();
    const [a, b] = await Promise.all([t.monitor.run('manual'), t.monitor.run('manual')]);
    expect(a).toBe(b);
    expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_runs')).rows[0].n).toBe(1);
  });

  it('interval: 5-1440 whole minutes, default 15', async () => {
    const t = await setup();
    expect(await readMonitorConfig(t.store)).toEqual({ intervalMin: 15 });
    expect(await saveMonitorConfig(t.store, { intervalMin: '3' })).toMatchObject({ ok: false });
    expect(await saveMonitorConfig(t.store, { intervalMin: '30' })).toEqual({ ok: true, intervalMin: 30 });
    expect((await t.monitor.snapshot()).intervalMin).toBe(30);
  });

  it('the schedule runs when the interval has passed and not before', async () => {
    const t = await setup();
    const stop = t.monitor.start({ firstMs: 1, everyMs: 15 });
    try {
      await vi.waitFor(async () => expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_runs')).rows[0].n).toBe(1), { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 120));
      expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_runs')).rows[0].n).toBe(1);
      t.tick(15 * 60000);
      await vi.waitFor(async () => expect((await t.store.query('SELECT count(*)::int AS n FROM monitor_runs')).rows[0].n).toBe(2), { timeout: 5000 });
      expect((await t.monitor.snapshot()).scheduled).toBe(true);
    } finally {
      stop();
    }
  });
});

// ---------- HTTP routes ----------
type App = (req: unknown, res: unknown) => Promise<void>;

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

async function call(app: App, method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    url: path,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body, headers: res.headers };
}

async function login(app: App, store: unknown) {
  const issued = await toStore(store).update((cur: any) => issueCliAdminLogin(cur, { now: Date.now() }));
  const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(issued.token));
  const m = /omp_admin=([^;]+)/.exec(String(once.headers['set-cookie'] || ''));
  const cookie = 'omp_admin=' + m![1];
  const home = JSON.parse((await call(app, 'GET', '/admin/api/home', { cookie })).body);
  return { cookie, csrf: home.csrf as string };
}

describe('monitor routes', () => {
  it('need an admin session and the csrf token', async () => {
    const t = await setup();
    const app = createApp(t.store, undefined, { monitor: t.monitor }) as App;
    expect((await call(app, 'GET', '/admin/api/monitor')).status).toBe(401);
    const { cookie, csrf } = await login(app, t.store);
    expect((await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf: 'nope' })).status).toBe(403);
    const started = await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf });
    expect(JSON.parse(started.body)).toMatchObject({ ok: true, running: true });
    await vi.waitFor(async () => expect(t.monitor.isRunning()).toBe(false), { timeout: 5000 });
    const snap = JSON.parse((await call(app, 'GET', '/admin/api/monitor', { cookie })).body);
    expect(snap.lastRun.trigger).toBe('manual');
    expect(snap.checks.length).toBeGreaterThan(10);
    const bad = JSON.parse((await call(app, 'POST', '/admin/monitor/config', { cookie }, { csrf, intervalMin: 2 })).body);
    expect(bad.ok).toBe(false);
    const good = JSON.parse((await call(app, 'POST', '/admin/monitor/config', { cookie }, { csrf, intervalMin: 60 })).body);
    expect(good).toEqual({ ok: true, intervalMin: 60 });
    const audit = (await t.store.read()).audit.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['monitor_run', 'monitor_config']));
  });

  it('read-only mode has no monitor', async () => {
    const t = await setup();
    const app = createApp(t.store, undefined, { readOnly: true }) as App;
    const { cookie } = await login(app, t.store);
    expect(JSON.parse((await call(app, 'GET', '/admin/api/monitor', { cookie })).body)).toMatchObject({ ok: false, error: 'read_only' });
  });
});
