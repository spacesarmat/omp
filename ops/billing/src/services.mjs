/** VPS service health, secret masking, search rate-limit and short cache. */
import { graceDays } from './logic.mjs';

export const SECRET_MASK = '••••••••';

export function isSecretMask(value) {
  const s = String(value || '');
  return !s || s === SECRET_MASK || /^•+$/.test(s);
}

/** Keep the previous secret when the form sends a mask or empty. */
export function keepSecret(incoming, current) {
  if (isSecretMask(incoming)) return String(current || '');
  return String(incoming || '');
}

export function secretConfigured(value) {
  return !!String(value || '').trim();
}

/** Show only the last four digits of a ЮMoney wallet. */
export function maskWallet(value) {
  const s = String(value || '').replace(/\s/g, '');
  if (!s) return '';
  if (s.length <= 4) return SECRET_MASK;
  return SECRET_MASK + s.slice(-4);
}

/** True when the form still holds the masked wallet (or nothing) and the saved one must stay. */
export function walletUnchanged(incoming, current) {
  const inc = String(incoming == null ? '' : incoming).trim();
  if (!inc || isSecretMask(inc)) return true;
  const cur = String(current || '').replace(/\s/g, '');
  return !!cur && inc === maskWallet(cur);
}

/** Settings safe to send to the admin SPA (secrets masked). */
export function publicAdminSettings(settings) {
  const s = settings || {};
  const out = {
    botToken: secretConfigured(s.botToken) ? SECRET_MASK : '',
    botUsername: s.botUsername || '',
    publicOrigin: s.publicOrigin || '',
    adminTelegramIds: s.adminTelegramIds || '',
    yoomoneyWallet: maskWallet(s.yoomoneyWallet),
    yoomoneySecret: secretConfigured(s.yoomoneySecret) ? SECRET_MASK : '',
    adminNotify: s.adminNotify !== false,
    jackettUrl: s.jackettUrl || '',
    jackettApiKey: secretConfigured(s.jackettApiKey) ? SECRET_MASK : '',
    jackettEnabled: s.jackettEnabled !== false,
    jacredUrl: s.jacredUrl || '',
    jacredApiKey: secretConfigured(s.jacredApiKey) ? SECRET_MASK : '',
    jacredEnabled: s.jacredEnabled !== false,
    torrserverUrl: s.torrserverUrl || '',
    indexerUser: s.indexerUser || '',
    indexerPass: secretConfigured(s.indexerPass) ? SECRET_MASK : '',
    smtpHost: s.smtpHost || '',
    smtpUser: s.smtpUser || '',
    smtpPass: secretConfigured(s.smtpPass) ? SECRET_MASK : '',
    smtpFrom: s.smtpFrom || '',
    priceRub: s.priceRub || 0,
    periodDays: s.periodDays || 30,
    extraDeviceRub: s.extraDeviceRub || 0,
    graceDays: graceDays(s),
  };
  return out;
}

