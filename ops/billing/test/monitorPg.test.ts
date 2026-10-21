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

  it('«Перепроверить все ошибки» runs only the red checks, keeps the rest, and does not move the schedule', async () => {
    const t = await setup();
    t.w.failJackett.add('kinozal');
    const first = await t.monitor.run('schedule');
    const firstAt = first!.finishedAt;
    expect(t.sent).toHaveLength(1);
    const okBefore = first!.rows.find((x: any) => x.id === 'jackett:rutracker');
    t.w.failJackett.clear();
    t.tick(60000);
    const searches: string[] = [];
    const base = makeGet(t.w);
    const counting = createMonitor({
      store: t.store,
      env: { BILLING_DOCKER_PROXY_URL: 'http://docker-proxy:2375' },
      getSettings: async () => (await t.store.read()).settings,
      send: async (_c: string, text: string) => {
        t.sent.push({ chat: _c, text });
        return true;
      },
      net: async () => ({ status: 200, ok: true }),
      get: async (url: string, opts?: { proxy?: string }) => {
        const u = new URL(url);
        if (u.hostname === 'jackett' && u.searchParams.get('t') !== 'indexers') searches.push(u.pathname.split('/')[4]);
        return base(url, opts);
      },
      statfs: async () => ({ blocks: 1000000, bsize: 1024 * 1024, bavail: 900000 }),
      now: t.now,
      sleep: async () => {},
      botPoll: () => ({ enabled: true, lastOkAt: t.now() - 1000 }),
      log: () => {},
    });
    const r = await counting.run('recheck', { only: 'failed' });
    expect(searches).toEqual(['kinozal']);
    expect(r!.rows.find((x: any) => x.id === 'jackett:kinozal')).toMatchObject({ ok: true });
    // the green ones keep their last result and time
    expect(r!.rows.find((x: any) => x.id === 'jackett:rutracker')).toMatchObject({ ok: true, at: okBefore.at });
    expect(r!.rows.length).toBe(first!.rows.length);
    expect(t.sent.at(-1)!.text).toContain('починилось');
    // history: one more result for kinozal only
    const n = await t.store.query("SELECT check_id, count(*)::int AS n FROM monitor_results WHERE check_id IN ('jackett:kinozal', 'jackett:rutracker') GROUP BY check_id ORDER BY check_id");
    expect(n.rows).toEqual([
      { check_id: 'jackett:kinozal', n: 2 },
      { check_id: 'jackett:rutracker', n: 1 },
    ]);
    const snap = await counting.snapshot();
    expect(snap.lastRun.trigger).toBe('recheck');
    const full = (await t.store.query("SELECT max(finished_at) AS at FROM monitor_runs WHERE trigger <> 'recheck'")).rows[0];
    expect(Number(full.at)).toBe(firstAt);
  });

  it('a recheck starts from the newest run, even one that could not be saved', async () => {
    const t = await setup();
    t.w.failJackett.add('kinozal');
    await t.monitor.run('schedule');
    // Postgres refuses the next run: kinozal recovered, rutracker broke, nothing saved.
    const store = t.store as any;
    const query = store.query.bind(store);
    store.query = (sql: string, params?: unknown[]) =>
      /INSERT INTO monitor_runs/.test(sql) ? Promise.reject(Object.assign(new Error('down'), { code: 'ECONNREFUSED' })) : query(sql, params);
    t.w.failJackett.clear();
    t.w.failJackett.add('rutracker');
    t.tick(60000);
    await t.monitor.run('schedule');
    store.query = query;
    t.tick(60000);
    const r = await t.monitor.run('recheck', { only: 'failed' });
    // rutracker was red in the unsaved run, so it is checked again and stays red: no false «починилось»
    expect(r!.rows.find((x: any) => x.id === 'jackett:rutracker')).toMatchObject({ ok: false });
    expect(r!.rows.find((x: any) => x.id === 'jackett:kinozal')).toMatchObject({ ok: true });
    expect(t.sent.filter((m) => m.text.includes('починилось') && m.text.includes('utracker'))).toEqual([]);
  });

  it('«Перепроверить» on a row runs only that check, with progress, retry and alerts like any run', async () => {
    const seen: any[] = [];
    let m: any = null;
    const t = await setup({
      sleep: async () => {
        seen.push(m.progress());
      },
    });
    m = t.monitor;
    expect(m.progress()).toBeNull();
    await t.monitor.run('schedule');
    const firstAt = (await t.monitor.snapshot()).lastRun.finishedAt;
    t.w.failJackett.add('kinozal');
    t.tick(60000);
    const r = await t.monitor.run('recheck', { ids: ['jackett:kinozal'] });
    // the retry 30 s later: the row waits for it, the counter grows by one
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ trigger: 'recheck', total: 2, done: 1, states: { 'jackett:kinozal': 'retry' } });
    expect(Object.keys(seen[0].states)).toEqual(['jackett:kinozal']);
    expect(r!.rows.find((x: any) => x.id === 'jackett:kinozal')).toMatchObject({ ok: false, retried: true });
    expect(t.sent.at(-1)!.text).toContain('Kinozal');
    const n = await t.store.query("SELECT check_id, count(*)::int AS n FROM monitor_results WHERE check_id IN ('jackett:kinozal', 'jackett:rutracker') GROUP BY check_id ORDER BY check_id");
    expect(n.rows).toEqual([
      { check_id: 'jackett:kinozal', n: 2 },
      { check_id: 'jackett:rutracker', n: 1 },
    ]);
    const snap = await t.monitor.snapshot();
    expect(snap.progress).toBeNull();
    expect(snap.lastSummary).toMatchObject({ trigger: 'recheck', checked: 1, failed: 1, retried: 1, ids: ['jackett:kinozal'] });
    expect(snap.checks.length).toBe(r!.rows.length);
    const full = (await t.store.query("SELECT max(finished_at) AS at FROM monitor_runs WHERE trigger <> 'recheck'")).rows[0];
    expect(Number(full.at)).toBe(firstAt);
    // an id that is not a check starts nothing
    expect(await t.monitor.run('recheck', { ids: ['nope'] })).toBeNull();
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

  it('a Postgres outage is still reported (cached settings and state), once, and its recovery too', async () => {
    const base = await testStore();
    await base.update((s: any) => ({ state: { ...s, settings: { ...s.settings, ...SETTINGS } } }));
    let down = false;
    const refuse = () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const flaky = { query: (sql: string, params?: unknown[]) => (down ? refuse() : base.query(sql, params)) };
    const tokens: string[] = [];
    const t = await setup({
      store: flaky,
      getSettings: async () => (down ? refuse() : (await base.read()).settings),
    });
    const sent: string[] = [];
    // re-create with a send that records the token it was handed
    const monitor = createMonitor({
      store: flaky,
      env: {},
      getSettings: async () => (down ? refuse() : (await base.read()).settings),
      send: async (_chat: string, text: string, settings: any) => {
        tokens.push(settings && settings.botToken);
        sent.push(text);
        return true;
      },
      net: async () => ({ status: 200, ok: true }),
      get: makeGet(t.w),
      statfs: async () => ({ blocks: 1000000, bsize: 1024 * 1024, bavail: 900000 }),
      now: t.now,
      sleep: async () => {},
      botPoll: () => ({ enabled: true, lastOkAt: t.now() - 1000 }),
      log: () => {},
    });
    await monitor.run('schedule');
    expect(sent).toEqual([]);
    down = true;
    t.tick(15 * 60000);
    const r = await monitor.run('schedule');
    expect(r).not.toBeNull();
    expect(r!.rows.find((x: any) => x.id === 'postgres').ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('• Postgres');
    expect(tokens[0]).toBe(SETTINGS.botToken);
    t.tick(15 * 60000);
    await monitor.run('schedule');
    expect(sent).toHaveLength(1);
    down = false;
    t.tick(15 * 60000);
    await monitor.run('schedule');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('починилось');
    expect(sent[1]).toContain('• Postgres');
    const kv = await base.query("SELECT value FROM kv WHERE key = 'monitor_alerts'");
    expect(JSON.parse(kv.rows[0].value)).toEqual({});
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
    t.tick(1000);
    const again = await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf, only: 'failed' });
    expect(JSON.parse(again.body)).toMatchObject({ ok: true });
    await vi.waitFor(async () => expect(t.monitor.isRunning()).toBe(false), { timeout: 5000 });
    expect(JSON.parse((await call(app, 'GET', '/admin/api/monitor', { cookie })).body).lastRun.trigger).toBe('recheck');
    const entries = (await t.store.read()).audit;
    const audit = entries.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['monitor_run', 'monitor_config']));
    expect(entries.some((a: any) => a.action === 'monitor_run' && /только ошибки/.test(JSON.stringify(a)))).toBe(true);
    // «Перепроверить» on one row
    t.tick(1000);
    const row = JSON.parse((await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf, ids: ['jackett:kinozal'] })).body);
    expect(row).toMatchObject({ ok: true, ids: ['jackett:kinozal'] });
    await vi.waitFor(async () => expect(t.monitor.isRunning()).toBe(false), { timeout: 5000 });
    const after = JSON.parse((await call(app, 'GET', '/admin/api/monitor', { cookie })).body);
    expect(after.lastSummary).toMatchObject({ checked: 1, ids: ['jackett:kinozal'] });
    expect((await t.store.read()).audit.some((a: any) => /перепроверка: jackett:kinozal/.test(JSON.stringify(a)))).toBe(true);
    for (const ids of [[], ['bad id'], 'jackett:kinozal', Array.from({ length: 11 }, (_, i) => 'x' + i)]) {
      expect(JSON.parse((await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf, ids })).body).ok).toBe(false);
    }
    // concurrency: a row recheck never joins a run that is going
    t.tick(1000);
    await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf });
    expect(t.monitor.isRunning()).toBe(true);
    const busy = JSON.parse((await call(app, 'POST', '/admin/monitor/run', { cookie }, { csrf, ids: ['jackett:kinozal'] })).body);
    expect(busy).toMatchObject({ ok: false, busy: true });
    await vi.waitFor(async () => expect(t.monitor.isRunning()).toBe(false), { timeout: 5000 });
  });

  it('read-only mode has no monitor', async () => {
    const t = await setup();
    const app = createApp(t.store, undefined, { readOnly: true }) as App;
    const { cookie } = await login(app, t.store);
    expect(JSON.parse((await call(app, 'GET', '/admin/api/monitor', { cookie })).body)).toMatchObject({ ok: false, error: 'read_only' });
  });
});
