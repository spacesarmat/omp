import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = readFileSync('ops/vps/docker-compose.yml', 'utf8');
const nuc = readFileSync('ops/vps/docker-compose.nuc.yml', 'utf8');

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

const services = block(base, '', 'services');
const billing = block(services, '  ', 'billing');
const jackett = block(services, '  ', 'jackett');
const jacred = block(services, '  ', 'jacred');
const torrserver = block(services, '  ', 'torrserver');
const flaresolverr = block(services, '  ', 'flaresolverr');
const dockerProxy = block(services, '  ', 'docker-proxy');
const dhtPeers = block(services, '  ', 'dht-peers');
const nucServices = block(nuc, '', 'services');
const nucBilling = block(nucServices, '  ', 'billing');
const postgres = block(nucServices, '  ', 'postgres');

describe('compose: pinned images and healthchecks', () => {
  it('pins every external image by digest except the CI-built billing image and local dht-peers', () => {
    for (const svc of [
      block(services, '  ', 'caddy'),
      block(services, '  ', 'warp'),
      jackett,
      jacred,
      torrserver,
      flaresolverr,
      dockerProxy,
      postgres,
      block(nucServices, '  ', 'warp-tunnel'),
      block(nucServices, '  ', 'cloudflared'),
      block(nucServices, '  ', 'cloudflared-home-nas'),
    ]) {
      expect(svc).toMatch(/image: \S+@sha256:[a-f0-9]{64}/);
    }
    expect(billing).toMatch(/image: \$\{BILLING_IMAGE:-ghcr\.io\/spacesarmat\/omp-billing:latest\}/);
    expect(dhtPeers).toContain('image: ${DHT_IMAGE:-omp-dht-peers:local}');
  });

  it('has healthchecks for services that other services wait for', () => {
    for (const svc of [billing, jackett, jacred, torrserver, flaresolverr, dockerProxy, dhtPeers, postgres]) {
      expect(block(svc, '    ', 'healthcheck')).toContain('test:');
    }
  });

  it('waits for healthy dependencies before starting billing and jacred', () => {
    const billingDeps = block(billing, '    ', 'depends_on');
    expect(billingDeps).toContain('jackett:');
    expect(billingDeps).toContain('condition: service_healthy');
    expect(billingDeps).toContain('warp:');
    expect(billingDeps).toContain('condition: service_started');

    const jacredDeps = block(jacred, '    ', 'depends_on');
    expect(jacredDeps).toContain('torrserver:');
    expect(jacredDeps).toContain('condition: service_healthy');

    const nucBillingDeps = block(nucBilling, '    ', 'depends_on');
    expect(nucBillingDeps).toContain('postgres:');
    expect(nucBillingDeps).toContain('condition: service_healthy');
  });
});
