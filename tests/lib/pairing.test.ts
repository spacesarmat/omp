import { describe, it, expect } from 'vitest';
import { buildPairUri, pairIntentUri, parsePairUri, PAIR_ORIGIN } from '../../src/lib/pairing';

describe('pairing uri', () => {
  it('is an https link the phone camera can open, and round-trips', () => {
    const u = buildPairUri({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(u.indexOf(PAIR_ORIGIN + '/pair?v=1&url=')).toBe(0);
    expect(u.indexOf('omp://')).toBe(-1);
    expect(parsePairUri(u)).toEqual({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
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
});
