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
import { X509Certificate } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const MONITOR_HTTP_TIMEOUT_MS = 15000;
const MAX_BODY = 64 * 1024;
/** Statuses whose body start is read in headersOnly mode when peekBytes is set (anti-bot pages use these). */
export const PEEK_STATUSES = [200, 403, 429, 503];

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
 * GET `url`. opts: { proxy?: 'http://warp:1080', timeoutMs?, headers?, maxBytes?, headersOnly?, peekBytes?, peekMs? }.
 * headersOnly: resolve as soon as the status line and headers arrive, without reading the body.
 * peekBytes / peekMs (with headersOnly): for a status in PEEK_STATUSES also read the start of the body, at most
 * peekBytes and at most peekMs, to spot a captcha page. A slow body still never turns into a timeout: whatever
 * arrived by then comes back.
 * aia (default on): when an https site sends its certificate without the intermediate, fetch the intermediate
 * from the leaf's AIA caIssuers URL like a browser does and try once more (see fetchIssuer). The answer then
 * carries `aia: true`. ca / roots: trust store for the TLS check (roots: tests only; default the system roots).
 * raw: also return the body as a Buffer (`buf`).
 * Resolves { ok: true, status, headers, body, ms } or { ok: false, error, ms }. Never rejects.
 */
export async function monitorGet(url, opts) {
  const o = opts || {};
  const started = Date.now();
  // One deadline for the whole check: first try, certificate downloads and the retry.
  const deadline = started + Math.max(1, Number(o.timeoutMs) || MONITOR_HTTP_TIMEOUT_MS);
  const first = await getOnce(url, o);
  if (first.ok || !AIA_CODES.has(first.tlsCode) || o.aia === false || o.ca) return strip(first);
  const found = await fetchIssuer(url, { ...o, deadline });
  const left = deadline - Date.now();
  if (!found.length || left < 500) return { ...strip(first), ms: Date.now() - started };
  const roots = Array.isArray(o.roots) ? o.roots : tls.rootCertificates;
  // The fetched intermediates only complete the chain: the leaf must still chain up to one of `roots`,
  // and the host name is checked as usual (verification is never turned off).
  const again = await getOnce(url, { ...o, timeoutMs: left, ca: [...roots, ...found] });
  return { ...strip(again), ...(again.ok ? { aia: true } : {}), ms: Date.now() - started };
}

// Addresses an AIA download may go to: public unicast only. The URL comes from a certificate nobody has
// verified yet, so it must not reach billing's neighbours (docker-proxy, Postgres, the LAN).
const PRIVATE = new net.BlockList();
for (const [a, n] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) PRIVATE.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  PRIVATE.addSubnet(a, n, 'ipv6');
}

/** A public unicast address (not loopback, private, link-local, CGNAT, multicast or reserved). */
export function isPublicAddress(ip) {
  const v = net.isIP(String(ip || ''));
  if (!v) return false;
  // Node's BlockList matches IPv4 rules against IPv4 mapped IPv6 too; a mapped address is judged by its IPv4 part
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(String(ip));
  if (mapped) return isPublicAddress(mapped[1]);
  if (v === 6 && /^::ffff:/i.test(String(ip))) return false;
  return !PRIVATE.check(String(ip), v === 6 ? 'ipv6' : 'ipv4');
}

/**
 * http://host[:80]/path of an AIA URL turned into a request to one checked address (pinned, so the name cannot
 * resolve to something else on the real connection), with the original Host header. null when not allowed.
 */
async function pinAiaUrl(aiaUrl, o) {
  let u;
  try {
    u = new URL(aiaUrl);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' || u.username || u.password) return null;
  const portNum = Number(u.port) || 80;
  // tests pass aiaAllow(ip, port) for their local server; production: port 80 on public addresses only
  const allow = typeof o.aiaAllow === 'function' ? (ip) => o.aiaAllow(ip, portNum) : (ip) => portNum === 80 && isPublicAddress(ip);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return null;
  }
  if (!addrs.length || !addrs.every((a) => allow(a.address))) return null;
  const ip = addrs[0].address;
  const port = u.port || '';
  const pinned = 'http://' + (net.isIPv6(ip) ? '[' + ip + ']' : ip) + (port ? ':' + port : '') + u.pathname + u.search;
  return { url: pinned, host: u.host };
}

/** TLS errors of a server that left out its intermediate certificate. */
export const AIA_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const AIA_MAX_BYTES = 32 * 1024;
const AIA_TIMEOUT_MS = 5000;
const AIA_TTL_MS = 24 * 3600 * 1000;
const AIA_FAIL_TTL_MS = 10 * 60 * 1000;
const AIA_CACHE_MAX = 32;
// (per URL; a chain of up to AIA_MAX_HOPS URLs per site)
/** caIssuers URL -> { pem, at } (pem '' for a failed fetch, kept a shorter time). */
const aiaCache = new Map();

