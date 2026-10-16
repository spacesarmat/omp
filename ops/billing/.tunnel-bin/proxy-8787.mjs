#!/usr/bin/env node
/** Local 127.0.0.1:8787 → NAS billing (for cloudflared when URL is http://127.0.0.1:8787). */
import http from 'node:http';

const TARGET = process.env.BILLING_UPSTREAM || 'http://192.168.1.191:8787';
const LISTEN = Number(process.env.PROXY_PORT || 8787);
const upstream = new URL(TARGET);

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: upstream.host };
  const opts = {
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers,
  };
  const p = http.request(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  p.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('proxy error: ' + err.message);
  });
  req.pipe(p);
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`proxy http://127.0.0.1:${LISTEN} → ${TARGET}`);
});
