/**
 * What the «Мониторинг» tab checks. buildTasks() first lists what exists (the Jackett and JacRed trackers,
 * the compose containers), then each task runs on its own, so a failed one can be retried alone.
 * A task result: { ok: true | false | null (info, not judged), detail, ms }.
 *
 * Keys stay on the server: the Jackett and JacRed API keys go only into requests to those containers on
 * the internal network; a detail text never holds a URL query or a key (cleanDetail).
 */
import { statfs } from 'node:fs/promises';
import { jackettIndexerSearchUrl, jackettSearchUrl, jackettTorznabIndexersUrl } from './jackett.mjs';
import { probeService } from './services.mjs';
import { botPollSnapshot } from './botPoll.mjs';
import { monitorGet } from './monitorHttp.mjs';

export const WARP_PROXY_DEFAULT = 'http://warp:1080';
export const JACKETT_SEARCH_TIMEOUT_MS = 45000;
export const SITE_TIMEOUT_MS = 15000;
export const DISK_MIN_FREE_RATIO = 0.1;
export const DISK_MIN_FREE_BYTES = 2 * 1024 ** 3;
export const MEM_MAX_RATIO = 0.9;
export const BOT_POLL_MAX_AGE_SEC = 180;
export const JACRED_MAX_AGE_HOURS = 6;
export const COMPOSE_PROJECT_DEFAULT = 'omp-vps';
export const JACRED_PROBE_QUERY = 'Война миров';

export const GROUPS = [
  ['infra', 'Инфраструктура'],
  ['services', 'Сервисы во внутренней сети'],
  ['sites', 'Публичные сайты'],
  ['containers', 'Контейнеры'],
  ['jackett', 'Трекеры Jackett'],
  ['jacred', 'JacRed'],
];

/** Public pages and the status each must answer. */
export const PUBLIC_SITES = [
  { id: 'site:landing', name: 'omp-player.online', url: 'https://omp-player.online/', expect: 200 },
  { id: 'site:billing', name: 'billing.omp-player.online/admin/', url: 'https://billing.omp-player.online/admin/', expect: 200 },
  { id: 'site:jackett', name: 'jackett.omp-player.online', url: 'https://jackett.omp-player.online/', expect: 401 },
  { id: 'site:jacred', name: 'jacred.omp-player.online', url: 'https://jacred.omp-player.online/', expect: 401 },
];

/** Site of each JacRed tracker slug (jacred-fdb defaults; our init.yaml does not change them). */
export const JACRED_TRACKER_SITES = {
  rutracker: 'https://rutracker.org/',
  rutor: 'http://rutor.info/',
  kinozal: 'https://kinozal.guru/',
  nnmclub: 'https://nnmclub.to/',
  megapeer: 'http://megapeer.vip/',
  bitru: 'https://bitru.org/',
  toloka: 'https://toloka.to/',
  mazepa: 'https://mazepa.to/',
  lostfilm: 'https://www.lostfilm.tv/',
  baibako: 'http://baibako.tv/',
  torrentby: 'https://torrent.by/',
  selezen: 'https://use.selezen.club/',
  animelayer: 'https://animelayer.ru/',
  anidub: 'https://tr.anidub.com/',
  anistar: 'https://anistar.org/',
  anibelka: 'https://anibelka.com/',
  aniliberty: 'https://aniliberty.top/',
  anifilm: 'https://anifilm.pro/',
  leproduction: 'https://www.le-production.online/',
  viruseproject: 'https://viruseproject.tv/',
  korsars: 'https://korsars.pro/',
  ultradox: 'https://ultradox.vip/',
  knaben: 'https://api.knaben.org/',
  rudub: 'https://r4.rudub.world/',
  subsplease: 'https://subsplease.org/',
};

export const JACRED_SYNC_URL = 'https://sync.jacred.stream/sync/conf';
export const CF_TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

const ERROR_TEXT = {
  dns: 'DNS не находит адрес',
  refused: 'соединение отклонено',
  reset: 'соединение сброшено',
  timeout: 'таймаут',
  tls: 'ошибка TLS',
  unreachable: 'сеть недоступна',
  bad_url: 'неверный адрес',
  down: 'нет ответа',
};

