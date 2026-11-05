// GET /v1/dht-peers: the app's device token in, a DHT peer count out.
// The sidecar (ops/vps/dht-peers) is reached only from this process. Peer addresses never leave it.
// An empty token or a URL that is not a plain http(s) origin disables the route (503). No migration.

const MIN_TOKEN = 16;
const MAX_PEERS = 100000;

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

/** Per device. 0 turns the limit off. Default 30 requests / 10 minutes. */
export function dhtPeersLimitConfig(env) {
  return {
    max: envInt(env, 'BILLING_DHT_DEVICE_MAX', 30, 0, 1000),
    windowMs: envInt(env, 'BILLING_DHT_WINDOW_SEC', 600, 1, 86400) * 1000,
  };
}

/** The only shape the app may see. Extra upstream fields (addresses) are dropped. */
export function publicDhtBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const peers = body.peers;
  if (typeof peers !== 'number' || !Number.isFinite(peers) || peers < 0 || peers > MAX_PEERS) return null;
  if (peers !== Math.floor(peers)) return null;
  if (body.approx !== true || body.source !== 'dht') return null;
  return { peers, source: 'dht', approx: true };
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
  if (status === 400) return { status: 400, body: { error: 'bad_infohash' } };
  if (status === 429) return { status: 429, body: { error: 'rate' }, retryAfter: retrySeconds(headers, body) };
  if (status === 503) return { status: 503, body: { error: 'disabled' } };
  return { status: 502, body: { error: 'down' } };
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
  if (!/^[0-9a-f]{40}$/.test(hash)) return { status: 400, body: { error: 'bad_infohash' } };
  if (!cfg || !cfg.enabled) return { status: 503, body: { error: 'disabled' } };
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
    return { status: 502, body: { error: 'down' } };
  } finally {
    clearTimeout(timer);
  }
}
