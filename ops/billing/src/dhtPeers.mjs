// GET /v1/dht-peers: the app's device token in, a DHT peer count out.
// The sidecar (ops/vps/dht-peers) is reached only from this process. Peer addresses never leave it.
// An empty token or a URL that is not a plain http(s) origin disables the route (503).
// The route does not migrate. Admin counters use migration 004_dht_stats.
// The per-device cap is settings.dhtPerMinute (admin «Настройки»), default 30 per minute.
// Until that field is saved, BILLING_DHT_DEVICE_MAX is the fallback. BILLING_DHT_WINDOW_SEC is not read.

const MIN_TOKEN = 16;
const MAX_PEERS = 100000;

/** Requests per device per minute. 0 turns the limit off. */
export const DHT_PER_MINUTE_DEFAULT = 30;
export const DHT_PER_MINUTE_MAX = 1000;
export const DHT_WINDOW_MS = 60 * 1000;
/**
 * Admin «Проверить DHT» asks the sidecar with this infohash.
 * Forty zeros: a fixed probe, not a user torrent. Never written to the error table or the dht log line.
 */
export const DHT_PROBE_INFOHASH = '0000000000000000000000000000000000000000';

function envInt(env, name, fallback, min, max) {
  const raw = env && env[name] !== undefined ? String(env[name]).trim() : '';
  const n = raw ? Math.floor(Number(raw)) : fallback;
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Origin plus token. Disabled unless both are usable. The token is never returned. */
export function dhtConfig(env) {
  const rawUrl = String((env && env.BILLING_DHT_URL) || '').trim();
  const token = String((env && env.BILLING_DHT_TOKEN) || '').trim();
  const timeoutMs = envInt(env, 'BILLING_DHT_TIMEOUT_MS', 12000, 1000, 20000);
  let url = '';
  let enabled = false;
  try {
    const u = new URL(rawUrl);
    const http = u.protocol === 'http:' || u.protocol === 'https:';
    const pathOk = u.pathname === '/' || u.pathname === '';
    if (http && pathOk && !u.username && !u.password && !u.search && !u.hash && token.length >= MIN_TOKEN) {
      url = u.origin;
      enabled = true;
    }
  } catch (e) {
    enabled = false;
  }
  return { url, token, enabled, timeoutMs };
}

/** Whole number 0-1000, or false. Empty is not valid here (the caller keeps the previous value). */
export function validDhtPerMinute(v) {
  if (v === undefined || v === null || v === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= DHT_PER_MINUTE_MAX;
}

/**
 * Cap for GET /v1/dht-peers. A saved settings.dhtPerMinute wins over the environment.
 * When the setting has never been saved, BILLING_DHT_DEVICE_MAX (default 30) is used.
 * Pass `env` as `{}` to ignore the process environment. The window is always one minute.
 */
export function dhtPerMinute(settings, env) {
  const raw = settings && settings.dhtPerMinute;
  if (raw !== undefined && raw !== null && raw !== '') {
    return validDhtPerMinute(raw) ? Number(raw) : DHT_PER_MINUTE_DEFAULT;
  }
  const src = env === undefined ? process.env : env;
  return envInt(src, 'BILLING_DHT_DEVICE_MAX', DHT_PER_MINUTE_DEFAULT, 0, DHT_PER_MINUTE_MAX);
}

/** Per device. Default 30 requests / 1 minute. BILLING_DHT_WINDOW_SEC is ignored. */
export function dhtPeersLimitConfig(env) {
  return {
    max: dhtPerMinute(null, env),
    windowMs: DHT_WINDOW_MS,
  };
}

const MAX_ESTIMATE = 1000000;

function wholeCount(n, max) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n !== Math.floor(n)) return null;
  if (n > max) return max;
  return n;
}