export function clearAiaCache() {
  aiaCache.clear();
}

function strip(r) {
  if (!r || !('tlsCode' in r)) return r;
  const { tlsCode: _code, ...rest } = r;
  return rest;
}

/** The server's leaf certificate: a handshake that only reads it (no request is sent on this connection). */
async function leafCert(target, port, o, deadline) {
  const open = [];
  const track = (x) => {
    open.push(x);
    return x;
  };
  try {
    const opts = { servername: target.hostname, rejectUnauthorized: false };
    if (o.proxy) opts.socket = track(await tunnel(o.proxy, target.hostname, port, deadline, track));
    else Object.assign(opts, { host: target.hostname, port });
    const t = track(tls.connect(opts));
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.max(1, Math.min(AIA_TIMEOUT_MS, deadline - Date.now())));
      t.once('secureConnect', () => {
        clearTimeout(timer);
        const c = t.getPeerCertificate();
        resolve(c && c.raw ? c : null);
      });
      t.once('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  } catch (e) {
    return null;
  } finally {
    // newest first: a TLS socket before the raw socket under it (the other order can crash Node)
    for (const x of open.slice().reverse()) {
      try {
        x.destroy();
      } catch (e) {
        /* closed already */
      }
    }
  }
}

const AIA_MAX_HOPS = 3;

