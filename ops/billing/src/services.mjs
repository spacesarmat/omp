/** VPS service health, secret masking, search rate-limit and short cache. */

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

/** Settings safe to send to the admin SPA (secrets masked). */
export function publicAdminSettings(settings) {
  const s = settings || {};
  const out = {
    botToken: secretConfigured(s.botToken) ? SECRET_MASK : '',
    botUsername: s.botUsername || '',
    publicOrigin: s.publicOrigin || '',
    adminTelegramIds: s.adminTelegramIds || '',
    yoomoneyWallet: s.yoomoneyWallet || '',
    yoomoneySecret: secretConfigured(s.yoomoneySecret) ? SECRET_MASK : '',
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
    yoomoneyWallet: b.yoomoneyWallet !== undefined ? b.yoomoneyWallet || '' : cur.yoomoneyWallet || '',
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
export function createRateLimit(maxHits, windowMs) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const id = String(key || '');
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
  };
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
