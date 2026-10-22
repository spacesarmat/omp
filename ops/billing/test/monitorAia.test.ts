import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createTlsServer, type Server as HttpsServer } from 'node:https';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearAiaCache, isPublicAddress, monitorGet } from '../src/monitorHttp.mjs';
import { siteVerdict } from '../src/monitorChecks.mjs';

// A local test PKI: root -> intermediate -> leaf. The HTTPS servers send the leaf only (no intermediate), like
// torrent.by; the leaf's AIA caIssuers points at a local HTTP server.
let dir = '';
let aia: Server;
let proxy: Server;
let aiaPort = 0;
let proxyPort = 0;
let proxied = 0;
const aiaHits: Record<string, number> = {};
const sites: Record<string, { server: HttpsServer; port: number }> = {};
let rootPem = '';

const ossl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
let serial = 1000;

function ca(name: string, signer?: string, aiaPath?: string) {
  if (!signer) {
    ossl('req', '-x509', ...ec, '-keyout', name + '.key', '-out', name + '.pem', '-subj', '/CN=' + name, '-days', '3650', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    return;
  }
  ossl('req', '-new', ...ec, '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + name);
  writeFileSync(
    path.join(dir, name + '.ext'),
    'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' + (aiaPath ? `authorityInfoAccess=caIssuers;URI:http://127.0.0.1:${aiaPort}${aiaPath}\n` : ''),
  );
  ossl('x509', '-req', '-in', name + '.csr', '-CA', signer + '.pem', '-CAkey', signer + '.key', '-set_serial', String(serial++), '-out', name + '.pem', '-days', '3650', '-extfile', name + '.ext');
}

function leaf(name: string, san: string, aiaPath: string, signer = 'inter') {
  ossl('req', '-new', ...ec, '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + name);
  writeFileSync(
    path.join(dir, name + '.ext'),
    `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\nauthorityInfoAccess=caIssuers;URI:http://127.0.0.1:${aiaPort}${aiaPath}\n`,
  );
  ossl('x509', '-req', '-in', name + '.csr', '-CA', signer + '.pem', '-CAkey', signer + '.key', '-set_serial', String(serial++), '-out', name + '.pem', '-days', '3650', '-extfile', name + '.ext');
}

async function site(name: string) {
  const server = createTlsServer({ key: readFileSync(path.join(dir, name + '.key')), cert: readFileSync(path.join(dir, name + '.pem')) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('hello');
  });
  track(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  sites[name] = { server, port: (server.address() as AddressInfo).port };
}

const sockets = new Set<import('node:net').Socket>();
function track(server: { on: (e: 'connection', f: (s: import('node:net').Socket) => void) => unknown }) {
  server.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });
}

const url = (name: string) => 'https://127.0.0.1:' + sites[name].port + '/';
// the local AIA server is on loopback; production allows only public addresses on port 80
const aiaAllow = (ip: string, port: number) => ip === '127.0.0.1' && port === aiaPort;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'aia-'));
  aia = createServer((req, res) => {
    const p = String(req.url);
    aiaHits[p] = (aiaHits[p] || 0) + 1;
    const send = (body: Buffer | string) => {
      res.writeHead(200, { 'content-type': 'application/pkix-cert' });
      res.end(body);
    };
    if (p === '/inter.der') return send(ossl('x509', '-in', 'inter.pem', '-outform', 'DER'));
    if (p === '/inter.pem') return send(readFileSync(path.join(dir, 'inter.pem')));
    const der = /^\/(other|cross|inter2|selfroot|inter3)\.der$/.exec(p);
    if (der) return send(ossl('x509', '-in', der[1] + '.pem', '-outform', 'DER'));
    if (p === '/big') return send(Buffer.alloc(40 * 1024, 1));
    if (p === '/junk') return send('not a certificate');
    res.writeHead(404);
    res.end();
  });
  track(aia);
  await new Promise<void>((r) => aia.listen(0, '127.0.0.1', r));
  aiaPort = (aia.address() as AddressInfo).port;
  proxy = createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on('connect', (req, client, head) => {
    proxied += 1;
    const [host, port] = String(req.url).split(':');
    const up = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
  });
  track(proxy);
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  proxyPort = (proxy.address() as AddressInfo).port;

  ca('root');
  ca('inter', 'root');
  ca('other');
  // two hops, like YE1 <- Root YE (cross-signed by ISRG Root X2): leaf -> inter2 -> cross -> root
  ca('cross', 'root');
  ca('inter2', 'cross', '/cross.der');
  // a chain that ends at a self-signed root nobody trusts
  ca('selfroot');
  ca('inter3', 'selfroot', '/selfroot.der');
  rootPem = readFileSync(path.join(dir, 'root.pem'), 'utf8');
  leaf('twohop', 'IP:127.0.0.1', '/inter2.der', 'inter2');
  leaf('untrusted', 'IP:127.0.0.1', '/inter3.der', 'inter3');
  leaf('good', 'IP:127.0.0.1,DNS:localhost', '/inter.der');
  leaf('pem', 'IP:127.0.0.1', '/inter.pem');
  leaf('wronghost', 'DNS:wrong.example', '/inter.der');
  leaf('junk', 'IP:127.0.0.1', '/junk');
  leaf('big', 'IP:127.0.0.1', '/big');
  leaf('otherca', 'IP:127.0.0.1', '/other.der');
  for (const n of ['good', 'pem', 'wronghost', 'junk', 'big', 'otherca', 'twohop', 'untrusted']) await site(n);
}, 60000);

