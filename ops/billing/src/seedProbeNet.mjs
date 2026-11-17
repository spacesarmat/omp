// Tracker scrape from this process. Hostnames are resolved first: a name that points at a
// private, loopback, or link-local address is not contacted. The connection uses that address,
// so the name cannot change on the way. Nothing is logged: a passkey can sit in the query.
//
// Transport notes (phase 2):
// - Every request carries an explicit plain agent. With NODE_USE_ENV_PROXY=1 Node 24 routes the
//   default agent through HTTP_PROXY (the WARP egress on the NUC), which trackers block. A fresh
//   http.Agent/https.Agent is not proxy-aware, so the scrape leaves from the direct ISP address.
// - 301/302/307/308 are followed, but only to an https target (an http->https upgrade is allowed;
//   an http->http hop or an https->http downgrade is refused). At most MAX_REDIRECTS hops, and the
//   SSRF gate (resolvePublic + address pinning) runs again on every hop. One timeout budget is
//   shared across the whole chain, so a redirect loop cannot outlive the per-job deadline.
// - The tracker rate-limit gate (deps.gate) is applied to every contacted host, redirect targets
//   included: each hop takes a slot, spends a request-window stamp and honours the per-host gap,
//   then releases the slot. A gate refusal is a miss, so redirects cannot bypass the tracker limits.
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { createSocket } from 'node:dgram';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomInt } from 'node:crypto';
import { isPublicAddress } from './monitorHttp.mjs';
import { connectRequest, parseHttpScrape, readConnect, readScrape, scrapeRequest } from './seedProbe.mjs';

const MAX_BYTES = 65536;
/** At most this many redirect hops; the next redirect after the cap is refused. */
const MAX_REDIRECTS = 3;
const REDIRECT_CODES = [301, 302, 307, 308];

/** First public address, or null when any answer is private or the name does not resolve. */
export async function resolvePublic(host, lookup) {
  const ask = lookup || dnsLookup;
  if (isIP(host)) return isPublicAddress(host) ? { address: host, family: isIP(host) } : null;
  let rows;
  try {
    rows = await ask(host, { all: true, verbatim: true });
  } catch (e) {
    return null;
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i] || !isPublicAddress(rows[i].address)) return null;
  }
  let pick = null;
  for (let i = 0; i < rows.length; i++) {
    if (isIP(rows[i].address) === 4) {
      pick = rows[i];
      break;
    }
  }
  if (!pick) pick = rows[0];
  const family = isIP(pick.address);
  if (family !== 4 && family !== 6) return null;
  return { address: pick.address, family };
}

function aborted(signal) {
  return !!(signal && signal.aborted);
}

export function httpScrape(url, infohash, timeoutMs, deps) {
  const o = deps || {};
  const lookup = o.lookup || dnsLookup;
  const requestImpl = o.request || null;
  const gate = o.gate || null;
  if (aborted(o.signal)) return Promise.resolve(null);
  // One deadline for the whole redirect chain: each hop spends what is left, not a fresh budget.
  const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 0;
  const deadline = Date.now() + budget;
  return fetchScrape(url, infohash, deadline, lookup, requestImpl, o.signal, gate, 0);
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch (e) {
    return '';
  }
}

/**
 * Resolve the SSRF gate, scrape one hop, then follow an https redirect with both gates run again.
 * The tracker gate (when passed) takes a slot, a request-window stamp and the per-host gap for
 * EVERY contacted host, redirect targets included, and releases the slot after the hop. A refusal
 * is a miss (null), so several announce hosts redirecting to one target cannot stampede it.
 */
async function fetchScrape(url, infohash, deadline, lookup, requestImpl, signal, gate, hops) {
  if (aborted(signal)) return null;
  const host = hostnameOf(url);
  const addr = await resolvePublic(host, lookup);
  if (!addr || aborted(signal)) return null;
  const left = deadline - Date.now();
  if (left <= 0) return null;
  if (gate && !gate.take(host, Date.now())) return null;
  let result;
  try {
    result = await readHttp(url, infohash, left, addr, requestImpl, signal);
  } finally {
    if (gate) gate.release();
  }
  if (!result) return null;
  if (!result.redirect) return result.sample;
  if (hops >= MAX_REDIRECTS) return null;
  const next = redirectTarget(url, result.redirect);
  if (!next) return null;
  return fetchScrape(next, infohash, deadline, lookup, requestImpl, signal, gate, hops + 1);
}