/** Merge admin form body into settings, preserving masked secrets. */
export function mergeSettings(prev, body) {
  const cur = prev || {};
  const b = body || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const bool = (v, d) => {
    if (v === true || v === 'true' || v === '1' || v === 1) return true;
    if (v === false || v === 'false' || v === '0' || v === 0) return false;
    return d;
  };
  const next = {
    ...cur,
    botToken: keepSecret(b.botToken, cur.botToken),
    botUsername: (b.botUsername !== undefined ? b.botUsername : cur.botUsername || 'OMPBILLINGBOT').replace(
      /^@/,
      '',
    ),
    publicOrigin: String(b.publicOrigin !== undefined ? b.publicOrigin : cur.publicOrigin || '').replace(/\/+$/, ''),
    adminTelegramIds: b.adminTelegramIds !== undefined ? b.adminTelegramIds || '' : cur.adminTelegramIds || '',
    yoomoneyWallet:
      b.yoomoneyWallet !== undefined && !walletUnchanged(b.yoomoneyWallet, cur.yoomoneyWallet)
        ? String(b.yoomoneyWallet).replace(/\s/g, '')
        : cur.yoomoneyWallet || '',
    adminNotify: b.adminNotify !== undefined ? bool(b.adminNotify, cur.adminNotify !== false) : cur.adminNotify !== false,
    yoomoneySecret: keepSecret(b.yoomoneySecret, cur.yoomoneySecret),
    jackettUrl: String(b.jackettUrl !== undefined ? b.jackettUrl : cur.jackettUrl || '').replace(/\/+$/, ''),
    jackettApiKey: keepSecret(b.jackettApiKey, cur.jackettApiKey),
    jackettEnabled: bool(b.jackettEnabled, cur.jackettEnabled !== false),
    jacredUrl: String(b.jacredUrl !== undefined ? b.jacredUrl : cur.jacredUrl || '').replace(/\/+$/, ''),
    jacredApiKey: keepSecret(b.jacredApiKey, cur.jacredApiKey),
    jacredEnabled: bool(b.jacredEnabled, cur.jacredEnabled !== false),
    torrserverUrl: String(b.torrserverUrl !== undefined ? b.torrserverUrl : cur.torrserverUrl || '').replace(
      /\/+$/,
      '',
    ),
    indexerUser: b.indexerUser !== undefined ? b.indexerUser || '' : cur.indexerUser || '',
    indexerPass: keepSecret(b.indexerPass, cur.indexerPass),
    smtpHost: b.smtpHost !== undefined ? b.smtpHost || '' : cur.smtpHost || '',
    smtpUser: b.smtpUser !== undefined ? b.smtpUser || '' : cur.smtpUser || '',
    smtpPass: keepSecret(b.smtpPass, cur.smtpPass),
    smtpFrom: b.smtpFrom !== undefined ? b.smtpFrom || '' : cur.smtpFrom || '',
    priceRub: num(b.priceRub !== undefined ? b.priceRub : cur.priceRub, 0),
    periodDays: num(b.periodDays !== undefined ? b.periodDays : cur.periodDays, 30),
    extraDeviceRub: num(b.extraDeviceRub !== undefined ? b.extraDeviceRub : cur.extraDeviceRub, 0),
    graceDays: graceDays({ graceDays: b.graceDays !== undefined && b.graceDays !== '' ? b.graceDays : cur.graceDays }),
  };
  return next;
}

export function sourceEnabled(settings, source) {
  if (source === 'jacred') return settings.jacredEnabled !== false;
  return settings.jackettEnabled !== false;
}

function capsUrl(origin, apiKey) {
  const base = String(origin || '').replace(/\/+$/, '');
  return (
    base +
    '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
    encodeURIComponent(apiKey || '') +
    '&t=caps'
  );
}

/**
 * Probe Jackett / JacRed (Torznab caps) or TorrServer (/echo).
 * @returns {{ ok: boolean, status: number, latencyMs: number, error: string, checkedAt: number }}
 */