afterAll(async () => {
  // CONNECT tunnels and TLS sockets are not tracked by closeAllConnections: destroy every socket ever accepted
  for (const sock of sockets) sock.destroy();
  for (const s of Object.values(sites)) {
    s.server.closeAllConnections();
    await new Promise((r) => s.server.close(r));
  }
  proxy.closeAllConnections();
  aia.closeAllConnections();
  await new Promise((r) => aia.close(r));
  await new Promise((r) => proxy.close(r));
  rmSync(dir, { recursive: true, force: true });
}, 30000);

beforeEach(() => {
  clearAiaCache();
  for (const k of Object.keys(aiaHits)) delete aiaHits[k];
});

describe('missing intermediate certificate (AIA caIssuers)', () => {
  it('without the AIA fetch the site fails TLS, like before', async () => {
    const r = await monitorGet(url('good'), { roots: [rootPem], aiaAllow, aia: false, timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: false, error: 'tls' });
    expect(r).not.toHaveProperty('tlsCode');
    expect(aiaHits).toEqual({});
  });

  it('fetches the intermediate (DER), verifies the chain and answers; the next call uses the cache', async () => {
    const r = await monitorGet(url('good'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: true, status: 200, aia: true, body: 'hello' });
    expect(aiaHits).toEqual({ '/inter.der': 1 });
    const again = await monitorGet(url('good'), { roots: [rootPem], aiaAllow, timeoutMs: 5000, headersOnly: true });
    expect(again).toMatchObject({ ok: true, status: 200, aia: true });
    expect(aiaHits).toEqual({ '/inter.der': 1 });
    expect(siteVerdict(again, url('good'))).toEqual({ ok: true, detail: 'HTTP 200, сертификат докачан' });
  });

  it('works through the WARP-style CONNECT proxy, the intermediate fetched through it too', async () => {
    const before = proxied;
    const r = await monitorGet(url('good'), { roots: [rootPem], aiaAllow, timeoutMs: 5000, proxy: 'http://127.0.0.1:' + proxyPort });
    expect(r).toMatchObject({ ok: true, status: 200, aia: true });
    // first try, leaf read, intermediate download, second try
    expect(proxied - before).toBe(4);
    expect(aiaHits).toEqual({ '/inter.der': 1 });
  });

  it('follows the caIssuers of the intermediate too (two hops), directly and through the proxy', async () => {
    expect(await monitorGet(url('twohop'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 })).toMatchObject({ ok: true, status: 200, aia: true });
    expect(aiaHits).toEqual({ '/inter2.der': 1, '/cross.der': 1 });
    expect(await monitorGet(url('twohop'), { roots: [rootPem], aiaAllow, timeoutMs: 5000, proxy: 'http://127.0.0.1:' + proxyPort })).toMatchObject({ ok: true, aia: true });
    expect(aiaHits).toEqual({ '/inter2.der': 1, '/cross.der': 1 });
  });

  it('a chain that ends at an untrusted root is not tried', async () => {
    expect(await monitorGet(url('untrusted'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 })).toMatchObject({ ok: false, error: 'tls' });
    expect(aiaHits).toEqual({ '/inter3.der': 1, '/selfroot.der': 1 });
  });

  it('accepts a PEM intermediate', async () => {
    expect(await monitorGet(url('pem'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 })).toMatchObject({ ok: true, aia: true });
  });

  it('still checks the host name', async () => {
    const r = await monitorGet(url('wronghost'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: false, error: 'tls' });
    expect(r).not.toHaveProperty('aia');
  });

  it('still needs a trusted root: the fetched intermediate is not a trust anchor', async () => {
    const r = await monitorGet(url('good'), { roots: [], aiaAllow, timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: false, error: 'tls' });
    const self = await monitorGet(url('good'), { roots: [readFileSync(path.join(dir, 'other.pem'), 'utf8')], timeoutMs: 5000 });
    expect(self).toMatchObject({ ok: false, error: 'tls' });
    // and the TLS check itself does not take an intermediate alone as an anchor (no partial chains)
    const interPem = readFileSync(path.join(dir, 'inter.pem'), 'utf8');
    expect(await monitorGet(url('good'), { ca: [interPem], timeoutMs: 5000 })).toMatchObject({ ok: false, error: 'tls' });
    expect(await monitorGet(url('good'), { ca: [rootPem, interPem], timeoutMs: 5000 })).toMatchObject({ ok: true, status: 200 });
  });

  it('rejects junk, an oversized answer and a CA that did not issue the leaf, and caches the failure', async () => {
    for (const n of ['junk', 'big', 'otherca']) {
      expect(await monitorGet(url(n), { roots: [rootPem], aiaAllow, timeoutMs: 5000 })).toMatchObject({ ok: false, error: 'tls' });
    }
    expect(aiaHits).toEqual({ '/junk': 1, '/big': 1, '/other.der': 1 });
    await monitorGet(url('junk'), { roots: [rootPem], aiaAllow, timeoutMs: 5000 });
    expect(aiaHits['/junk']).toBe(1);
  });

  it('by default an AIA URL may only reach public addresses on port 80 (no requests to billing neighbours)', async () => {
    const r = await monitorGet(url('good'), { roots: [rootPem], timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: false, error: 'tls' });
    expect(aiaHits).toEqual({});
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.18.0.5', '192.168.1.211', '100.64.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'docker-proxy']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ['1.1.1.1', '104.18.0.1', '2606:4700::1']) expect(isPublicAddress(ip)).toBe(true);
  });

  it('the whole check keeps one time limit', async () => {
    // an AIA server that never answers: the check still ends by its timeout, with the full time in ms
    const slow = createServer(() => {});
    track(slow);
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    const slowPort = (slow.address() as AddressInfo).port;
    leaf('slowaia', 'IP:127.0.0.1', '/x');
    // rewrite the AIA port: issue a leaf pointing at the silent server
    writeFileSync(
      path.join(dir, 'slowaia.ext'),
      `basicConstraints=CA:FALSE\nsubjectAltName=IP:127.0.0.1\nauthorityInfoAccess=caIssuers;URI:http://127.0.0.1:${slowPort}/x\n`,
    );
    ossl('x509', '-req', '-in', 'slowaia.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-set_serial', String(serial++), '-out', 'slowaia.pem', '-days', '3650', '-extfile', 'slowaia.ext');
    await site('slowaia');
    const started = Date.now();
    const r = await monitorGet(url('slowaia'), { roots: [rootPem], aiaAllow: () => true, timeoutMs: 1500 });
    expect(r).toMatchObject({ ok: false, error: 'tls' });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(r.ms).toBeGreaterThanOrEqual(1000);
    for (const sock of sockets) sock.destroy();
    await new Promise((res) => slow.close(res));
  });

  it('a plain http site or another error does not trigger the fetch', async () => {
    const r = await monitorGet('http://127.0.0.1:' + aiaPort + '/nothing', { timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: true, status: 404 });
    expect(r).not.toHaveProperty('aia');
    expect(await monitorGet('https://127.0.0.1:1/', { timeoutMs: 2000 })).toMatchObject({ ok: false, error: 'refused' });
  });
});
