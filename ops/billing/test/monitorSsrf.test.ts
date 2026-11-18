import { describe, expect, it } from 'vitest';
import { isPublicSiteUrl } from '../src/monitorChecks.mjs';

describe('monitor site SSRF guard', () => {
  it('accepts public http(s) tracker hosts', () => {
    for (const u of ['https://rutracker.org/forum/', 'http://example.com/', 'https://sub.example.co.uk/x', 'https://8.8.8.8/']) {
      expect(isPublicSiteUrl(u)).toBe(true);
    }
  });

  it('rejects loopback, private, link-local and CGN addresses', () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.211/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:192.168.1.1]/',
    ]) {
      expect(isPublicSiteUrl(u)).toBe(false);
    }
  });

  it('rejects internal names, single labels and non-http schemes', () => {
    for (const u of [
      'http://localhost/',
      'http://omp.local/',
      'http://nas.internal/',
      'http://printer.lan/',
      'http://intranet/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'ftp://example.com/',
      'not a url',
      '',
    ]) {
      expect(isPublicSiteUrl(u)).toBe(false);
    }
  });

  it('still accepts public IPv6 and bracketed public hosts', () => {
    expect(isPublicSiteUrl('https://[2001:4860:4860::8888]/')).toBe(true);
  });
});