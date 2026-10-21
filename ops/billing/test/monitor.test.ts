import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { monitorGet, errorKind } from '../src/monitorHttp.mjs';
import {
  buildTasks,
  cleanDetail,
  containerVerdict,
  errorText,
  finalize,
  jackettFeedVerdict,
  looksBlocked,
  parseJackettIndexers,
  parseJacredDate,
  parseTrace,
  runTasks,
  siteVerdict,
  PUBLIC_SITES,
} from '../src/monitorChecks.mjs';
import { alertPlan, historyStrip, monitorChatId, monitorEnabled, problemMessages, problemText, recoveredText, validInterval } from '../src/monitor.mjs';

const KEY = 'jk_' + 'x'.repeat(29);
const RED_KEY = 'jr_' + 'y'.repeat(29);

// ---------- a local target and a local CONNECT proxy, so both paths of monitorGet run for real ----------
let target: Server;
let proxy: Server;
let targetPort = 0;
let proxyPort = 0;
let proxied = 0;
let tunneledBytes = 0;
let targetHits: string[] = [];

beforeAll(async () => {
  target = createServer((req, res) => {
    targetHits.push(String(req.socket.remotePort));
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://warning.rt.ru/?id=1' });
      return res.end();
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('a'.repeat(200000));
    }
    if (String(req.url).startsWith('/slow')) return; // never answers
    res.writeHead(200, { 'content-type': 'text/plain', server: 'test' });
    res.end('fl=1\nwarp=on\ncolo=AMS\n');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  targetPort = (target.address() as AddressInfo).port;
  proxy = createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on('connect', (req, client, head) => {
    proxied += 1;
    const [host, port] = String(req.url).split(':');
    if (port === '1') {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const up = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(client);
      client.on('data', (b: Buffer) => {
        tunneledBytes += b.length;
      });
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  target.closeAllConnections();
  proxy.closeAllConnections();
  await new Promise((r) => target.close(r));
  await new Promise((r) => proxy.close(r));
});

describe('monitorGet', () => {
  it('reads directly and through a CONNECT proxy, and tells them apart', async () => {
    const before = proxied;
    const direct = await monitorGet('http://127.0.0.1:' + targetPort + '/');
    expect(direct).toMatchObject({ ok: true, status: 200 });
    expect(direct.body).toContain('warp=on');
    expect(proxied).toBe(before);
    const bytesBefore = tunneledBytes;
    targetHits = [];
    const via = await monitorGet('http://127.0.0.1:' + targetPort + '/', { proxy: 'http://127.0.0.1:' + proxyPort });
    expect(via).toMatchObject({ ok: true, status: 200 });
    expect(via.body).toContain('warp=on');
    expect(proxied).toBe(before + 1);
    // the GET itself went through the tunnel, not around it
    expect(tunneledBytes - bytesBefore).toBeGreaterThan(20);
    expect(targetHits.length).toBe(1);
  });

  it('does not follow redirects and keeps the location', async () => {
    const r = await monitorGet('http://127.0.0.1:' + targetPort + '/redirect');
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('warning.rt.ru');
  });

  it('caps the body', async () => {
    const r = await monitorGet('http://127.0.0.1:' + targetPort + '/big', { maxBytes: 1000 });
    expect(r.ok).toBe(true);
    expect(r.body.length).toBe(1000);
  });

  it('times out, and reports refused and proxy failures as short kinds without the URL', async () => {
    const slow = await monitorGet('http://127.0.0.1:' + targetPort + '/slow?apikey=' + KEY, { timeoutMs: 300 });
    expect(slow).toMatchObject({ ok: false, error: 'timeout' });
    expect(JSON.stringify(slow)).not.toContain(KEY);
    const refused = await monitorGet('http://127.0.0.1:1/');
    expect(refused).toMatchObject({ ok: false, error: 'refused' });
    const badProxy = await monitorGet('http://127.0.0.1:1/', { proxy: 'http://127.0.0.1:' + proxyPort });
    expect(badProxy).toMatchObject({ ok: false, error: 'proxy_502' });
    const deadProxy = await monitorGet('http://127.0.0.1:' + targetPort + '/', { proxy: 'http://127.0.0.1:1' });
    expect(deadProxy).toMatchObject({ ok: false, error: 'proxy_refused' });
    expect(await monitorGet('not a url')).toMatchObject({ ok: false, error: 'bad_url' });
  });

  it('maps socket error codes', () => {
    expect(errorKind({ code: 'ENOTFOUND' })).toBe('dns');
    expect(errorKind({ code: 'ECONNRESET' })).toBe('reset');
    expect(errorKind({ code: 'CERT_HAS_EXPIRED' })).toBe('tls');
    expect(errorKind({ code: 'EHOSTUNREACH' })).toBe('unreachable');
    expect(errorKind(null)).toBe('down');
  });
});

describe('verdicts and parsers', () => {
  it('treats any answer below 500 as reachable, a block-page redirect or 5xx as not', () => {
    const url = 'https://rutracker.org/';
    expect(siteVerdict({ ok: true, status: 200, headers: {} }, url).ok).toBe(true);
    expect(siteVerdict({ ok: true, status: 403, headers: { server: 'cloudflare' } }, url)).toEqual({ ok: true, detail: 'HTTP 403, проверка Cloudflare' });
    expect(siteVerdict({ ok: true, status: 301, headers: { location: 'https://www.rutracker.org/forum/' } }, url)).toEqual({ ok: true, detail: 'HTTP 301' });
    expect(siteVerdict({ ok: true, status: 302, headers: { location: 'http://warning.rt.ru/?id=17' } }, url)).toEqual({ ok: false, detail: 'редирект на страницу блокировки (warning.rt.ru)' });
    expect(siteVerdict({ ok: true, status: 302, headers: { location: 'http://95.167.13.50/' } }, url).ok).toBe(false);
    expect(siteVerdict({ ok: true, status: 302, headers: { location: 'https://rutor.is/' } }, 'http://rutor.info/')).toEqual({ ok: true, detail: 'HTTP 302, редирект на rutor.is' });
    expect(siteVerdict({ ok: true, status: 502, headers: {} }, url)).toEqual({ ok: false, detail: 'HTTP 502' });
    expect(siteVerdict({ ok: false, error: 'timeout' }, url)).toEqual({ ok: false, detail: 'таймаут' });
    expect(looksBlocked('blocked.mts.ru')).toBe(true);
    expect(looksBlocked('kinozal.guru')).toBe(false);
  });

  it('error texts are Russian and name the proxy', () => {
    expect(errorText('proxy_refused')).toBe('прокси WARP: соединение отклонено');
    expect(errorText('proxy_502')).toBe('прокси WARP: HTTP 502');
    expect(errorText('http_401')).toBe('HTTP 401');
  });

  it('cleanDetail drops queries, key=value pairs and known secrets', () => {
    const s = cleanDetail('Request to https://tracker.example/rss.php?passkey=abc123&x=1 failed, apikey=' + KEY + ' token=zzz ' + RED_KEY, [RED_KEY]);
    expect(s).toBe('Request to https://tracker.example/rss.php failed, apikey=*** token=*** ***');
    expect(cleanDetail('x'.repeat(500)).length).toBe(200);
  });

  it('parses the Jackett catalog (id, title, site), skipping unconfigured and unsafe ids', () => {
    const xml =
      '<?xml version="1.0"?><indexers>' +
      '<indexer id="rutracker" configured="true"><title>RuTracker.org</title><description>x</description><link>https://rutracker.org/</link><caps/></indexer>' +
      '<indexer id="rutor" configured="true"><title><![CDATA[RuTor & Co]]></title><link>http://rutor.info/</link></indexer>' +
      '<indexer id="off" configured="false"><title>Off</title><link>https://off.example/</link></indexer>' +
      '<indexer id="../x" configured="true"><title>Bad</title></indexer>' +
      '<indexer id="nolink" configured="true"><title>No link</title><link>javascript:alert(1)</link></indexer>' +
      '</indexers>';
    expect(parseJackettIndexers(xml)).toEqual([
      { id: 'rutracker', title: 'RuTracker.org', link: 'https://rutracker.org/' },
      { id: 'rutor', title: 'RuTor & Co', link: 'http://rutor.info/' },
      { id: 'nolink', title: 'No link', link: '' },
    ]);
  });

  it('judges a Torznab feed and keeps keys out of the error text', () => {
    const ok = jackettFeedVerdict({ ok: true, status: 200, body: '<rss><channel><item>a</item><item>b</item></channel></rss>' }, []);
    expect(ok).toMatchObject({ ok: true, detail: 'результатов: 2', items: 2 });
    const err = jackettFeedVerdict({ ok: true, status: 200, body: '<error code="900" description="Request to https://x.example/s?apikey=' + KEY + ' failed (' + KEY + ')"/>' }, [KEY]);
    expect(err.ok).toBe(false);
    expect(err.detail).not.toContain(KEY);
    expect(jackettFeedVerdict({ ok: true, status: 500, body: '' }, []).detail).toBe('HTTP 500');
    expect(jackettFeedVerdict({ ok: true, status: 200, body: '<html>' }, []).detail).toBe('ответ не Torznab');
  });

  it('reads the Cloudflare trace and the JacRed date (MSK)', () => {
    expect(parseTrace('fl=1\nwarp=on\ncolo=AMS\n')).toMatchObject({ warp: 'on', colo: 'AMS' });
    expect(parseJacredDate('21.10.2026 23:10')).toBe(Date.UTC(2026, 9, 21, 20, 10));
    expect(parseJacredDate('nope')).toBe(0);
  });

  it('container verdict reads state, restarts and memory only', () => {
    const now = Date.parse('2026-10-21T20:00:00Z');
    const inspect = { State: { Status: 'running', StartedAt: '2026-10-21T17:00:00Z' }, RestartCount: 2, Config: { Env: ['BILLING_BOT_TOKEN=secret-value'] } };
    const stats = { memory_stats: { usage: 300 * 1024 * 1024, limit: 1024 * 1024 * 1024, stats: { inactive_file: 100 * 1024 * 1024 } } };
    const v = containerVerdict(inspect, stats, 2, now);
    expect(v).toEqual({ ok: true, detail: 'работает, запущен 3 ч назад, перезапусков 2, память 200 МБ из 1024 МБ', restarts: 2 });
    expect(JSON.stringify(v)).not.toContain('secret-value');
    expect(containerVerdict(inspect, stats, 1, now).ok).toBe(false);
    expect(containerVerdict(inspect, stats, 1, now).detail).toContain('перезапускался: 1 → 2');
    expect(containerVerdict({ State: { Status: 'exited' }, RestartCount: 0 }, null, undefined, now)).toMatchObject({ ok: false, detail: 'статус exited, перезапусков 0' });
    expect(containerVerdict({ State: { Status: 'running', Health: { Status: 'unhealthy' } } }, null, undefined, now).ok).toBe(false);
    expect(containerVerdict(inspect, { memory_stats: { usage: 1000, limit: 1050 } }, 2, now).ok).toBe(false);
  });
});

// ---------- buildTasks with a fake network ----------
type Res = { ok: boolean; status?: number; body?: string; headers?: Record<string, string>; error?: string };

function fakeGet(routes: (url: string, proxy: string) => Res | undefined) {
  const calls: { url: string; proxy: string }[] = [];
  const get = async (url: string, opts?: { proxy?: string }) => {
    const proxy = (opts && opts.proxy) || '';
    calls.push({ url, proxy });
    const r = routes(url, proxy);
    return { ms: 5, headers: {}, ...(r || { ok: false, error: 'refused' }) };
  };
  return { get, calls };
}

const JACKETT_XML =
  '<indexers><indexer id="rutracker" configured="true"><title>RuTracker</title><link>https://rutracker.org/</link></indexer>' +
  '<indexer id="kinozal" configured="true"><title>Kinozal</title><link>https://kinozal.tv/</link></indexer>' +
  '<indexer id="nnmclub" configured="true"><title>NNM</title><link>https://nnmclub.to/</link></indexer></indexers>';

function world(opts: { directBlocked?: string[]; warpDown?: boolean; jackettFail?: string[] } = {}) {
  return (url: string, proxy: string): Res | undefined => {
    const u = new URL(url);
    if (proxy && opts.warpDown) return { ok: false, error: 'proxy_refused' };
    if (u.hostname === 'jackett') {
      if (u.searchParams.get('t') === 'indexers') return { ok: true, status: 200, body: JACKETT_XML };
      const id = u.pathname.split('/')[4];
      if ((opts.jackettFail || []).includes(id)) return { ok: true, status: 200, body: '<error code="900" description="Cloudflare blocked"/>' };
      return { ok: true, status: 200, body: '<rss><channel><item/></channel></rss>' };
    }
    if (u.hostname === 'jacred') {
      if (u.pathname === '/lastupdatedb') return { ok: true, status: 200, body: JSON.stringify({ lastupdatedb: '21.10.2026 22:00' }) };
      if (u.pathname === '/api/v1.0/trackers') return { ok: true, status: 200, body: JSON.stringify(['rutor', 'kinozal', 'mystery']) };
      return { ok: true, status: 200, body: '<rss><channel><item/><item/></channel></rss>' };
    }
    if (u.hostname === 'docker-proxy') {
      if (u.pathname === '/containers/json') return { ok: true, status: 200, body: JSON.stringify([{ Id: 'a'.repeat(64), Names: ['/omp-jackett'] }, { Id: 'b'.repeat(64), Names: ['/omp-billing'] }]) };
      if (u.pathname.endsWith('/json')) return { ok: true, status: 200, body: JSON.stringify({ State: { Status: 'running' }, RestartCount: 0 }) };
      return { ok: true, status: 200, body: JSON.stringify({ memory_stats: { usage: 10, limit: 1000 } }) };
    }
    if (u.hostname === 'www.cloudflare.com') return proxy ? { ok: true, status: 200, body: 'warp=on\ncolo=AMS' } : { ok: true, status: 200, body: 'warp=off' };
    const site = PUBLIC_SITES.find((x) => x.url === url);
    if (site) return { ok: true, status: site.expect };
    if (!proxy && (opts.directBlocked || []).includes(u.hostname)) return { ok: false, error: 'reset' };
    return { ok: true, status: 200 };
  };
}

const SETTINGS = {
  jackettUrl: 'http://jackett:9117',
  jackettApiKey: KEY,
  jacredUrl: 'http://jacred:9117',
  jacredApiKey: RED_KEY,
  torrserverUrl: 'http://torrserver:8090',
};
const NOW = Date.parse('2026-10-21T20:00:00Z');
const okNet = async () => ({ status: 200, ok: true });

async function runWorld(opts: Parameters<typeof world>[0] = {}, extra: Record<string, unknown> = {}) {
  const { get, calls } = fakeGet(world(opts));
  const tasks = await buildTasks({
    settings: SETTINGS,
    env: { BILLING_DOCKER_PROXY_URL: 'http://docker-proxy:2375', BILLING_PG_BACKUP_DIR: '/backups/pg' },
    store: { query: async () => ({ rows: [] }) },
    backups: { status: () => ({ stale: false, lastError: '', ageSec: 3600, everyHours: 24 }) },
    net: okNet,
    get,
    statfs: async () => ({ blocks: 1000000, bsize: 4096 * 1024, bavail: 500000 }),
    now: () => NOW,
    botPoll: () => ({ enabled: true, lastOkAt: NOW - 10000, conflictRecent: false }),
    ...extra,
  });
  const rows = finalize(await runTasks(tasks, 8, 3));
  return { rows, calls, tasks };
}

describe('buildTasks', () => {
  it('checks every configured Jackett and JacRed tracker on both paths, plus the rest', async () => {
    const { rows, calls } = await runWorld();
    const ids = rows.map((r) => r.id);
    for (const id of ['rutracker', 'kinozal', 'nnmclub']) {
      expect(ids).toContain('jackett:' + id);
      expect(ids).toContain('jackett:' + id + ':direct');
      expect(ids).toContain('jackett:' + id + ':warp');
    }
    expect(ids).toEqual(expect.arrayContaining(['jacred:rutor:direct', 'jacred:rutor:warp', 'jacred:kinozal:direct', 'jacred:mystery:site', 'jacred:sync:direct', 'jacred:sync:warp']));
    expect(ids).toEqual(expect.arrayContaining(['postgres', 'backup', 'botpoll', 'disk:/data', 'disk:/backups/pg', 'warp:trace', 'svc:jackett', 'svc:jacred', 'svc:torrserver']));
    expect(ids).toEqual(expect.arrayContaining(PUBLIC_SITES.map((s) => s.id)));
    expect(ids).toEqual(expect.arrayContaining(['ct:omp-billing', 'ct:omp-jackett']));
    expect(rows.filter((r) => r.ok === false)).toEqual([]);
    // the WARP rows really go through the proxy, the direct ones do not
    expect(calls.filter((c) => c.url === 'https://rutracker.org/').map((c) => c.proxy).sort()).toEqual(['', 'http://warp:1080']);
    expect(calls.find((c) => c.url.startsWith('https://www.cloudflare.com'))!.proxy).toBe('http://warp:1080');
    // the docker proxy only gets GETs of list, inspect and stats
    expect(calls.filter((c) => c.url.startsWith('http://docker-proxy')).every((c) => /\/containers\/(json\?|[a-f0-9]{64}\/(json|stats\?))/.test(c.url))).toBe(true);
  });

  it('never puts a key into a row', async () => {
    const { rows } = await runWorld({ jackettFail: ['kinozal'] });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(RED_KEY);
  });

  it('a blocked direct path is red but does not alert; down on both paths alerts', async () => {
    const { rows } = await runWorld({ directBlocked: ['rutracker.org'] });
    const direct = rows.find((r) => r.id === 'jackett:rutracker:direct')!;
    const warp = rows.find((r) => r.id === 'jackett:rutracker:warp')!;
    expect(direct).toMatchObject({ ok: false, alert: false, detail: 'соединение сброшено' });
    expect(warp).toMatchObject({ ok: true, alert: false });
    expect(rows.find((r) => r.id === 'jackett:rutracker')!.context).toBe('сайт напрямую: соединение сброшено; через WARP: ок');

    const both = await runWorld({ directBlocked: ['rutracker.org', 'kinozal.tv', 'nnmclub.to', 'rutor.info'], warpDown: true });
    expect(both.rows.find((r) => r.id === 'jackett:rutracker:warp')).toMatchObject({ ok: false, alert: true });
    expect(both.rows.find((r) => r.id === 'warp:trace')).toMatchObject({ ok: false, alert: true, detail: 'прокси WARP: соединение отклонено' });
  });

  it('a failing Jackett search alerts with the site paths as context', async () => {
    const { rows } = await runWorld({ jackettFail: ['kinozal'] });
    expect(rows.find((r) => r.id === 'jackett:kinozal')).toMatchObject({ ok: false, alert: true, detail: 'ошибка: Cloudflare blocked', context: 'сайт напрямую: ок; через WARP: ок' });
  });

  it('without a docker proxy or keys the rows say so and do not alert', async () => {
    const { get } = fakeGet(world());
    const tasks = await buildTasks({ settings: {}, env: {}, get, net: okNet, statfs: async () => ({ blocks: 1, bsize: 1, bavail: 1 }), botPoll: () => ({ enabled: false }) });
    const rows = finalize(await runTasks(tasks, 4, 1));
    expect(rows.find((r) => r.id === 'containers')).toMatchObject({ ok: null, alert: false });
    expect(rows.find((r) => r.id === 'jackett:list')).toMatchObject({ ok: null, detail: 'Jackett не настроен' });
    expect(rows.find((r) => r.id === 'jacred:list')).toMatchObject({ ok: null });
    expect(rows.find((r) => r.id === 'botpoll')).toMatchObject({ ok: null });
    expect(rows.find((r) => r.id === 'backup')).toMatchObject({ ok: null, alert: false });
  });

  it('disk, bot poll and JacRed freshness thresholds', async () => {
    const { rows } = await runWorld(
      {},
      {
        statfs: async () => ({ blocks: 1000, bsize: 1024 * 1024, bavail: 50 }),
        botPoll: () => ({ enabled: true, lastOkAt: NOW - 600000 }),
        now: () => NOW + 10 * 3600000,
      },
    );
    expect(rows.find((r) => r.id === 'disk:/data')).toMatchObject({ ok: false });
    expect(rows.find((r) => r.id === 'botpoll')).toMatchObject({ ok: false });
    expect(rows.find((r) => r.id === 'jacred:fresh')).toMatchObject({ ok: false });
  });

  it('a list that failed is read again on the retry', async () => {
    let listCalls = 0;
    const base = world();
    const { get } = fakeGet((url, proxy) => {
      const u = new URL(url);
      if (u.hostname === 'jackett' && u.searchParams.get('t') === 'indexers') {
        listCalls += 1;
        return listCalls === 1 ? { ok: false, error: 'timeout' } : base(url, proxy);
      }
      if (u.hostname === 'jacred' && u.pathname === '/api/v1.0/trackers') return { ok: true, status: 500 };
      if (u.hostname === 'docker-proxy' && u.pathname === '/containers/json') return { ok: false, error: 'refused' };
      return base(url, proxy);
    });
    const tasks = await buildTasks({ settings: SETTINGS, env: { BILLING_DOCKER_PROXY_URL: 'http://docker-proxy:2375' }, get, net: okNet, now: () => NOW, statfs: async () => ({ blocks: 1000, bsize: 4096, bavail: 500 }), botPoll: () => ({ enabled: false }) });
    const lists = tasks.filter((t) => t.scope);
    expect(lists.map((t) => [t.id, t.scope])).toEqual([
      ['containers', 'ct:'],
      ['jackett:list', 'jackett:'],
      ['jacred:list', 'jacred:'],
    ]);
    const first = await runTasks(lists, 8, 3);
    expect(first.every((r) => r.ok === false)).toBe(true);
    const again = await runTasks(lists, 8, 3);
    const byId = Object.fromEntries(again.map((r) => [r.id, r]));
    expect(byId['jackett:list'].ok).toBe(true);
    expect(byId['jackett:list'].scope).toBe('jackett:');
    expect(byId['jacred:list']).toMatchObject({ ok: false, detail: 'HTTP 500' });
    expect(byId.containers.ok).toBe(false);
    expect(listCalls).toBe(2);
  });

  it('an empty Jackett catalog is a problem but not an unread list', async () => {
    let reads = 0;
    const base = world();
    const { get } = fakeGet((url, proxy) => {
      const u = new URL(url);
      if (u.hostname === 'jackett' && u.searchParams.get('t') === 'indexers') {
        reads += 1;
        return reads <= 2 ? { ok: true, status: 200, body: '<indexers></indexers>' } : base(url, proxy);
      }
      return base(url, proxy);
    });
    const tasks = await buildTasks({ settings: SETTINGS, env: {}, get, net: okNet, now: () => NOW, statfs: async () => ({ blocks: 1000, bsize: 4096, bavail: 500 }), botPoll: () => ({ enabled: false }) });
    const list = tasks.find((t) => t.id === 'jackett:list')!;
    expect(list.scope).toBeUndefined();
    expect(await list.run()).toMatchObject({ ok: false, detail: 'в Jackett нет настроенных трекеров' });
    // the retry reads Jackett again: still empty, then trackers added
    expect(await list.run()).toMatchObject({ ok: false, detail: 'в Jackett нет настроенных трекеров' });
    expect(await list.run()).toMatchObject({ ok: true });
    expect(reads).toBe(3);
  });

  it('runTasks keeps at most heavyLimit heavy tasks at once', async () => {
    let live = 0;
    let peak = 0;
    const tasks = Array.from({ length: 9 }, (_, i) => ({
      id: 't' + i,
      heavy: true,
      run: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 10));
        live -= 1;
        return { ok: true, detail: '', ms: 1 };
      },
    }));
    const rows = await runTasks(tasks, 8, 3);
    expect(rows).toHaveLength(9);
    expect(peak).toBe(3);
  });
});

describe('alerts', () => {
  const row = (id: string, ok: boolean | null, extra: Record<string, unknown> = {}) => ({ id, group: 'infra', name: id, ok, alert: true, detail: ok ? 'ок' : 'таймаут', ...extra });

  it('reports a problem once, keeps quiet while it lasts, and says when it is fixed', () => {
    const first = alertPlan({}, [row('postgres', false), row('disk:/data', true)], 1000);
    expect(first.problems.map((r) => r.id)).toEqual(['postgres']);
    expect(Object.keys(first.next)).toEqual(['postgres']);
    const second = alertPlan(first.next, [row('postgres', false)], 2000);
    expect(second.problems).toEqual([]);
    expect(second.recovered).toEqual([]);
    expect(second.next.postgres.since).toBe(1000);
    const third = alertPlan(second.next, [row('postgres', true)], 3000);
    expect(third.recovered).toEqual([{ id: 'postgres', text: 'postgres' }]);
    expect(third.next).toEqual({});
  });

  it('a check that is gone or no longer alert-worthy is closed', () => {
    const gone = alertPlan({ 'jackett:x': { since: 1, text: 'Jackett: X (поиск через Jackett)' } }, [], 5);
    expect(gone.recovered).toEqual([{ id: 'jackett:x', text: 'Jackett: X (поиск через Jackett)', gone: true }]);
    const partial = alertPlan({ 'jackett:x:warp': { since: 1, text: 'x' } }, [{ id: 'jackett:x:warp', group: 'jackett', name: 'X', ok: false, alert: false, pairAlert: true, detail: 'таймаут' }], 5);
    expect(partial.recovered[0]).toMatchObject({ partial: true });
  });

  it('non-alerting failures are never reported', () => {
    expect(alertPlan({}, [row('jackett:x:direct', false, { alert: false })], 1).problems).toEqual([]);
  });

  it('message texts', () => {
    const p = problemText([{ id: 'jackett:k', group: 'jackett', name: 'Kinozal', path: 'jackett', ok: false, alert: true, detail: 'таймаут', context: 'сайт напрямую: ок; через WARP: ок' }]);
    expect(p).toBe('⚠️ Мониторинг OMP: проблема (проверено дважды, с паузой 30 с)\n• Jackett: Kinozal (поиск через Jackett): таймаут (сайт напрямую: ок; через WARP: ок)');
    expect(recoveredText([{ id: 'a', text: 'Postgres' }, { id: 'b', text: 'X', gone: true }])).toBe('✅ Мониторинг OMP: починилось\n• Postgres\n• X: больше не проверяется');
    for (const t of [p]) expect(t).not.toMatch(/[\u2013\u2014]/);
  });

  it('a long list goes in several messages, every check in one of them', () => {
    const many = Array.from({ length: 200 }, (_, i) => row('check-' + i + '-' + 'z'.repeat(40), false));
    const msgs = problemMessages(many);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.text.length).toBeLessThan(4096);
      expect(m.text).not.toMatch(/[\u2013\u2014]/);
    }
    expect(msgs[0].text.split('\n')[0]).toContain('(1/' + msgs.length + ')');
    expect(msgs.flatMap((m) => m.items)).toEqual(many.map((_, i) => i));
    expect(msgs.map((m) => m.text).join('\n')).toContain('check-199-');
  });

  it('a list that could not be read keeps its rows alerted, without «починилось»', () => {
    const prev = { 'jackett:kinozal': { since: 1, text: 'Kinozal' }, 'ct:omp-jacred': { since: 1, text: 'omp-jacred' } };
    const listRow = { ...row('jackett:list', false), scope: 'jackett:' };
    const plan = alertPlan(prev, [listRow], 5);
    expect(plan.recovered.map((r) => r.id)).toEqual(['ct:omp-jacred']);
    expect(plan.next['jackett:kinozal']).toEqual(prev['jackett:kinozal']);
    // read again on the retry: still not checked, still kept
    expect(alertPlan(prev, [{ ...listRow, ok: true }], 5).next['jackett:kinozal']).toBeTruthy();
    // read fine on a later run, tracker gone from Jackett: closed
    expect(alertPlan(prev, [row('jackett:other', true)], 5).recovered.map((r) => r.id)).toContain('jackett:kinozal');
  });

  it('settings helpers', () => {
    expect(validInterval('15')).toBe(15);
    expect(validInterval(4)).toBeNull();
    expect(validInterval('1441')).toBeNull();
    expect(validInterval('7.5')).toBeNull();
    expect(monitorChatId({})).toBe('536445442');
    expect(monitorChatId({ BILLING_MONITOR_CHAT_ID: '123' })).toBe('123');
    expect(monitorChatId({ BILLING_MONITOR_CHAT_ID: '@chan' })).toBe('536445442');
    expect(monitorEnabled({})).toBe(true);
    expect(monitorEnabled({ BILLING_MONITOR: '0' })).toBe(false);
  });

  it('history strip: 168 hourly cells, newest right', () => {
    const now = 1000 * 3600000 + 5;
    const s = historyStrip([{ h: 1000, allOk: false }, { h: 999, allOk: true }, { h: 500, allOk: true }], now);
    expect(s).toHaveLength(168);
    expect(s.slice(-2)).toBe('gr');
    expect(s.slice(0, -2)).toBe('-'.repeat(166));
  });
});