/** Russian text for a monitorGet / probe error kind. */
export function errorText(kind) {
  const k = String(kind || 'down');
  if (k.indexOf('proxy_') === 0) {
    const rest = k.slice(6);
    return 'прокси WARP: ' + (ERROR_TEXT[rest] || (/^\d+$/.test(rest) ? 'HTTP ' + rest : rest));
  }
  if (/^http_\d+$/.test(k)) return 'HTTP ' + k.slice(5);
  return ERROR_TEXT[k] || k;
}

/**
 * A detail line safe to store and show: no URL query strings, no key=value secrets, none of `secrets`
 * verbatim, one line, at most 200 characters.
 */
export function cleanDetail(text, secrets) {
  let s = String(text == null ? '' : text);
  for (const v of secrets || []) {
    const key = String(v || '');
    if (key.length >= 4) s = s.split(key).join('***');
  }
  s = s
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1')
    .replace(/\b(api_?key|passkey|key|token|password|passwd|pass|secret|auth)=([^&\s"'<>]+)/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 200 ? s.slice(0, 199) + '…' : s;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function baseHost(h) {
  return String(h || '').toLowerCase().replace(/^www\./, '');
}

/** A redirect that looks like an ISP block page: an IP literal or a host named like a block notice. */
export function looksBlocked(locHost) {
  const h = String(locHost || '').toLowerCase();
  if (!h) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') >= 0) return true;
  return /(^|[.-])(warning|blocked|block|blocklist|zapret|rkn|eais|stop|forbidden)([.-]|$)/.test(h);
}

/**
 * Verdict on a tracker site answer: any HTTP answer below 500 means reachable (a Cloudflare challenge too);
 * a redirect to a block page, a 5xx or no answer does not.
 */
export function siteVerdict(res, url) {
  if (!res || !res.ok) return { ok: false, detail: errorText(res && res.error) };
  const s = Number(res.status) || 0;
  const h = res.headers || {};
  if (s >= 300 && s < 400 && h.location) {
    let loc = '';
    try {
      loc = new URL(h.location, url).hostname.toLowerCase();
    } catch (e) {
      loc = '';
    }
    const host = baseHost(hostOf(url));
    const to = baseHost(loc);
    if (loc && to !== host && !to.endsWith('.' + host) && !host.endsWith('.' + to)) {
      if (looksBlocked(loc)) return { ok: false, detail: 'редирект на страницу блокировки (' + loc + ')' };
      return { ok: true, detail: 'HTTP ' + s + ', редирект на ' + loc };
    }
    return { ok: true, detail: 'HTTP ' + s };
  }
  const challenge = h['cf-mitigated'] === 'challenge' || ((s === 403 || s === 503) && /cloudflare/i.test(h.server || ''));
  if (challenge) return { ok: true, detail: 'HTTP ' + s + ', проверка Cloudflare' };
  if (s >= 500) return { ok: false, detail: 'HTTP ' + s };
  return { ok: true, detail: 'HTTP ' + s };
}

/** key=value lines of a Cloudflare trace. */
export function parseTrace(body) {
  const out = {};
  for (const line of String(body || '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Configured Jackett trackers from the Torznab catalog (t=indexers): [{ id, title, link }]. */
export function parseJackettIndexers(xml) {
  const text = String(xml || '');
  const out = [];
  const re = /<indexer\b([^>]*)>([\s\S]*?)<\/indexer>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1] || '';
    if (/\bconfigured\s*=\s*["']false["']/i.test(attrs)) continue;
    const idm = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!idm || !/^[A-Za-z0-9._~-]{1,80}$/.test(idm[1]) || idm[1] === 'all') continue;
    if (out.some((x) => x.id === idm[1])) continue;
    const inner = m[2] || '';
    const title = decodeXml((/<title>([\s\S]*?)<\/title>/i.exec(inner) || [])[1] || idm[1]);
    const link = decodeXml((/<link>([\s\S]*?)<\/link>/i.exec(inner) || [])[1] || '');
    out.push({ id: idm[1], title: (title || idm[1]).slice(0, 80), link: /^https?:\/\/[^\s]+$/i.test(link) ? link : '' });
  }
  return out;
}

/** Verdict on a Torznab search answer (one Jackett tracker, or JacRed). */
export function jackettFeedVerdict(res, secrets, maxBytes) {
  if (!res || !res.ok) return { ok: false, detail: errorText(res && res.error) };
  const body = String(res.body || '');
  if (res.status < 200 || res.status >= 300) return { ok: false, detail: 'HTTP ' + res.status };
  const err = /<error\b[^>]*\bdescription\s*=\s*"([^"]*)"/i.exec(body) || /<error\b[^>]*\bdescription\s*=\s*'([^']*)'/i.exec(body);
  if (err && !/<item\b/i.test(body)) return { ok: false, detail: cleanDetail('ошибка: ' + decodeXml(err[1]), secrets) };
  if (!/<rss\b|<channel\b/i.test(body)) return { ok: false, detail: 'ответ не Torznab' };
  const items = (body.match(/<item\b/gi) || []).length;
  const cut = Buffer.byteLength(body) >= (maxBytes || 64 * 1024);
  return { ok: true, detail: 'результатов: ' + items + (cut ? '+' : ''), items };
}

/** JacRed /lastupdatedb («dd.MM.yyyy HH:mm», container time = MSK) as epoch ms, 0 if unreadable. */
export function parseJacredDate(text) {
  const m = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(String(text || ''));
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]) - 3, Number(m[5]));
}

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 1024) + ' МБ';
}