export async function probeService(kind, settings, fetchImpl) {
  const started = Date.now();
  const s = settings || {};
  const net = fetchImpl || fetch;
  let url = '';
  const headers = {};
  try {
    if (kind === 'torrserver') {
      url = String(s.torrserverUrl || '').replace(/\/+$/, '') + '/echo';
      if (!s.torrserverUrl) {
        return { ok: false, status: 0, latencyMs: 0, error: 'url_empty', checkedAt: started };
      }
    } else {
      const indexer = kind === 'jacred'
        ? { url: s.jacredUrl, key: s.jacredApiKey }
        : { url: s.jackettUrl, key: s.jackettApiKey };
      if (!indexer.url || !indexer.key) {
        return { ok: false, status: 0, latencyMs: 0, error: 'not_configured', checkedAt: started };
      }
      url = capsUrl(indexer.url, indexer.key);
      const user = String(s.indexerUser || '');
      if (user) {
        headers.Authorization =
          'Basic ' + Buffer.from(user + ':' + String(s.indexerPass || '')).toString('base64');
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await net(url, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - started;
    const ok = res.status >= 200 && res.status < 400;
    return {
      ok,
      status: res.status,
      latencyMs,
      error: ok ? '' : 'http_' + res.status,
      checkedAt: Date.now(),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: e && e.name === 'AbortError' ? 'timeout' : 'down',
      checkedAt: Date.now(),
    };
  }
}

export async function probeAllServices(settings, fetchImpl) {
  const [jackett, jacred, torrserver] = await Promise.all([
    probeService('jackett', settings, fetchImpl),
    probeService('jacred', settings, fetchImpl),
    probeService('torrserver', settings, fetchImpl),
  ]);
  return {
    jackett: {
      ...jackett,
      enabled: settings.jackettEnabled !== false,
      configured: secretConfigured(settings.jackettApiKey) && !!settings.jackettUrl,
      url: settings.jackettUrl || '',
    },
    jacred: {
      ...jacred,
      enabled: settings.jacredEnabled !== false,
      configured: secretConfigured(settings.jacredApiKey) && !!settings.jacredUrl,
      url: settings.jacredUrl || '',
    },
    torrserver: {
      ...torrserver,
      configured: !!settings.torrserverUrl,
      url: settings.torrserverUrl || '',
      note: 'ops_only',
    },
    indexerUser: settings.indexerUser || '',
    indexerPassConfigured: secretConfigured(settings.indexerPass),
  };
}

/** Sliding-window rate limit: max hits per windowMs per key. */
/**
 * Sliding-window limiter kept in memory. `opts.now` replaces the clock in tests.
 * Keys whose hits all fell out of the window are dropped once the map grows past `opts.maxKeys`.
 */
export function createRateLimit(maxHits, windowMs, opts) {
  const hits = new Map();
  const clock = (opts && opts.now) || (() => Date.now());
  const maxKeys = (opts && opts.maxKeys) || 10000;
  const prune = (now) => {
    for (const [id, arr] of hits) {
      if (!arr.length || now - arr[arr.length - 1] >= windowMs) hits.delete(id);
    }
  };
  return {
    allow(key) {
      const now = clock();
      const id = String(key || '');
      if (hits.size > maxKeys) prune(now);
      let arr = hits.get(id) || [];
      arr = arr.filter((t) => now - t < windowMs);
      if (arr.length >= maxHits) {
        hits.set(id, arr);
        return false;
      }
      arr.push(now);
      hits.set(id, arr);
      return true;
    },
    /** Seconds until the oldest hit of `key` leaves the window (0 when it is not limited). */
    retryAfter(key) {
      const arr = hits.get(String(key || '')) || [];
      if (arr.length < maxHits) return 0;
      return Math.max(1, Math.ceil((arr[0] + windowMs - clock()) / 1000));
    },
    size() {
      return hits.size;
    },
  };
}

function envInt(env, name, fallback) {
  const raw = env && env[name] !== undefined ? String(env[name]).trim() : '';
  if (!raw) return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * /v1/activate limits from the environment. 0 turns a limit off.
 * BILLING_ACTIVATE_IP_MAX (20) and BILLING_ACTIVATE_CODE_MAX (10) per BILLING_ACTIVATE_WINDOW_SEC (600).
 */
export function activateLimitConfig(env) {
  return {
    ipMax: envInt(env, 'BILLING_ACTIVATE_IP_MAX', 20),
    codeMax: envInt(env, 'BILLING_ACTIVATE_CODE_MAX', 10),
    windowMs: Math.max(1, envInt(env, 'BILLING_ACTIVATE_WINDOW_SEC', 600)) * 1000,
  };
}

/** /v1/token/refresh and /v1/token/upgrade: per IP only (tokens are random, there is nothing to guess). */
export function tokenLimitConfig(env) {
  return { ipMax: envInt(env, 'BILLING_TOKEN_IP_MAX', 60), codeMax: 0, windowMs: 10 * 60 * 1000 };
}

/** Per-IP and per-code limiters for /v1/activate. `check` returns 0 when allowed, else Retry-After seconds. */
export function createActivateLimiter(config, opts) {
  const cfg = config || activateLimitConfig({});
  const byIp = cfg.ipMax > 0 ? createRateLimit(cfg.ipMax, cfg.windowMs, opts) : null;
  const byCode = cfg.codeMax > 0 ? createRateLimit(cfg.codeMax, cfg.windowMs, opts) : null;
  return {
    check(ip, codeKey) {
      if (byIp && !byIp.allow('ip:' + String(ip || ''))) return byIp.retryAfter('ip:' + String(ip || ''));
      if (byCode && codeKey && !byCode.allow('code:' + codeKey)) return byCode.retryAfter('code:' + codeKey);
      return 0;
    },
  };
}

/**
 * Client address for rate limits. Production sits behind Cloudflare, which sets CF-Connecting-IP
 * and overwrites a value sent by the client. Without it: first X-Forwarded-For hop, then the socket.
 */
export function clientIp(req) {
  const h = (req && req.headers) || {};
  const cf = String(h['cf-connecting-ip'] || '').trim();
  if (cf) return cf.slice(0, 64);
  const xff = String(h['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (xff) return xff.slice(0, 64);
  const sock = req && req.socket ? req.socket.remoteAddress : '';
  return String(sock || '').slice(0, 64);
}

/** Short TTL cache for search XML. */
export function createSearchCache(ttlMs) {
  const map = new Map();
  return {
    get(key) {
      const row = map.get(key);
      if (!row) return null;
      if (Date.now() > row.exp) {
        map.delete(key);
        return null;
      }
      return row.body;
    },
    set(key, body) {
      map.set(key, { body, exp: Date.now() + ttlMs });
      if (map.size > 200) {
        const first = map.keys().next().value;
        map.delete(first);
      }
    },
  };
}