/** Absolute https target of a Location header, or null. Relative hops stay on the current scheme. */
function redirectTarget(current, location) {
  let u;
  try {
    u = new URL(location, current);
  } catch (e) {
    return null;
  }
  // Only https targets: an http->https upgrade is fine, an http hop or a downgrade is not.
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

function readHttp(url, infohash, timeoutMs, addr, requestImpl, signal) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      resolve(null);
      return;
    }
    const secure = u.protocol === 'https:';
    const lib = requestImpl || (secure ? httpsRequest : httpRequest);
    // A plain agent bypasses NODE_USE_ENV_PROXY; keepAlive off and destroy() leave no socket behind.
    const agent = secure ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false });
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try {
        agent.destroy();
      } catch (e) {
        // already destroyed
      }
      resolve(v);
    };
    if (aborted(signal)) {
      finish(null);
      return;
    }
    const req = lib(
      {
        protocol: u.protocol,
        host: addr.address,
        servername: u.hostname,
        port: u.port || (secure ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Host: u.host, 'User-Agent': 'OMP', Accept: '*/*' },
        timeout: timeoutMs,
        agent,
        lookup: (_hostname, _options, cb) => {
          cb(null, addr.address, addr.family);
        },
      },
      (res) => {
        const code = res.statusCode;
        if (REDIRECT_CODES.indexOf(code) >= 0) {
          const location = res.headers && res.headers.location;
          res.resume();
          finish(location ? { redirect: String(location) } : null);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          finish(null);
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            finish(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('latin1');
            finish({ sample: parseHttpScrape(body, infohash) });
          } catch (e) {
            finish(null);
          }
        });
        res.on('error', () => finish(null));
      },
    );
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        req.destroy();
        finish(null);
      });
    }
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

export function udpScrape(host, port, infohash, timeoutMs, deps) {
  const o = deps || {};
  const lookup = o.lookup || dnsLookup;
  const socketFactory = o.createSocket || createSocket;
  if (aborted(o.signal)) return Promise.resolve(null);
  return resolvePublic(host, lookup).then((addr) => {
    if (!addr || aborted(o.signal)) return null;
    return udpExchange(addr, port, infohash, timeoutMs, socketFactory, o.signal);
  });
}

function udpExchange(addr, port, infohash, timeoutMs, socketFactory, signal) {
  return new Promise((resolve) => {
    const type = addr.family === 6 ? 'udp6' : 'udp4';
    let socket;
    try {
      socket = socketFactory(type);
    } catch (e) {
      resolve(null);
      return;
    }
    let settled = false;
    let phase = 0;
    let tx = randomInt(0, 0x100000000);
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch (e) {
        // already closed
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => finish(null));
    }
    if (aborted(signal)) {
      finish(null);
      return;
    }
    socket.on('error', () => finish(null));
    socket.on('message', (msg) => {
      if (phase === 0) {
        const conn = readConnect(msg, tx);
        if (conn === null) return finish(null);
        const next = scrapeRequest(conn, (tx = randomInt(0, 0x100000000)), infohash);
        if (!next) return finish(null);
        phase = 1;
        try {
          socket.send(next, port, addr.address);
        } catch (e) {
          finish(null);
        }
        return;
      }
      const counts = readScrape(msg, tx);
      finish(counts);
    });
    try {
      socket.send(connectRequest(tx), port, addr.address);
    } catch (e) {
      finish(null);
    }
  });
}

/** Transport runSeedCheck calls. DNS and the sockets stay in here. */
export function defaultSeedTransport() {
  return {
    http: (url, infohash, timeoutMs, opts) => httpScrape(url, infohash, timeoutMs, opts),
    udp: (host, port, infohash, timeoutMs, opts) => udpScrape(host, port, infohash, timeoutMs, opts),
  };
}
