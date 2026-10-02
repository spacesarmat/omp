import { describe, it, expect } from 'vitest';
import { buildPairUri, parsePairUri } from '../../src/lib/pairing';

describe('pairing uri', () => {
  it('round-trips and omits empty fields', () => {
    const u = buildPairUri({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(u.indexOf('omp://pair?v=1&url=')).toBe(0);
    expect(parsePairUri(u)).toEqual({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'admin', password: 'p&s s' });
    expect(buildPairUri({ url: 'http://h:1' })).toBe('omp://pair?v=1&url=' + encodeURIComponent('http://h:1'));
    expect(parsePairUri(buildPairUri({ url: 'http://h:1' }))).toEqual({ url: 'http://h:1' });
  });
  it('rejects foreign or broken codes', () => {
    expect(parsePairUri('https://example.com')).toBeNull();
    expect(parsePairUri('omp://pair?v=2&url=x')).toBeNull();
    expect(parsePairUri('omp://pair?v=1')).toBeNull();
    expect(parsePairUri('omp://pair?v=1&url=%E0%A4%A')).toBeNull();
  });
});
