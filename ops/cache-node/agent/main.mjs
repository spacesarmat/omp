// Cache node agent. TorrServer stays on the compose network. This process publishes health and streams.
import http from 'node:http';
import { statfsSync } from 'node:fs';
import { billingJson, billingOrigin } from './billing.mjs';
import { prefixGoal, reconcile, safeStreamTarget } from './plan.mjs';
import { addMagnet, echoOk, largestFile, listHashes, readPrefix, removeHash } from './torr.mjs';

function requiredOrigin(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) {
    process.stderr.write(name + ' is empty\n');
    process.exit(1);
  }
  try {
    return billingOrigin(raw);
  } catch (e) {
    process.stderr.write(name + ' is not a usable URL\n');
    process.exit(1);
  }
}

const billing = requiredOrigin('BILLING_URL');
const token = String(process.env.NODE_TOKEN || '').trim();
if (!/^cn_[a-f0-9]{64}$/.test(token)) {
  process.stderr.write('NODE_TOKEN is missing or not a cache-node token\n');
  process.exit(1);
}
const torr = String(process.env.TORRSERVER_URL || 'http://torrserver:8090').replace(/\/+$/, '');
const dataDir = process.env.DATA_DIR || '/torrents';
const port = Math.floor(Number(process.env.PORT || 8090));
const torrDest = new URL(torr);

let assignmentCount = 0;
let torrOk = false;

function disk() {
  try {
    const s = statfsSync(dataDir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { diskUsedBytes: Math.max(0, total - free), diskTotalBytes: total };
  } catch (e) {
    return { diskUsedBytes: 0, diskTotalBytes: 0 };
  }
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function proxy(req, res, target) {
  const headers = { host: torrDest.host };
  if (req.headers.range) headers.range = req.headers.range;
  const up = http.request(
    {
      protocol: torrDest.protocol,
      hostname: torrDest.hostname,
      port: torrDest.port,
      path: target,
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
    },
    (upRes) => {
      const pass = {};
      const keep = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (let i = 0; i < keep.length; i++) {
        if (upRes.headers[keep[i]]) pass[keep[i]] = upRes.headers[keep[i]];
      }
      res.writeHead(upRes.statusCode || 502, pass);
      upRes.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  up.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method' });
    return;
  }
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, torrserver: torrOk, assignments: assignmentCount, ...disk() });
    return;
  }
  const target = safeStreamTarget(url.pathname + url.search);
  if (!target) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  proxy(req, res, target);
});

async function report(row, status, error) {
  const out = await billingJson(billing, token, 'POST', '/v1/cache/report', { id: row.id, status, error: error || '' });
  if (out.status !== 200) process.stderr.write('cache report status=' + out.status + '\n');
}

async function fill(row, already) {
  const hash = String(row.infohash || '').toLowerCase();
  const magnet = row.magnet || 'magnet:?xt=urn:btih:' + hash;
  if (!already) {
    try {
      await addMagnet(torr, magnet, row.title || '');
    } catch (e) {
      await report(row, 'failed', 'add_failed');
      return;
    }
  }
  let file = null;
  try {
    file = await largestFile(torr, hash);
  } catch (e) {
    file = null;
  }
  if (!file) {
    await report(row, 'caching', 'no_metadata');
    return;
  }
  const goal = prefixGoal(row);
  let got = 0;
  try {
    got = await readPrefix(torr, hash, file.id, goal);
  } catch (e) {
    await report(row, 'caching', 'prefix_short');
    return;
  }
  if (got >= goal * 0.9) await report(row, 'cached', '');
  else await report(row, 'caching', 'prefix_short');
}

async function syncAssignments(rows) {
  let local = null;
  try {
    local = await listHashes(torr);
  } catch (e) {
    process.stderr.write('torrserver list failed\n');
    return;
  }
  const plan = reconcile(local, rows);
  for (let i = 0; i < plan.remove.length; i++) {
    try {
      await removeHash(torr, plan.remove[i]);
    } catch (e) {
      process.stderr.write('torrserver remove failed\n');
    }
  }
  for (let i = 0; i < plan.add.length; i++) await fill(plan.add[i], false);
  for (let i = 0; i < plan.keep.length; i++) await fill(plan.keep[i], true);
  assignmentCount = rows.length;
}

async function beat(path) {
  torrOk = await echoOk(torr);
  const usage = disk();
  const out = await billingJson(billing, token, 'POST', path, { ...usage, torrserverOk: torrOk, ok: torrOk });
  if (out.status !== 200) {
    process.stderr.write('cache ' + path + ' status=' + out.status + '\n');
    return null;
  }
  return out.data;
}

async function tick() {
  try {
    const reg = await beat('/v1/cache/register');
    if (!reg) return;
    if (reg.disabled || reg.enabled === false) {
      await syncAssignments([]);
      return;
    }
    const pulled = await billingJson(billing, token, 'GET', '/v1/cache/assignments');
    if (pulled.status !== 200) {
      process.stderr.write('cache assignments status=' + pulled.status + '\n');
      return;
    }
    const rows = pulled.data && Array.isArray(pulled.data.assignments) ? pulled.data.assignments : [];
    if (pulled.data && pulled.data.enabled === false) {
      await syncAssignments([]);
      return;
    }
    await syncAssignments(rows);
  } catch (e) {
    process.stderr.write('cache tick failed\n');
  }
}

server.listen(port, '0.0.0.0', () => {
  process.stderr.write('cache agent listening on ' + port + '\n');
});

await tick();
setInterval(() => {
  void tick();
}, Math.max(15, Math.floor(Number(process.env.SYNC_SEC || 60))) * 1000);