/** The http caIssuers URL of a certificate (X509Certificate.infoAccess text or getPeerCertificate().infoAccess). */
function caIssuersUrl(access) {
  if (!access) return '';
  if (typeof access === 'string') {
    const m = /CA Issuers - URI:(http:\/\/\S+)/i.exec(access);
    return m ? m[1] : '';
  }
  return (access['CA Issuers - URI'] || []).find((u) => /^http:\/\//i.test(String(u))) || '';
}

/** One CA certificate from an AIA URL as PEM, or '' (DER or PEM, at most 32 KB, 5 s). Cached by URL. */
async function caFromUrl(aiaUrl, o) {
  const now = Date.now();
  const hit = aiaCache.get(aiaUrl);
  if (hit && now - hit.at < (hit.pem ? AIA_TTL_MS : AIA_FAIL_TTL_MS)) return hit.pem;
  let pem = '';
  const pin = await pinAiaUrl(aiaUrl, o);
  const timeoutMs = Math.min(AIA_TIMEOUT_MS, (o.deadline || Date.now() + AIA_TIMEOUT_MS) - Date.now());
  const r =
    pin && timeoutMs > 0
      ? await getOnce(pin.url, { proxy: o.proxy, timeoutMs, raw: true, maxBytes: AIA_MAX_BYTES + 1, headers: { host: pin.host } })
      : { ok: false };
  if (r.ok && r.status === 200 && r.buf && r.buf.length > 0 && r.buf.length <= AIA_MAX_BYTES) {
    try {
      const text = r.buf.toString('latin1');
      const x = new X509Certificate(text.includes('-----BEGIN CERTIFICATE-----') ? text : r.buf);
      if (x.ca) pem = x.toString();
    } catch (e) {
      pem = '';
    }
  }
  if (aiaCache.size >= AIA_CACHE_MAX) aiaCache.delete(aiaCache.keys().next().value);
  aiaCache.set(aiaUrl, { pem, at: now });
  return pem;
}

/** `child` was issued and signed by `parent`. */
function signedBy(child, parent) {
  try {
    return child.checkIssued(parent) && child.verify(parent.publicKey);
  } catch (e) {
    return false;
  }
}

/**
 * The missing intermediates of `url`'s certificate as PEMs, or [] when they cannot be found. Like a browser:
 * read the leaf's AIA caIssuers URL (http only), download that CA certificate (through the same proxy as the
 * check), and follow its own caIssuers again (at most 3 hops) until a certificate signed by a trusted root
 * (opts.roots, default the system roots). Every hop must be a CA certificate that signed the one before.
 * Each URL must be http on port 80 and resolve only to public addresses (the request then goes to that checked
 * address); each URL is cached for a day, a failure for 10 minutes. opts.deadline bounds the whole search. This only finds candidates: the TLS check that
 * follows verifies the whole chain and the host name itself.
 */
export async function fetchIssuer(url, opts) {
  const o = opts || {};
  let target;
  try {
    target = new URL(url);
  } catch (e) {
    return [];
  }
  if (target.protocol !== 'https:') return [];
  const port = Number(target.port) || 443;
  const leaf = await leafCert(target, port, o, Math.min(Date.now() + AIA_TIMEOUT_MS, o.deadline || Infinity));
  if (!leaf) return [];
  let cur;
  try {
    cur = new X509Certificate(leaf.raw);
  } catch (e) {
    return [];
  }
  let roots;
  try {
    roots = (Array.isArray(o.roots) ? o.roots : tls.rootCertificates).map((p) => new X509Certificate(p));
  } catch (e) {
    return [];
  }
  let next = caIssuersUrl(leaf.infoAccess);
  const chain = [];
  const seen = new Set();
  for (let hop = 0; hop < AIA_MAX_HOPS && next && !seen.has(next); hop++) {
    seen.add(next);
    const pem = await caFromUrl(next, o);
    if (!pem) return [];
    const x = new X509Certificate(pem);
    if (!signedBy(cur, x)) return [];
    chain.push(pem);
    if (roots.some((r) => signedBy(x, r))) return chain;
    cur = x;
    next = caIssuersUrl(x.infoAccess);
  }
  return [];
}

/** One GET, as described at monitorGet, without the AIA retry. A failure keeps the TLS error code in tlsCode. */
async function getOnce(url, opts) {
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
  // Set once the headers of a peeked answer arrived: the overall deadline then ends the peek with what was
  // read instead of turning a reachable site into a timeout.
  let endPeek = null;
  try {
    const work = (async () => {
      let createConnection = null;
      if (o.proxy) {
        const raw = track(await tunnel(o.proxy, target.hostname, port, deadline, track));
        let sock = raw;
        if (secure) {
          const t = track(tls.connect({ socket: raw, servername: target.hostname, ...(o.ca ? { ca: o.ca } : {}) }));
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
        if (o.ca) options.ca = o.ca;
        // Never the global agents: with NODE_USE_ENV_PROXY they carry the env proxy. Through the tunnel no
        // agent at all: `agent: false` would make a fresh agent that ignores createConnection and goes direct.
        if (createConnection) {
          options.createConnection = createConnection;
        } else {
          options.agent = new mod.Agent({ keepAlive: false });
        }
        const req = track(
          mod.request(options, (res) => {
            const head = {
              location: String(res.headers.location || ''),
              server: String(res.headers.server || ''),
              'cf-mitigated': String(res.headers['cf-mitigated'] || ''),
              'content-type': String(res.headers['content-type'] || ''),
            };
            const peekBytes = Math.max(0, Number(o.peekBytes) || 0);
            if (o.headersOnly && !(peekBytes && PEEK_STATUSES.includes(res.statusCode || 0))) {
              // Status and headers are the answer; a slow or stalled body must not turn it into a timeout.
              resolve({ ok: true, status: res.statusCode || 0, headers: head, body: '' });
              res.destroy();
              return;
            }
            if (o.headersOnly) {
              // Only the start of the body, for a short while; then the answer is what arrived.
              const parts = [];
              let got = 0;
              let over = false;
              const finish = () => {
                if (over) return;
                over = true;
                endPeek = null;
                clearTimeout(peekTimer);
                resolve({ ok: true, status: res.statusCode || 0, headers: head, body: Buffer.concat(parts).toString('utf8') });
                res.destroy();
              };
              const peekTimer = setTimeout(finish, Math.max(1, Math.min(Number(o.peekMs) || 3000, deadline - Date.now())));
              endPeek = finish;
              res.on('data', (c) => {
                if (got < peekBytes) {
                  const part = c.length > peekBytes - got ? c.subarray(0, peekBytes - got) : c;
                  parts.push(part);
                  got += part.length;
                }
                if (got >= peekBytes) finish();
              });
              res.on('end', finish);
              res.on('close', finish);
              res.on('error', finish);
              return;
            }
            const chunks = [];
            let size = 0;
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
              resolve({
                ok: true,
                status: res.statusCode || 0,
                headers: head,
                body: Buffer.concat(chunks).toString('utf8'),
                ...(o.raw ? { buf: Buffer.concat(chunks) } : {}),
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
      timer = setTimeout(() => {
        if (endPeek) endPeek();
        else reject(fail('timeout'));
      }, timeoutMs);
    });
    const out = await Promise.race([work, expired]);
    return { ...out, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: errorKind(e), ms: Date.now() - started, tlsCode: String((e && e.code) || '') };
  } finally {
    clearTimeout(timer);
    // newest first: a TLS socket before the raw socket under it (the other order can crash Node)
    for (const x of open.slice().reverse()) {
      try {
        x.destroy();
      } catch (e) {
        /* closed already */
      }
    }
  }
}
