import { describe, expect, it } from 'vitest';
// @ts-ignore node builtins, no @types/node in this project
import { readFileSync } from 'node:fs';
import { EXTRA_CA_HOSTS, needsExtraCa } from '../../scripts/parser-monitor/tlsFetch.mjs';

describe('parser monitor TLS', () => {
  it('trusts the Let\'s Encrypt YE intermediates for torrent.by only', () => {
    expect(needsExtraCa('torrent.by')).toBe(true);
    expect(needsExtraCa('www.torrent.by')).toBe(true);
    expect(needsExtraCa('TORRENT.BY')).toBe(true);
    expect(needsExtraCa('nottorrent.by')).toBe(false);
    expect(needsExtraCa('torrent.by.evil.example')).toBe(false);
    expect(needsExtraCa('rutor.info')).toBe(false);
    expect(needsExtraCa('')).toBe(false);
  });

  it('mirrors the Android network security config', () => {
    const xml = readFileSync('android/app/src/main/res/xml/network_security_config.xml', 'utf8');
    EXTRA_CA_HOSTS.forEach((h) => expect(xml).toContain('<domain includeSubdomains="true">' + h + '</domain>'));
    const pem = readFileSync('android/app/src/main/res/raw/letsencrypt_ye.crt', 'utf8');
    expect(pem.match(/BEGIN CERTIFICATE/g)!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('parser monitor workflow', () => {
  const yml = readFileSync('.github/workflows/parser-monitor.yml', 'utf8');

  it('has the notify input the admin bot\'s /check sets', () => {
    expect(yml).toMatch(/\n      notify:\n        description: [^\n]+\n        type: boolean\n        default: false\n/);
  });

  it('reports a notify run to the admin even when the check failed', () => {
    expect(yml).toContain('if: ${{ always() && inputs.notify }}');
    expect(yml).toContain('run: node scripts/parser-monitor/notify.mjs monitor-out/report.json');
  });
});
