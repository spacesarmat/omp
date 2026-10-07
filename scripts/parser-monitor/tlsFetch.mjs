// fetch() for the parser monitor with extra trust for the few hosts whose TLS chain Node cannot build by itself.
//
// torrent.by sends only its leaf certificate, without the Let's Encrypt intermediate (YE1). Browsers fetch it via AIA,
// Node does not, so on a Linux runner every request failed with UNABLE_TO_VERIFY_LEAF_SIGNATURE and the monitor never
// reached the parser. The Android app has the same problem and bundles the public Let's Encrypt ECDSA intermediates
// YE1-YE3 (android/app/src/main/res/raw/letsencrypt_ye.crt, see network_security_config.xml); here the same file is
// trusted for those hosts only, through a node:https agent:
//   ca = Node's own roots + the YE intermediates, allowPartialTrustChain = true
// (their root, ISRG Root YE, is not in Node's store yet, so the intermediate itself must be allowed as the anchor).
// The leaf is still fully verified: signature, host name, validity. NODE_EXTRA_CA_CERTS would not do: it trusts the
// file for every host and cannot allow a partial chain. Every other host goes through the normal global fetch.
import { readFileSync } from 'node:fs';
import { Agent, request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const YE = new URL('../../android/app/src/main/res/raw/letsencrypt_ye.crt', import.meta.url);

/** Hosts (and their subdomains) that get the extra intermediates. Mirrors network_security_config.xml. */
export const EXTRA_CA_HOSTS = ['torrent.by'];

export function needsExtraCa(host) {
  const h = String(host || '').toLowerCase();
  return EXTRA_CA_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

let agent = null;
function extraCaAgent() {
  if (!agent) {
    agent = new Agent({ ca: [...rootCertificates, readFileSync(YE, 'utf8')], allowPartialTrustChain: true, keepAlive: true });
  }
  return agent;
}

// a status that must not carry a body in a Response
const NULL_BODY = [101, 103, 204, 205, 304];

function decoded(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(createGunzip());
  if (enc === 'deflate') return res.pipe(createInflate());
  if (enc === 'br') return res.pipe(createBrotliDecompress());
  return res;
}

/** The subset of fetch() nodeHttp uses (method, headers, string body, redirect: manual, signal), via node:https. */
function agentFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    // a network failure looks like the global fetch's: TypeError «fetch failed» with the reason as `cause`
    const fail = (e) => {
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return reject(e);
      if (init.signal && init.signal.aborted) return reject(init.signal.reason || e);
      reject(Object.assign(new TypeError('fetch failed'), { cause: e }));
    };
    const headers = { 'Accept-Encoding': 'gzip, deflate, br', ...(init.headers || {}) };
    const body = init.body === undefined ? undefined : String(init.body);
    if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body));
    const req = request(url, { method: init.method || 'GET', headers, agent: extraCaAgent(), signal: init.signal }, (res) => {
      const chunks = [];
      const stream = decoded(res);
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', fail);
      stream.on('end', () => {
        const h = new Headers();
        const raw = res.rawHeaders;
        for (let i = 0; i + 1 < raw.length; i += 2) {
          // the body is already decoded
          if (!/^(content-encoding|content-length)$/i.test(raw[i])) h.append(raw[i], raw[i + 1]);
        }
        const status = res.statusCode || 0;
        resolve(new Response(NULL_BODY.includes(status) ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage || '', headers: h }));
      });
    });
    req.on('error', fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** fetch(): the extra-CA agent for EXTRA_CA_HOSTS, the global fetch for everything else. */
export function monitorFetch(url, init) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (e) {
    /* the global fetch reports it */
  }
  return needsExtraCa(host) && /^https:/i.test(url) ? agentFetch(url, init) : fetch(url, init);
}