function gb(bytes) {
  return ((Number(bytes) || 0) / 1024 ** 3).toFixed(1) + ' ГБ';
}

export function sinceText(ms, now) {
  const sec = Math.max(0, Math.floor((now - ms) / 1000));
  if (sec < 120) return sec + ' с';
  if (sec < 7200) return Math.floor(sec / 60) + ' мин';
  if (sec < 172800) return Math.floor(sec / 3600) + ' ч';
  return Math.floor(sec / 86400) + ' дн';
}

function timed(fn) {
  return async () => {
    const t = Date.now();
    try {
      const r = await fn();
      return { ms: Date.now() - t, ...r };
    } catch (e) {
      return { ok: false, detail: 'ошибка проверки', ms: Date.now() - t };
    }
  };
}

function info(detail) {
  return async () => ({ ok: null, detail, ms: 0 });
}

/**
 * A list (containers, Jackett or JacRed trackers) that could not be read. The first run reports the captured
 * error; the 30 s retry reads the list again. `scope` is the id prefix of the rows the list would have made:
 * while this row exists, their alert state is kept (they were not checked, so nothing recovered).
 */
function listFailed(row, detail, reread) {
  let tries = 0;
  return {
    ...row,
    run: async () => {
      tries += 1;
      if (tries === 1) return { ok: false, detail, ms: 0 };
      const started = Date.now();
      let why = '';
      try {
        why = await reread();
      } catch (e) {
        why = errorText(e && e.kind);
      }
      if (why) return { ok: false, detail: why, ms: Date.now() - started };
      return { ok: true, detail: 'прочитан со второй попытки, проверка по списку - в следующий раз', ms: Date.now() - started };
    },
  };
}

/** Monitor settings from the environment (names documented in ops/vps/.env.example). */
export function monitorEnv(env) {
  const src = env || process.env;
  const via = String(src.BILLING_MONITOR_SITES_VIA || 'direct').trim().toLowerCase();
  return {
    warpProxy: String(src.BILLING_MONITOR_WARP_PROXY || WARP_PROXY_DEFAULT).trim(),
    dockerProxy: String(src.BILLING_DOCKER_PROXY_URL || '').trim().replace(/\/+$/, ''),
    composeProject: String(src.BILLING_MONITOR_COMPOSE_PROJECT || COMPOSE_PROJECT_DEFAULT).trim(),
    sitesViaWarp: via === 'warp',
    diskPaths: Array.from(new Set(['/data', String(src.BILLING_PG_BACKUP_DIR || '').trim()].filter(Boolean))),
  };
}

/** Two rows for one tracker site: direct (never alerts alone) and through WARP (alerts when both fail). */
function sitePair(out, group, idBase, name, url, cfg, get) {
  if (!url) {
    out.push({ id: idBase + ':site', group, name, path: 'direct', alert: false, run: info('адрес сайта неизвестен') });
    return;
  }
  const target = hostOf(url);
  out.push({
    id: idBase + ':direct',
    group,
    name,
    path: 'direct',
    target,
    alert: false,
    pair: idBase,
    run: timed(async () => siteVerdict(await get(url, { timeoutMs: SITE_TIMEOUT_MS }), url)),
  });
  out.push({
    id: idBase + ':warp',
    group,
    name,
    path: 'warp',
    target,
    alert: false,
    pairAlert: true,
    pair: idBase,
    run: timed(async () => siteVerdict(await get(url, { proxy: cfg.warpProxy, timeoutMs: SITE_TIMEOUT_MS }), url)),
  });
}

