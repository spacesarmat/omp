import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync('ops/vps/docker-compose.nuc.yml', 'utf8');

/** The lines of one top-level key's child block (`  name:` up to the next sibling or top-level key), comments dropped. */
function block(src: string, indent: string, name: string) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l === indent + name + ':');
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    const lead = l.length - l.trimStart().length;
    if (lead <= indent.length) break;
    out.push(l.replace(/\s+#.*$/, ''));
  }
  return out.join('\n');
}

const services = block(text, '', 'services');
const pg = block(services, '  ', 'postgres');
const billing = block(services, '  ', 'billing');
const networks = block(text, '', 'networks');

describe('NUC compose: postgres for billing', () => {
  it('postgres 17 publishes no port and sits only on the internal pg network', () => {
    expect(pg).toContain('image: postgres:17-alpine');
    expect(pg).not.toMatch(/^\s+(ports|expose):/m);
    expect(block(pg, '    ', 'networks').trim()).toBe('- pg');
    expect(block(networks, '  ', 'pg').trim()).toBe('internal: true');
  });

  it('data in ./data/postgres, a pg_isready healthcheck, the password only from .env', () => {
    expect(block(pg, '    ', 'volumes').trim()).toBe('- ./data/postgres:/var/lib/postgresql/data');
    expect(block(pg, '    ', 'healthcheck')).toContain('pg_isready -U omp_billing -d omp_billing');
    expect(pg).toContain('POSTGRES_PASSWORD: ${BILLING_PG_PASSWORD:?set BILLING_PG_PASSWORD in .env}');
  });

  it('billing runs on Postgres (since the cutover), read-write by default, with backups', () => {
    expect(billing).toContain('BILLING_STORE: ${BILLING_STORE:-postgres}');
    expect(billing).toContain('BILLING_READONLY: ${BILLING_READONLY:-0}');
    expect(billing).toContain('BILLING_DATABASE_URL: postgres://omp_billing:${BILLING_PG_PASSWORD:?set BILLING_PG_PASSWORD in .env}@postgres:5432/omp_billing');
    expect(billing).toContain('BILLING_PG_BACKUP_DIR: /backups/pg');
    expect(block(billing, '    ', 'volumes').trim()).toBe('- /opt/omp-backups/pg:/backups/pg');
    expect(block(billing, '    ', 'networks').split('\n').map((l) => l.trim())).toEqual(['- omp', '- pg']);
    expect(billing).toMatch(/NO_PROXY: \S*\bpostgres\b/);
  });

  it('no password literal anywhere in the file', () => {
    expect(text).not.toMatch(/BILLING_PG_PASSWORD=\S/);
    expect(text).not.toMatch(/POSTGRES_PASSWORD:\s*["']?[A-Za-z0-9]{12,}/);
  });
});
