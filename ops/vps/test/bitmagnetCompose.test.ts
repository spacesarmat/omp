import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('test bitmagnet compose', () => {
  const file = readFileSync('ops/vps/bitmagnet/docker-compose.yml', 'utf8');
  const deploy = readFileSync('ops/vps/deploy.sh', 'utf8');
  const main = readFileSync('ops/vps/docker-compose.yml', 'utf8');
  const readme = readFileSync('ops/vps/bitmagnet/README.md', 'utf8');

  it('is a separate stack with its own Postgres, limits, and no public web bind', () => {
    expect(file).toContain('name: omp-bitmagnet-test');
    expect(file).toContain('image: ghcr.io/bitmagnet-io/bitmagnet:v0.10.0');
    expect(file).toContain('image: postgres:16-alpine');
    expect(file).toContain('container_name: omp-bitmagnet-postgres');
    expect(file).toContain('mem_limit: 512m');
    expect(file).toContain('mem_limit: 1g');
    expect(file).toContain('pg_isready -U postgres -d bitmagnet');
    expect(file).toContain('condition: service_healthy');
    expect(file).toContain('${BITMAGNET_BIND:-127.0.0.1}:3333:3333');
    expect(file).toContain('--keys=http_server');
    expect(file).not.toContain('caddy');
    expect(file).not.toMatch(/0\.0\.0\.0:3333/);
    expect(file).not.toContain('5432:5432');
    expect(deploy).not.toContain('bitmagnet');
    expect(main).not.toMatch(/\n  bitmagnet:\n/);
    expect(main).toContain('BILLING_BITMAGNET_API_KEY: ${BILLING_BITMAGNET_API_KEY:-}');
    expect(readme).toContain('docker compose --env-file .env down');
  });

  it('runs the DHT crawler with the swarm port published, and documents the disk budget', () => {
    expect(file).toContain('--keys=dht_crawler');
    expect(file).toContain('3334:3334/tcp');
    expect(file).toContain('3334:3334/udp');
    expect(file).toContain('TMDB_API_KEY: ${TMDB_API_KEY}');
    expect(readme).toContain('dht_crawler');
    expect(readme).toContain('80 GB');
  });
});