async function dockerJson(cfg, get, path) {
  const r = await get(cfg.dockerProxy + path, { timeoutMs: 10000, maxBytes: 4 * 1024 * 1024 });
  if (!r.ok) throw Object.assign(new Error('docker'), { kind: r.error });
  if (r.status !== 200) throw Object.assign(new Error('docker'), { kind: 'http_' + r.status });
  return JSON.parse(r.body);
}

/**
 * One container from docker inspect + stats. Only State, RestartCount and memory are read: the inspect
 * body also has the container env (secrets), and it is never stored, logged or returned.
 */
export function containerVerdict(inspect, stats, prevRestarts, now) {
  const st = (inspect && inspect.State) || {};
  const restarts = Number(inspect && inspect.RestartCount) || 0;
  const status = String(st.Status || 'unknown');
  const health = st.Health && st.Health.Status ? String(st.Health.Status) : '';
  const parts = [];
  let ok = status === 'running';
  parts.push(status === 'running' ? 'работает' : 'статус ' + status);
  if (status === 'running' && st.StartedAt) {
    const at = Date.parse(st.StartedAt);
    if (at) parts.push('запущен ' + sinceText(at, now) + ' назад');
  }
  if (health) {
    parts.push('health ' + health);
    if (health === 'unhealthy') ok = false;
  }
  if (st.OOMKilled) {
    ok = false;
    parts.push('убит по памяти (OOM)');
  }
  const prev = prevRestarts === undefined || prevRestarts === null ? NaN : Number(prevRestarts);
  if (Number.isFinite(prev) && restarts > prev) {
    ok = false;
    parts.push('перезапускался: ' + prev + ' → ' + restarts);
  } else {
    parts.push('перезапусков ' + restarts);
  }
  const m = stats && stats.memory_stats;
  if (m && m.usage) {
    const x = m.stats || {};
    const cache = Number(x.inactive_file ?? x.total_inactive_file ?? x.cache ?? 0) || 0;
    const used = Math.max(0, Number(m.usage) - cache);
    const limit = Number(m.limit) || 0;
    parts.push('память ' + mb(used) + (limit ? ' из ' + mb(limit) : ''));
    if (limit && used / limit > MEM_MAX_RATIO) {
      ok = false;
      parts.push('больше ' + Math.round(MEM_MAX_RATIO * 100) + '% лимита');
    }
  }
  return { ok, detail: parts.join(', '), restarts };
}

/**
 * Every task of one run. ctx: { settings, env, store, backups, net (fetch for the service probes),
 * get (monitorGet), statfs, now, botPoll, restarts (RestartCount per container from the last run) }.
 * A listing that fails becomes a failed row of its own.
 */
