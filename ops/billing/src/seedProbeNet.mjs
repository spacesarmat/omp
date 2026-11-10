// Tracker scrape from this process. Hostnames are resolved first: a name that points at a
// private, loopback, or link-local address is not contacted. The connection uses that address,
// so the name cannot change on the way. Redirects are not followed. Nothing is logged: a passkey
// can sit in the query.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createSocket } from 'node:dgram';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomInt } from 'node:crypto';
import { isPublicAddress } from './monitorHttp.mjs';
import { connectRequest, parseHttpScrape, readConnect, readScrape, scrapeRequest } from './seedProbe.mjs';

const MAX_BYTES = 65536;

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
  if (aborted(o.signal)) return Promise.resolve(null);
  return resolvePublic(hostnameOf(url), lookup).then((addr) => {
    if (!addr || aborted(o.signal)) return null;
    return readHttp(url, infohash, timeoutMs, addr, requestImpl, o.signal);
  });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch (e) {
    return '';
  }
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
    const lib = requestImpl || (u.protocol === 'https:' ? httpsRequest : httpRequest);
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
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
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Host: u.host, 'User-Agent': 'OMP', Accept: '*/*' },
        timeout: timeoutMs,
        lookup: (_hostname, _options, cb) => {
          cb(null, addr.address, addr.family);
        },
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
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
            finish(parseHttpScrape(body, infohash));
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
