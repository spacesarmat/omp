import { describe, it, expect } from 'vitest';
import { buildPairUri, pairIntentUri, parsePairUri, PAIR_ORIGIN } from '../../src/lib/pairing';

describe('pairing uri', () => {
  it('is an https link the phone camera can open, and round-trips', () => {
    const u = buildPairUri({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(u.indexOf(PAIR_ORIGIN + '/pair?v=1&url=')).toBe(0);
    expect(u.indexOf('omp://')).toBe(-1);
    expect(u.split('#')[0]).not.toMatch(/[?&](user|password)=/);
    expect(u.split('#')[1]).toContain('password=' + encodeURIComponent('p&s s'));
    expect(parsePairUri(u)).toEqual({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(parsePairUri(pairIntentUri(u))).toEqual({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(parsePairUri(PAIR_ORIGIN + '/pair?v=1&url=' + encodeURIComponent('http://h:1') + '&user=admin&password=old')).toEqual({ url: 'http://h:1', user: 'admin', password: 'old' });
    expect(buildPairUri({ url: 'http://h:1' })).toBe(PAIR_ORIGIN + '/pair?v=1&url=' + encodeURIComponent('http://h:1'));
    expect(parsePairUri(buildPairUri({ url: 'http://h:1' }))).toEqual({ url: 'http://h:1' });
  });

  it('accepts www, a trailing slash, the intent fallback, and the old omp:// code', () => {
    const https = buildPairUri({ url: 'http://h:1', name: 'LG' });
    expect(parsePairUri(https.replace(PAIR_ORIGIN, 'https://www.omp-player.online'))).toEqual({ url: 'http://h:1', name: 'LG' });
    expect(parsePairUri(https.replace('/pair?', '/pair/?'))).toEqual({ url: 'http://h:1', name: 'LG' });
    expect(parsePairUri(pairIntentUri(https))).toEqual({ url: 'http://h:1', name: 'LG' });
    expect(parsePairUri('omp://pair?v=1&url=' + encodeURIComponent('http://h:1'))).toEqual({ url: 'http://h:1' });
    const intent = pairIntentUri(https);
    expect(intent).toContain('package=com.spacesarmat.omp');
    expect(intent).toContain('scheme=https');
    expect(intent).toContain(encodeURIComponent(https));
  });

  it('rejects foreign or broken codes', () => {
    expect(parsePairUri('https://example.com/pair?v=1&url=http://h')).toBeNull();
    expect(parsePairUri('https://omp-player.online/t/movie/1')).toBeNull();
    expect(parsePairUri(PAIR_ORIGIN + '/pair?v=2&url=x')).toBeNull();
    expect(parsePairUri(PAIR_ORIGIN + '/pair?v=1')).toBeNull();
    expect(parsePairUri('omp://pair?v=1&url=%E0%A4%A')).toBeNull();
  });

  it('the intent carries only our own host: a lookalike address gives the plain /pair', () => {
    const evil = 'https://omp-player.online.attacker.example/pair?v=1&url=' + encodeURIComponent('http://evil:8090') + '#user=admin&password=secret';
    const intent = pairIntentUri(evil);
    // what the app receives is only the path; the original address stays in the browser fallback, encoded
    expect(intent.slice('intent://omp-player.online'.length, intent.indexOf('#Intent;'))).toBe('/pair');
    expect(intent).not.toContain('password=secret');
    expect(intent).toContain('S.browser_fallback_url=' + encodeURIComponent(evil));
    // plain http and an odd port are ours neither
    expect(pairIntentUri('http://omp-player.online/pair?v=1&url=x')).toContain('intent://omp-player.online/pair#Intent;');
    expect(pairIntentUri('https://omp-player.online:8443/pair?v=1&url=x')).toContain('intent://omp-player.online/pair#Intent;');
    // and a real pair link still reaches the app with its credentials
    expect(parsePairUri(pairIntentUri(buildPairUri({ url: 'http://h:1', name: 'LG', user: 'u', password: 'p' })))).toEqual({ url: 'http://h:1', name: 'LG', user: 'u', password: 'p' });
  });
});
