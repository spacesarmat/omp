/**
 * Plain GET for the monitor, either straight from this container or through an HTTP proxy (CONNECT), so a
 * check can tell which path fails. The global fetch is not used here: with NODE_USE_ENV_PROXY it sends
 * everything through HTTPS_PROXY, and a direct check must not. Redirects are not followed (a block page
 * usually is a redirect to another host). Only the status, a few headers and the start of the body come back;
 * the error is a short kind, never the URL (a URL can carry a key).
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export const MONITOR_HTTP_TIMEOUT_MS = 15000;
const MAX_BODY = 64 * 1024;

/** A short error kind for the panel: dns, refused, reset, timeout, tls, unreachable, proxy_<x>, down. */
export function errorKind(e) {
  if (!e) return 'down';
  if (e.kind) return String(e.kind);
  const code = String(e.code || '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'reset';
  if (code === 'ETIMEDOUT' || e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'unreachable';
  if (/CERT|TLS|SSL/i.test(code) || /certificate|tls|ssl/i.test(String(e.message || ''))) return 'tls';
  return 'down';
}

function fail(kind) {
  const e = new Error(kind);
  e.kind = kind;
  return e;
}

/** A socket to host:port through an HTTP proxy (CONNECT). */
function tunnel(proxyUrl, host, port, deadline, track) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const req = http.request({
      host: p.hostname,
      port: Number(p.port) || 80,
      method: 'CONNECT',
      path: host + ':' + port,
      headers: { host: host + ':' + port },
      agent: false,
    });
    track(req);
    req.setTimeout(Math.max(1, deadline - Date.now()), () => req.destroy(fail('timeout')));
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(fail('proxy_' + res.statusCode));
        return;
      }
      resolve(socket);
    });
    req.once('error', (e) => reject(e && e.kind ? e : fail('proxy_' + errorKind(e))));
    req.end();
  });
}

/**
 * GET `url`. opts: { proxy?: 'http://warp:1080', timeoutMs?, headers?, maxBytes? }.
 * Resolves { ok: true, status, headers, body, ms } or { ok: false, error, ms }. Never rejects.
 */
export async function monitorGet(url, opts) {
  const o = opts || {};
  const started = Date.now();
  const timeoutMs = Math.max(1, Number(o.timeoutMs) || MONITOR_HTTP_TIMEOUT_MS);
  const deadline = started + timeoutMs;
  const maxBytes = Math.max(1, Number(o.maxBytes) || MAX_BODY);
  let target;
  try {
    target = new URL(url);
  } catch (e) {
    return { ok: false, error: 'bad_url', ms: 0 };
  }
  const secure = target.protocol === 'https:';
  const port = Number(target.port) || (secure ? 443 : 80);
  const open = [];
  const track = (x) => {
    open.push(x);
    return x;
  };
  let timer = null;
  try {
    const work = (async () => {
      let createConnection = null;
      if (o.proxy) {
        const raw = track(await tunnel(o.proxy, target.hostname, port, deadline, track));
        let sock = raw;
        if (secure) {
          const t = track(tls.connect({ socket: raw, servername: target.hostname }));
          await new Promise((resolve, reject) => {
            t.once('secureConnect', resolve);
            t.once('error', reject);
          });
          sock = t;
        }
        createConnection = () => sock;
      }
      return await new Promise((resolve, reject) => {
        const mod = secure ? https : http;
        const options = {
          protocol: target.protocol,
          hostname: target.hostname,
          port,
          path: target.pathname + target.search,
          method: 'GET',
          headers: { 'user-agent': 'omp-billing-monitor', accept: '*/*', ...(o.headers || {}) },
          servername: target.hostname,
        };
        // Never the global agents: with NODE_USE_ENV_PROXY they carry the env proxy. Through the tunnel no
        // agent at all: `agent: false` would make a fresh agent that ignores createConnection and goes direct.
        if (createConnection) {
          options.createConnection = createConnection;
        } else {
          options.agent = new mod.Agent({ keepAlive: false });
        }
        const req = track(
          mod.request(options, (res) => {
            const chunks = [];
            let size = 0;
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
              resolve({
                ok: true,
                status: res.statusCode || 0,
                headers: {
                  location: String(res.headers.location || ''),
                  server: String(res.headers.server || ''),
                  'cf-mitigated': String(res.headers['cf-mitigated'] || ''),
                  'content-type': String(res.headers['content-type'] || ''),
                },
                body: Buffer.concat(chunks).toString('utf8'),
              });
            };
            res.on('data', (c) => {
              if (size < maxBytes) {
                const part = c.length > maxBytes - size ? c.subarray(0, maxBytes - size) : c;
                chunks.push(part);
                size += part.length;
              }
              if (size >= maxBytes) {
                done();
                res.destroy();
              }
            });
            res.on('end', done);
            res.on('close', done);
            res.on('error', done);
          }),
        );
        req.once('error', reject);
        req.end();
      });
    })();
    work.catch(() => {});
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('timeout')), timeoutMs);
    });
    const out = await Promise.race([work, expired]);
    return { ...out, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: errorKind(e), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    for (const x of open) {
      try {
        x.destroy();
      } catch (e) {
        /* closed already */
      }
    }
  }
}
