// HTTP on the docker network only. DHT_TOKEN empty: lookups stay disabled, /health still answers.
import { createServer } from 'node:http';
import { createDhtApp } from './http.mjs';
import { createDhtLookup } from './lookup.mjs';

function envInt(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const port = envInt('DHT_HTTP_PORT', 8788);
const lookup = createDhtLookup({
  lookupMs: envInt('DHT_LOOKUP_MS', 8000),
  idleMs: envInt('DHT_IDLE_MS', 10 * 60 * 1000),
});
const app = createDhtApp({
  token: String(process.env.DHT_TOKEN || ''),
  lookup,
  ttlMs: envInt('DHT_CACHE_MS', 10 * 60 * 1000),
  missTtlMs: envInt('DHT_MISS_CACHE_MS', 30 * 1000),
});

createServer(app).listen(port, '0.0.0.0', () => {
  process.stdout.write('dht-peers http :' + port + '\n');
});
