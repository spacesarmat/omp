/** Admin desk routes and POST /v1/presence. Returns true when the request was answered. */
import { publishAdmin, resetAdminLive, sseHeartbeat, SSE_HEADERS, subscribeAdmin } from './adminLive.mjs';
import {
  addCredit,
  applyRollback,
  buildHealth,
  confirmed,
  containerName,
  cpuPercent,
  dailyWindow,
  deviceKey,
  deviceTable,
  diskRatio,
  errorCount,
  findRollback,
  funnelView,
  hourlyPayments,
  ingestPresence,
  memBytes,
  onlineCount,
  parsePresence,
  rankingView,
  recordProbes,
  redactText,
  restartAllowed,
  revenueView,
  roleOf,
  searchDesk,
  setWatchFlag,
  sourceStats,
  usersFrom,
} from './desk.mjs';
import { dailySeries } from './logic.mjs';
import { monitorEnv } from './monitorChecks.mjs';
import { probeAllServices } from './services.mjs';

const hits = new Map();
let probeCache = { at: 0, value: null };

export function resetDeskHttp() {
  hits.clear();
  probeCache = { at: 0, value: null };
  resetAdminLive();
}

function allowRate(key, now, limit, windowMs) {
  const prev = hits.get(key) || [];
  const arr = prev.filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

async function cachedProbes(settings, net) {
  const now = Date.now();
  if (probeCache.value && now - probeCache.at < 30000) return probeCache.value;
  const value = await probeAllServices(settings, net);
  probeCache = { at: now, value };
  return value;
}

function want(path) {
  return (
    path === '/admin/api/events' ||
    path === '/admin/api/desk' ||
    path === '/admin/api/search' ||
    path === '/admin/api/nuc' ||
    path === '/admin/api/nuc/logs' ||
    path === '/admin/api/nuc/restart' ||
    path === '/admin/api/sources/check' ||
    path === '/admin/api/sources/toggle' ||
    path === '/admin/api/credit' ||
    path === '/admin/api/rollback' ||
    path === '/admin/api/rank/pin' ||
    path === '/v1/presence'
  );
}

export async function handleDesk(ctx) {
  const path = ctx.path;
  if (!want(path)) return false;
  const { req, res } = ctx;
  if (path === '/admin/api/events' && req.method === 'GET') return openEvents(ctx);
  if (path === '/v1/presence' && req.method === 'POST') return presence(ctx);
  const admin = ctx.adminOf(req);
  if (!admin) {
    ctx.json(res, 401, { auth: false });
    return true;
  }
  if (req.method === 'GET' && path === '/admin/api/desk') return sendDesk(ctx, admin);
  if (req.method === 'GET' && path === '/admin/api/search') return sendSearch(ctx);
  if (req.method === 'GET' && path === '/admin/api/nuc') return sendNuc(ctx);
  if (req.method === 'GET' && path === '/admin/api/nuc/logs') return sendLogs(ctx);
  if (req.method !== 'POST') {
    ctx.json(res, 405, { ok: false, error: 'method' });
    return true;
  }
  const body = await ctx.readBody(req);
  if (body.csrf !== admin.csrf) {
    ctx.json(res, 403, { ok: false, error: 'forbidden' });
    return true;
  }
  const state = await ctx.store.read();
  const role = roleOf(state.settings, admin);
  if (role !== 'full') {
    ctx.json(res, 403, { ok: false, error: 'Режим только просмотра' });
    return true;
  }
  if (ctx.readOnly) {
    ctx.json(res, 503, { ok: false, error: 'read_only' });
    return true;
  }
  if (path === '/admin/api/sources/check') return checkSources(ctx, admin, state);
  if (path === '/admin/api/sources/toggle') return toggleSource(ctx, admin, body);
  if (path === '/admin/api/credit') return credit(ctx, admin, body);
  if (path === '/admin/api/rollback') return rollback(ctx, admin, body);
  if (path === '/admin/api/rank/pin') return pinRank(ctx, admin, body);
  if (path === '/admin/api/nuc/restart') return restartContainer(ctx, admin, body);
  ctx.json(res, 404, { ok: false, error: 'not_found' });
  return true;
}

function openEvents(ctx) {
  const admin = ctx.adminOf(ctx.req);
  if (!admin) {
    ctx.json(ctx.res, 401, { auth: false });
    return true;
  }
  const res = ctx.res;
  res.writeHead(200, SSE_HEADERS);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(sseHeartbeat());
  const drop = subscribeAdmin((chunk) => {
    try {
      res.write(chunk);
    } catch {
      /* closed */
    }
  });
  const timer = setInterval(() => {
    try {
      res.write(sseHeartbeat());
    } catch {
      /* closed */
    }
  }, 15000);
  const stop = () => {
    clearInterval(timer);
    drop();
  };
  ctx.req.on('close', stop);
  res.on('close', stop);
  return true;
}

async function sendDesk(ctx, admin) {
  const state = await ctx.store.read();
  const now = Date.now();
  let probes = null;
  try {
    probes = await cachedProbes(state.settings, ctx.net);
  } catch {
    probes = null;
  }
  let registry = null;
  if (ctx.store.registry && typeof ctx.store.registry.activeRowsByCode === 'function') {
    try {
      registry = await ctx.store.registry.activeRowsByCode();
    } catch {
      registry = null;
    }
  }
  const devices = deviceTable(state, registry, state.deskVersions, now);
  const series = dailySeries(state, now, 30);
  const hours = hourlyPayments(state, now);
  const disk = await diskRatio(monitorEnv(ctx.env).diskPaths);
  ctx.json(ctx.res, 200, {
    ok: true,
    role: roleOf(state.settings, admin),
    csrf: admin.csrf,
    asOf: now,
    health: buildHealth(probes, state.deskSources),
    online: onlineCount(devices),
    devices,
    users: usersFrom(state, now),
    errors: errorCount(state, now),
    spark24: hours.map((r) => ({ t: r.t, v: Math.round(r.v), n: r.n })),
    spark7: dailyWindow(series, 7).map((r) => ({ t: r.t, v: Math.round(r.v) })),
    sources: sourceBlock(state, probes),
    ranking: rankingView(state),
    cache: {
      enabled: !!(state.settings && state.settings.cacheNodesEnabled),
      note: 'Узлы, диск и закрепления на экране Кэш',
    },
    funnel: funnelView(state, now),
    revenue: revenueView(state, series, now),
    disk: disk ? { path: disk.path, free: disk.free, total: disk.total, ratio: Math.round(disk.ratio * 1000) / 10 } : null,
    rollbacks: (state.deskRollbacks || []).slice(-20).reverse().map((r) => ({ id: r.id, at: r.at })),
  });
  return true;
}

function sourceBlock(state, probes) {
  const keys = ['jackett', 'jacred', 'bitmagnet', 'torrserver'];
  return keys.map((key) => {
    const probe = probes && probes[key];
    const stat = sourceStats(state.deskSources && state.deskSources[key], probe);
    return {
      name: key,
      ...stat,
      enabled: probe ? probe.enabled !== false && (key !== 'bitmagnet' || probe.enabled === true) : key !== 'bitmagnet',
      configured: probe ? !!probe.configured : false,
      url: probe && probe.url ? probe.url : '',
    };
  });
}

async function sendSearch(ctx) {
  const state = await ctx.store.read();
  const now = Date.now();
  let registry = null;
  if (ctx.store.registry && typeof ctx.store.registry.activeRowsByCode === 'function') {
    try {
      registry = await ctx.store.registry.activeRowsByCode();
    } catch {
      registry = null;
    }
  }
  const devices = deviceTable(state, registry, state.deskVersions, now);
  const q = ctx.url.searchParams.get('q') || '';
  ctx.json(ctx.res, 200, { ok: true, hits: searchDesk(state, devices, q) });
  return true;
}

async function sendNuc(ctx) {
  const env = monitorEnv(ctx.env);
  const disk = await diskRatio(env.diskPaths);
  const docker = await readDocker(env, ctx.net);
  ctx.json(ctx.res, 200, {
    ok: true,
    disk: disk ? { path: disk.path, free: disk.free, total: disk.total, ratio: Math.round(disk.ratio * 1000) / 10 } : null,
    ...docker,
    restart: !!String((ctx.env && ctx.env.BILLING_DOCKER_RESTART_URL) || '').trim(),
    allow: ['omp-jackett', 'omp-jacred', 'omp-torrserver', 'omp-flaresolverr', 'omp-bitmagnet'],
  });
  return true;
}

async function readDocker(env, net) {
  if (!env.dockerProxy) return { configured: false, host: null, containers: [], error: 'нет BILLING_DOCKER_PROXY_URL' };
  try {
    const filters = encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=' + env.composeProject] }));
    const list = await dockerJson(net, env.dockerProxy + '/containers/json?all=1&filters=' + filters);
    let host = null;
    try {
      const info = await dockerJson(net, env.dockerProxy + '/info');
      host = { cpus: Number(info.NCPU) || 0, mem: Number(info.MemTotal) || 0 };
    } catch {
      host = null;
    }
    const containers = [];
    const rows = Array.isArray(list) ? list.slice(0, 40) : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = containerName(row);
      let cpu = null;
      let mem = null;
      try {
        const stats = await dockerJson(net, env.dockerProxy + '/containers/' + row.Id + '/stats?stream=false&one-shot=true');
        cpu = cpuPercent(stats);
        mem = memBytes(stats);
      } catch {
        /* stats are optional */
      }
      containers.push({
        id: String(row.Id || '').slice(0, 12),
        name,
        state: row.State || '',
        status: row.Status || '',
        cpu,
        mem,
        restart: restartAllowed(name),
      });
    }
    return { configured: true, host, containers, error: '' };
  } catch (e) {
    return { configured: true, host: null, containers: [], error: 'docker' };
  }
}