/** The only shape the app may see. Extra upstream fields (addresses) are dropped. */
export function publicDhtBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const peers = body.peers;
  if (typeof peers !== 'number' || !Number.isFinite(peers) || peers < 0 || peers > MAX_PEERS) return null;
  if (peers !== Math.floor(peers)) return null;
  if (body.approx !== true || body.source !== 'dht') return null;
  const out = { peers, source: 'dht', approx: true };
  // BEP 33 seed and peer estimates. The address sample in `peers` is not a seed count.
  if (body.estimate === true) {
    const seeds = wholeCount(body.seedsEstimate, MAX_ESTIMATE);
    const swarm = wholeCount(body.peerEstimate, MAX_ESTIMATE);
    out.seedsEstimate = seeds === null ? 0 : seeds;
    out.peerEstimate = swarm === null ? 0 : swarm;
    out.estimate = true;
  }
  return out;
}

function retrySeconds(headers, body) {
  const fromHeader = headers && typeof headers.get === 'function' ? headers.get('retry-after') : '';
  const n = parseInt(String(fromHeader || ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  const fromBody = body && body.retryAfter;
  const b = parseInt(String(fromBody || ''), 10);
  if (Number.isFinite(b) && b > 0) return b;
  return 2;
}

/** Map a sidecar response onto the public contract. */
export function mapDhtUpstream(status, text, headers) {
  let body = null;
  try {
    body = JSON.parse(text || '');
  } catch (e) {
    body = null;
  }
  if (status === 200) {
    const pub = publicDhtBody(body);
    if (!pub) return { status: 502, body: { error: 'down' } };
    return { status: 200, body: pub };
  }
  if (status === 400) return { status: 400, body: { error: 'bad_infohash' }, upstream: 'down' };
  // 429 from the sidecar means it is already in a lookup (busy), not the billing device cap.
  if (status === 429) return { status: 429, body: { error: 'rate' }, retryAfter: retrySeconds(headers, body), upstream: 'sidecar_rate' };
  // 503 + error down is "not bootstrapped yet". Any other 503 is "turned off".
  // The public body stays `disabled` so the phone keeps treating every 503 as "skip".
  if (status === 503) {
    const upstream = body && body.error === 'down' ? 'not_ready' : 'disabled';
    return { status: 503, body: { error: 'disabled' }, upstream };
  }
  return { status: 502, body: { error: 'down' }, upstream: 'down' };
}

/**
 * GET /health on the sidecar. No token is sent. A missing URL does not call the network.
 * `rss` is resident bytes when the sidecar reports a sane number, otherwise null.
 */
export async function probeDhtSidecar(cfg, fetchImpl) {
  if (!cfg || !cfg.url) return { configured: false, ok: false, dht: 'off', rss: null, latencyMs: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  const started = Date.now();
  try {
    const res = await fetchImpl(cfg.url + '/health', {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text || '');
    } catch (e) {
      body = null;
    }
    const rssRaw = body && body.rss;
    const rss = typeof rssRaw === 'number' && rssRaw >= 0 && rssRaw < 1e12 ? Math.floor(rssRaw) : null;
    const dht = body && body.dht === 'up' ? 'up' : body && body.dht === 'idle' ? 'idle' : 'off';
    return {
      configured: true,
      ok: res.status === 200 && !!(body && body.ok === true),
      dht,
      rss,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return { configured: true, ok: false, dht: 'off', rss: null, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the sidecar. `fetchImpl(url, init)` is the billing process fetch.
 * A disabled config or a bad infohash never calls it.
 */
export async function queryDhtPeers(cfg, infohash, fetchImpl) {
  const hash = String(infohash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return { status: 400, body: { error: 'bad_infohash' }, upstream: 'down' };
  if (!cfg || !cfg.enabled) return { status: 503, body: { error: 'disabled' }, upstream: 'disabled' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(cfg.url + '/v1/peers?infohash=' + hash, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + cfg.token, accept: 'application/json' },
      redirect: 'error',
      signal: ctrl.signal,
    });
    const text = await res.text();
    return mapDhtUpstream(res.status, text, res.headers);
  } catch (e) {
    return { status: 502, body: { error: 'down' }, upstream: 'down' };
  } finally {
    clearTimeout(timer);
  }
}
