/**
 * Allows POST /restart?name= only for the allowlist. Nothing else reaches the Docker socket.
 * Billing checks the same names again before it calls this.
 */
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';

const ALLOW = new Set(
  String(process.env.ALLOW || 'omp-jackett,omp-jacred,omp-torrserver,omp-flaresolverr,omp-bitmagnet')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function allowed(name) {
  return ALLOW.has(String(name || '').replace(/^\//, ''));
}

export function handleRestart(req, res, opts) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method !== 'POST' || url.pathname !== '/restart') {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const name = url.searchParams.get('name') || '';
  if (!allowed(name)) {
    res.writeHead(403);
    res.end('denied');
    return;
  }
  const sock = (opts && opts.socketPath) || '/var/run/docker.sock';
  const upstream = httpRequest(
    { socketPath: sock, path: '/containers/' + encodeURIComponent(name) + '/restart?t=10', method: 'POST' },
    (up) => {
      res.writeHead(up.statusCode || 502);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502);
    res.end('down');
  });
  upstream.end();
}

if (process.env.OMP_RESTART_NO_LISTEN !== '1') {
  const port = Number(process.env.PORT) || 8789;
  createServer((req, res) => handleRestart(req, res)).listen(port, '0.0.0.0');
}
