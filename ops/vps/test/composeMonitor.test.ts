import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = readFileSync('ops/vps/docker-compose.yml', 'utf8');
const nuc = readFileSync('ops/vps/docker-compose.nuc.yml', 'utf8');
const envExample = readFileSync('ops/vps/.env.example', 'utf8');

/** The lines of one child block (`  name:` up to the next sibling or a shallower key), comments dropped. */
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
const proxy = block(services, '  ', 'docker-proxy');
const billing = block(services, '  ', 'billing');
const nucBilling = block(block(nuc, '', 'services'), '  ', 'billing');

describe('compose: read-only Docker API proxy for the billing monitor', () => {
  it('is a pinned tecnativa image with only CONTAINERS and no writes', () => {
    expect(proxy).toMatch(/image: tecnativa\/docker-socket-proxy:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}/);
    const env = block(proxy, '    ', 'environment');
    expect(env).toContain('CONTAINERS: "1"');
    expect(env).toContain('POST: "0"');
    for (const name of ['EVENTS', 'PING', 'VERSION']) expect(env).toContain(name + ': "0"');
    // nothing else is granted: no exec, images, restarts, start/stop, ...
    const granted = env.split('\n').filter((l) => /: "1"$/.test(l.trim()) && !/DISABLE_IPV6/.test(l));
    expect(granted.map((l) => l.trim())).toEqual(['CONTAINERS: "1"']);
  });

  it('mounts the socket read-only, publishes nothing, sits only on the internal network', () => {
    expect(block(proxy, '    ', 'volumes').trim()).toBe('- /var/run/docker.sock:/var/run/docker.sock:ro');
    expect(proxy).not.toMatch(/^\s+(ports|expose):/m);
    expect(proxy).toContain('read_only: true');
    expect(block(proxy, '    ', 'networks').trim()).toBe('- dockerapi');
    expect(block(block(base, '', 'networks'), '  ', 'dockerapi').trim()).toBe('internal: true');
  });

  it('billing reaches it directly (not through WARP) on both stacks', () => {
    expect(billing).toContain('BILLING_DOCKER_PROXY_URL: http://docker-proxy:2375');
    expect(block(billing, '    ', 'networks').split('\n').map((l) => l.trim())).toEqual(['- omp', '- dockerapi']);
    expect(billing).toMatch(/NO_PROXY: \S*\bdocker-proxy\b/);
    expect(nucBilling).toMatch(/NO_PROXY: \S*\bdocker-proxy\b/);
    expect(block(nucBilling, '    ', 'networks')).toContain('- dockerapi');
  });

  it('alert chat and the on/off switch are documented in .env.example, no secrets there', () => {
    expect(billing).toContain('BILLING_MONITOR_CHAT_ID: ${BILLING_MONITOR_CHAT_ID:-536445442}');
    expect(envExample).toContain('BILLING_MONITOR=1');
    expect(envExample).toContain('BILLING_MONITOR_CHAT_ID=536445442');
    expect(envExample).toContain('BILLING_MONITOR_WARP_PROXY');
  });
});