export async function buildTasks(ctx) {
  const c = ctx || {};
  const s = c.settings || {};
  const cfg = monitorEnv(c.env);
  const get = c.get || monitorGet;
  const net = c.net || fetch;
  const fsStat = c.statfs || statfs;
  const now = () => (c.now ? c.now() : Date.now());
  const secrets = [s.jackettApiKey, s.jacredApiKey, s.indexerPass, s.botToken].filter(Boolean);
  const out = [];

  // ---- infrastructure ----
  if (c.store && typeof c.store.query === 'function') {
    out.push({
      id: 'postgres',
      group: 'infra',
      name: 'Postgres',
      path: 'internal',
      alert: true,
      run: timed(async () => {
        await c.store.query('SELECT 1');
        return { ok: true, detail: 'отвечает' };
      }),
    });
  }
  out.push({
    id: 'backup',
    group: 'infra',
    name: 'Бэкап Postgres',
    alert: !!c.backups,
    run: timed(async () => {
      if (!c.backups) return { ok: null, detail: 'бэкапы выключены (нет BILLING_PG_BACKUP_DIR)' };
      const st = c.backups.status(s);
      const ok = !st.stale && !st.lastError;
      if (st.lastError) return { ok, detail: cleanDetail('ошибка: ' + st.lastError, secrets) };
      const age = st.ageSec == null ? 'бэкапов нет' : 'последний ' + Math.floor(st.ageSec / 3600) + ' ч назад';
      return { ok, detail: age + ', раз в ' + st.everyHours + ' ч' };
    }),
  });
  out.push({
    id: 'botpoll',
    group: 'infra',
    name: 'Опрос бота (getUpdates)',
    alert: true,
    run: timed(async () => {
      const p = c.botPoll ? c.botPoll() : botPollSnapshot();
      if (!p.enabled) return { ok: null, detail: 'опрос выключен на этом экземпляре' };
      if (!p.lastOkAt) return { ok: false, detail: 'ещё ни одного успешного getUpdates' };
      const age = Math.floor((now() - p.lastOkAt) / 1000);
      if (age > BOT_POLL_MAX_AGE_SEC) return { ok: false, detail: 'последний успешный ' + sinceText(p.lastOkAt, now()) + ' назад' };
      return { ok: true, detail: age + ' с назад' + (p.conflictRecent ? ', был конфликт 409' : '') };
    }),
  });
  for (const path of cfg.diskPaths) {
    out.push({
      id: 'disk:' + path,
      group: 'infra',
      name: 'Диск ' + path,
      alert: true,
      run: timed(async () => {
        const st = await fsStat(path);
        const total = Number(st.blocks) * Number(st.bsize);
        const free = Number(st.bavail) * Number(st.bsize);
        const ratio = total ? free / total : 0;
        const ok = ratio >= DISK_MIN_FREE_RATIO && free >= DISK_MIN_FREE_BYTES;
        return { ok, detail: 'свободно ' + gb(free) + ' из ' + gb(total) + ' (' + Math.round(ratio * 100) + '%)' };
      }),
    });
  }
  out.push({
    id: 'warp:trace',
    group: 'infra',
    name: 'Cloudflare trace через WARP',
    path: 'warp',
    alert: true,
    run: timed(async () => {
      const r = await get(CF_TRACE_URL, { proxy: cfg.warpProxy, timeoutMs: SITE_TIMEOUT_MS });
      if (!r.ok) return { ok: false, detail: errorText(r.error) };
      if (r.status !== 200) return { ok: false, detail: 'HTTP ' + r.status };
      const t = parseTrace(r.body);
      const ok = t.warp === 'on' || t.warp === 'plus';
      return { ok, detail: 'warp=' + (t.warp || '?') + (t.colo ? ', colo=' + t.colo : '') };
    }),
  });

  // ---- internal services ----
  for (const [kind, name] of [
    ['jackett', 'Jackett'],
    ['jacred', 'JacRed'],
    ['torrserver', 'TorrServer'],
  ]) {
    out.push({
      id: 'svc:' + kind,
      group: 'services',
      name,
      path: 'internal',
      alert: true,
      run: timed(async () => {
        const p = await probeService(kind, s, net);
        if (p.error === 'not_configured' || p.error === 'url_empty') return { ok: null, detail: 'не настроено' };
        return { ok: p.ok, detail: p.ok ? 'HTTP ' + p.status : errorText(p.error) };
      }),
    });
  }

  // ---- public sites ----
  for (const site of PUBLIC_SITES) {
    out.push({
      id: site.id,
      group: 'sites',
      name: site.name,
      path: cfg.sitesViaWarp ? 'warp' : 'direct',
      alert: true,
      run: timed(async () => {
        const r = await get(site.url, { timeoutMs: SITE_TIMEOUT_MS, proxy: cfg.sitesViaWarp ? cfg.warpProxy : '' });
        if (!r.ok) return { ok: false, detail: errorText(r.error) };
        return { ok: r.status === site.expect, detail: 'HTTP ' + r.status + (r.status === site.expect ? '' : ', ждали ' + site.expect) };
      }),
    });
  }

  // ---- containers (read-only docker socket proxy) ----
  if (!cfg.dockerProxy) {
    out.push({ id: 'containers', group: 'containers', name: 'Контейнеры', alert: false, run: info('не настроено (BILLING_DOCKER_PROXY_URL)') });
  } else {
    const readList = async () => {
      try {
        const filters = encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=' + cfg.composeProject] }));
        const list = await dockerJson(cfg, get, '/containers/json?all=1&filters=' + filters);
        return Array.isArray(list) ? { list, why: '' } : { list: null, why: 'ответ не список' };
      } catch (e) {
        return { list: null, why: errorText(e && e.kind) };
      }
    };
    const { list, why } = await readList();
    if (!Array.isArray(list)) {
      out.push(
        listFailed({ id: 'containers', group: 'containers', name: 'Docker (прокси сокета)', alert: true, scope: 'ct:' }, 'список контейнеров: ' + (why || 'ошибка'), async () => {
          const again = await readList();
          return again.list ? '' : 'список контейнеров: ' + (again.why || 'ошибка');
        }),
      );
    } else {
      const rows = list
        .map((x) => ({ id: String(x.Id || ''), name: String((x.Names && x.Names[0]) || '').replace(/^\//, '') }))
        .filter((x) => /^[a-f0-9]{12,64}$/.test(x.id) && /^[A-Za-z0-9_.-]{1,80}$/.test(x.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const ct of rows) {
        out.push({
          id: 'ct:' + ct.name,
          group: 'containers',
          name: ct.name,
          path: 'internal',
          alert: true,
          run: timed(async () => {
            const inspect = await dockerJson(cfg, get, '/containers/' + ct.id + '/json');
            const stats = await dockerJson(cfg, get, '/containers/' + ct.id + '/stats?stream=false&one-shot=true').catch(() => null);
            return containerVerdict(inspect, stats, (c.restarts || {})[ct.name], now());
          }),
        });
      }
    }
  }

  // ---- Jackett trackers: every configured one, via Jackett and the site directly / through WARP ----
  const jackettUrl = String(s.jackettUrl || '').replace(/\/+$/, '');
  if (jackettUrl && s.jackettApiKey) {
    const readList = async () => {
      const r = await get(jackettTorznabIndexersUrl(jackettUrl, s.jackettApiKey), { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
      if (r.ok && r.status === 200 && /<indexers\b/i.test(r.body)) {
        return { list: parseJackettIndexers(r.body), why: '' };
      }
      return { list: null, why: r.ok ? 'HTTP ' + r.status : errorText(r.error) };
    };
    const { list: indexers, why } = await readList();
    if (!indexers) {
      out.push(
        listFailed({ id: 'jackett:list', group: 'jackett', name: 'Список трекеров Jackett', alert: true, scope: 'jackett:' }, why || 'не прочитан', async () => {
          const again = await readList();
          return again.list ? '' : again.why || 'не прочитан';
        }),
      );
    } else if (!indexers.length) {
      // Read fine and empty: no scope, so alerts of removed trackers close.
      let tries = 0;
      out.push({
        id: 'jackett:list',
        group: 'jackett',
        name: 'Список трекеров Jackett',
        alert: true,
        run: async () => {
          tries += 1;
          const empty = { ok: false, detail: 'в Jackett нет настроенных трекеров', ms: 0 };
          if (tries === 1) return empty;
          const again = await readList();
          if (!again.list) return { ok: false, detail: again.why || 'не прочитан', ms: 0 };
          return again.list.length ? { ok: true, detail: 'трекеры появились, проверка - в следующий раз', ms: 0 } : empty;
        },
      });
    } else {
      for (const ix of indexers) {
        out.push({
          id: 'jackett:' + ix.id,
          group: 'jackett',
          name: ix.title,
          path: 'jackett',
          target: ix.id,
          alert: true,
          pair: 'jackett:' + ix.id,
          heavy: true,
          run: timed(async () => {
            const v = jackettFeedVerdict(await get(jackettIndexerSearchUrl(jackettUrl, s.jackettApiKey, ix.id, ''), { timeoutMs: JACKETT_SEARCH_TIMEOUT_MS }), secrets);
            return { ok: v.ok, detail: v.detail };
          }),
        });
        sitePair(out, 'jackett', 'jackett:' + ix.id, ix.title, ix.link, cfg, get);
      }
    }
  } else {
    out.push({ id: 'jackett:list', group: 'jackett', name: 'Трекеры Jackett', alert: false, run: info('Jackett не настроен') });
  }

  // ---- JacRed: base freshness, search, sync server, every configured tracker's site ----
  const jacredUrl = String(s.jacredUrl || '').replace(/\/+$/, '');
  if (jacredUrl && s.jacredApiKey) {
    out.push({
      id: 'jacred:fresh',
      group: 'jacred',
      name: 'JacRed: свежесть базы',
      path: 'internal',
      alert: true,
      run: timed(async () => {
        const r = await get(jacredUrl + '/lastupdatedb', { timeoutMs: 10000 });
        if (!r.ok) return { ok: false, detail: errorText(r.error) };
        let at = 0;
        try {
          at = parseJacredDate(JSON.parse(r.body).lastupdatedb);
        } catch (e) {
          at = 0;
        }
        if (!at) return { ok: false, detail: 'дата не прочитана' };
        return { ok: (now() - at) / 3600000 <= JACRED_MAX_AGE_HOURS, detail: 'обновлена ' + sinceText(at, now()) + ' назад' };
      }),
    });
    out.push({
      id: 'jacred:search',
      group: 'jacred',
      name: 'JacRed: поиск',
      path: 'internal',
      alert: true,
      run: timed(async () => {
        const v = jackettFeedVerdict(await get(jackettSearchUrl(jacredUrl, s.jacredApiKey, JACRED_PROBE_QUERY), { timeoutMs: 15000 }), secrets);
        if (v.ok && !v.items) return { ok: false, detail: 'поиск «' + JACRED_PROBE_QUERY + '» пуст' };
        return { ok: v.ok, detail: v.detail };
      }),
    });
    sitePair(out, 'jacred', 'jacred:sync', 'sync.jacred.stream', JACRED_SYNC_URL, cfg, get);
    const readList = async () => {
      const r = await get(jacredUrl + '/api/v1.0/trackers?apikey=' + encodeURIComponent(s.jacredApiKey), { timeoutMs: 10000 });
      if (!r.ok || r.status !== 200) return { list: null, why: r.ok ? 'HTTP ' + r.status : errorText(r.error) };
      try {
        const data = JSON.parse(r.body);
        if (!Array.isArray(data)) return { list: null, why: 'ответ не список' };
        return { list: data.map((x) => String(x || '').toLowerCase()).filter((x) => /^[a-z0-9_-]{1,40}$/.test(x)), why: '' };
      } catch (e) {
        return { list: null, why: 'ответ не JSON' };
      }
    };
    const { list: trackers, why } = await readList();
    if (!trackers) {
      out.push(
        listFailed({ id: 'jacred:list', group: 'jacred', name: 'Список трекеров JacRed', alert: true, scope: 'jacred:' }, why || 'не прочитан', async () => {
          const again = await readList();
          return again.list ? '' : again.why || 'не прочитан';
        }),
      );
    } else {
      for (const t of Array.from(new Set(trackers)).sort()) sitePair(out, 'jacred', 'jacred:' + t, t, JACRED_TRACKER_SITES[t] || '', cfg, get);
    }
  } else {
    out.push({ id: 'jacred:list', group: 'jacred', name: 'JacRed', alert: false, run: info('JacRed не настроен') });
  }
  return out;
}

/**
 * After a run: a tracker's WARP row alerts only when its direct row failed too (the site is down on both
 * paths), and each Jackett search row gets a context line with the two site paths.
 */
export function finalize(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const word = (r) => (!r ? '-' : r.ok === true ? 'ок' : r.ok === false ? r.detail || 'нет' : '-');
  for (const r of rows) {
    if (r.pairAlert) {
      const direct = byId.get(r.pair + ':direct');
      r.alert = r.ok === false && !!direct && direct.ok === false;
    }
    if (r.path === 'jackett') {
      const d = byId.get(r.pair + ':direct');
      const w = byId.get(r.pair + ':warp');
      if (d || w) r.context = 'сайт напрямую: ' + word(d) + '; через WARP: ' + word(w);
    }
  }
  return rows;
}

/** Run tasks with at most `limit` at a time, and at most `heavyLimit` heavy ones (Jackett searches). */
export async function runTasks(tasks, limit, heavyLimit) {
  const max = Math.max(1, limit || 8);
  const heavyMax = Math.max(1, heavyLimit || 3);
  const results = new Array(tasks.length);
  let next = 0;
  let heavy = 0;
  const waiting = [];
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const t = tasks[i];
      if (t.heavy) {
        while (heavy >= heavyMax) await new Promise((r) => waiting.push(r));
        heavy += 1;
      }
      let r;
      try {
        r = await t.run();
      } catch (e) {
        r = { ok: false, detail: 'ошибка проверки', ms: 0 };
      } finally {
        if (t.heavy) {
          heavy -= 1;
          const w = waiting.shift();
          if (w) w();
        }
      }
      const { run, ...meta } = t;
      const row = { ...meta, ok: r.ok === true ? true : r.ok === false ? false : null, detail: String(r.detail || ''), ms: Number(r.ms) || 0 };
      if (r.restarts !== undefined) row.restarts = r.restarts;
      results[i] = row;
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, tasks.length) }, worker));
  return results;
}