async function dockerJson(net, url) {
  const res = await net(url, { headers: { accept: 'application/json' } });
  const text = typeof res.text === 'function' ? await res.text() : '';
  if (!res.ok && res.status !== 200) throw new Error('http');
  return JSON.parse(text || 'null');
}

async function sendLogs(ctx) {
  const name = String(ctx.url.searchParams.get('name') || '');
  if (!restartAllowed(name)) {
    ctx.json(ctx.res, 400, { ok: false, error: 'Этот контейнер нельзя читать из панели' });
    return true;
  }
  const env = monitorEnv(ctx.env);
  if (!env.dockerProxy) {
    ctx.json(ctx.res, 200, { ok: false, error: 'нет BILLING_DOCKER_PROXY_URL', lines: '' });
    return true;
  }
  try {
    const res = await ctx.net(env.dockerProxy + '/containers/' + encodeURIComponent(name) + '/logs?stdout=1&stderr=1&tail=40', {});
    const text = typeof res.text === 'function' ? await res.text() : '';
    ctx.json(ctx.res, 200, { ok: !!res.ok, lines: redactText(text) });
  } catch {
    ctx.json(ctx.res, 200, { ok: false, error: 'логи недоступны', lines: '' });
  }
  return true;
}

async function restartContainer(ctx, admin, body) {
  if (!confirmed(body)) {
    ctx.json(ctx.res, 409, { ok: false, error: 'Нужно подтверждение', needConfirm: true });
    return true;
  }
  const name = String(body.name || '').replace(/^\//, '');
  if (!restartAllowed(name)) {
    ctx.json(ctx.res, 400, { ok: false, error: 'Перезапуск этого контейнера запрещён' });
    return true;
  }
  const base = String((ctx.env && ctx.env.BILLING_DOCKER_RESTART_URL) || '').trim().replace(/\/+$/, '');
  if (!base) {
    ctx.json(ctx.res, 200, { ok: false, error: 'Перезапуск не настроен (BILLING_DOCKER_RESTART_URL)' });
    return true;
  }
  try {
    const res = await ctx.net(base + '/restart?name=' + encodeURIComponent(name), { method: 'POST' });
    const ok = !!(res && (res.ok || res.status === 204 || res.status === 200));
    await ctx.audit('nuc_restart', name + (ok ? ' ok' : ' fail'), admin);
    publishAdmin({ type: 'nuc', name });
    ctx.json(ctx.res, 200, { ok, error: ok ? '' : 'docker отказал' });
  } catch {
    ctx.json(ctx.res, 200, { ok: false, error: 'docker недоступен' });
  }
  return true;
}

async function checkSources(ctx, admin, state) {
  const probes = await probeAllServices(state.settings, ctx.net);
  probeCache = { at: Date.now(), value: probes };
  await ctx.store.update((cur) => ({ state: recordProbes(cur, probes, Date.now()) }));
  await ctx.audit('sources_check', 'ok', admin);
  publishAdmin({ type: 'source' });
  ctx.json(ctx.res, 200, { ok: true, health: buildHealth(probes, (await ctx.store.read()).deskSources) });
  return true;
}

async function toggleSource(ctx, admin, body) {
  const key = String(body.source || '');
  const map = { jackett: 'jackettEnabled', jacred: 'jacredEnabled', bitmagnet: 'bitmagnetEnabled' };
  const field = map[key];
  if (!field) {
    ctx.json(ctx.res, 400, { ok: false, error: 'Неизвестный источник' });
    return true;
  }
  const enabled = body.enabled === true || body.enabled === 'true' || body.enabled === '1';
  if (!enabled && !confirmed(body)) {
    ctx.json(ctx.res, 409, { ok: false, error: 'Выключение нужно подтвердить', needConfirm: true });
    return true;
  }
  await ctx.store.update((cur) => ({
    state: { ...cur, settings: { ...cur.settings, [field]: enabled } },
  }));
  probeCache = { at: 0, value: null };
  await ctx.audit('source_toggle', key + ' ' + (enabled ? 'on' : 'off'), admin);
  publishAdmin({ type: 'source', name: key });
  ctx.json(ctx.res, 200, { ok: true, source: key, enabled });
  return true;
}

async function credit(ctx, admin, body) {
  if (!confirmed(body)) {
    ctx.json(ctx.res, 409, { ok: false, error: 'Нужно подтверждение', needConfirm: true });
    return true;
  }
  const out = await ctx.store.update((cur) => addCredit(cur, { accountId: body.accountId, rub: body.rub, now: Date.now(), actor: null }));
  if (!out || out.error) {
    ctx.json(ctx.res, 200, { ok: false, error: (out && out.error) || 'fail' });
    return true;
  }
  publishAdmin({ type: 'audit', action: 'credit' });
  ctx.json(ctx.res, 200, { ok: true, creditRub: out.creditRub });
  return true;
}

async function rollback(ctx, admin, body) {
  if (!confirmed(body)) {
    ctx.json(ctx.res, 409, { ok: false, error: 'Нужно подтверждение', needConfirm: true });
    return true;
  }
  const id = String(body.id || '');
  const state = await ctx.store.read();
  const row = findRollback(state, id);
  if (!row) {
    ctx.json(ctx.res, 404, { ok: false, error: 'Снимок не найден' });
    return true;
  }
  await ctx.store.update((cur) => ({
    state: { ...cur, settings: applyRollback(cur.settings, row.before) },
  }));
  await ctx.audit('settings_rollback', id, admin);
  publishAdmin({ type: 'audit', action: 'settings_rollback' });
  ctx.json(ctx.res, 200, { ok: true });
  return true;
}

async function pinRank(ctx, admin, body) {
  if (!confirmed(body)) {
    ctx.json(ctx.res, 409, { ok: false, error: 'Нужно подтверждение', needConfirm: true });
    return true;
  }
  const out = await ctx.store.update((cur) => setWatchFlag(cur, { infohash: body.infohash, flag: body.flag === 'ban' ? 'ban' : 'pin', on: body.on !== false }));
  if (!out || out.error) {
    const gone = out && out.error === 'unavailable';
    ctx.json(ctx.res, gone ? 409 : 200, {
      ok: false,
      error: gone ? 'Подбор раздач ещё не включён' : (out && out.error) || 'fail',
      available: !gone,
    });
    return true;
  }
  await ctx.audit('rank_' + (body.flag === 'ban' ? 'ban' : 'pin'), String(body.infohash || '').slice(0, 16), admin);
  publishAdmin({ type: 'rank' });
  ctx.json(ctx.res, 200, { ok: true });
  return true;
}

async function presence(ctx) {
  const body = await ctx.readBody(ctx.req);
  const parsed = parsePresence(body);
  const device = String(ctx.req.headers['x-device-id'] || body.deviceId || '');
  const token = String(ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const now = Date.now();
  const ip = ctx.clientIp ? ctx.clientIp(ctx.req) : '';
  const state = await ctx.store.read();
  let accountId = '';
  let rowId = '';
  if (token) {
    const caller = await ctx.deviceCaller(state, token, device, now);
    if (!caller || caller.error) {
      ctx.json(ctx.res, 401, { error: (caller && caller.error) || 'bad_token' });
      return true;
    }
    rowId = caller.rowId || '';
    const sub = state.subscriptions.find((s) => caller.code && s.id === caller.code.subscriptionId);
    accountId = sub ? sub.accountId : '';
  } else {
    const onlyInstall = parsed.events.length === 1 && parsed.events[0] === 'install';
    if (!onlyInstall || !parsed.diagnostics) {
      ctx.json(ctx.res, 401, { error: 'token_required' });
      return true;
    }
  }
  const rateKey = token ? 'd:' + deviceKey(device) : 'ip:' + ip;
  if (!allowRate(rateKey, now, token ? 30 : 6, 60 * 1000)) {
    ctx.json(ctx.res, 429, { error: 'rate' });
    return true;
  }
  if (rowId && ctx.noteSeen) await ctx.noteSeen(rowId, ip, false);
  if (!ctx.readOnly && (parsed.diagnostics || parsed.events.length)) {
    await ctx.store.update((cur) => ({
      state: ingestPresence(cur, { ...parsed, key: deviceKey(device || ip), accountId }, now),
    }));
  }
  publishAdmin({ type: 'device' });
  ctx.json(ctx.res, 200, { ok: true });
  return true;
}
